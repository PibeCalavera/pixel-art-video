import { ImageDataBuffer } from "../image.js";

/**
 * Supported pair dithering matrix sizes.
 */
const PAIR_MATRIX_SIZES = new Set([2, 4, 8]);

/**
 * Base matrix used for local color analysis.
 *
 * Larger matrices never replace this local analysis.
 */
const BASE_MATRIX_SIZE = 2;

/**
 * Number of candidate color pairs retained by each local matrix.
 *
 * Keeping only a small number of candidates preserves local color
 * accuracy without introducing a combinatorial search.
 */
const LOCAL_PAIR_CANDIDATES = 2;

/**
 * Weight applied to RGB reconstruction error.
 */
const RGB_ERROR_WEIGHT = 1;

/**
 * Weight applied to chromatic direction error.
 *
 * A strong chromatic weight prevents neutral pairs such as
 * black + white from dominating saturated targets.
 */
const CHROMA_DIRECTION_WEIGHT = 3;

/**
 * Weight applied to chroma magnitude error.
 */
const CHROMA_MAGNITUDE_WEIGHT = 1.5;

/**
 * Apply two-color spatial dithering.
 *
 * Local color decisions are calculated using overlapping 2x2
 * neighborhoods. Each neighborhood keeps a small number of
 * candidate palette pairs so every pixel can select the pair
 * that best represents its own original color.
 *
 * The requested matrix size controls the spatial context used
 * to distribute the final A/B decisions.
 *
 * A global Atkinson error buffer is used for the binary A/B
 * distribution. This allows quantization error to travel across
 * matrix boundaries instead of restarting for every matrix.
 *
 * @param {ImageDataBuffer} image
 * @param {{
 *   palette: import("../palette.js").Palette,
 *   strength?: number,
 *   matrixSize?: number
 * }} options
 * @returns {ImageDataBuffer}
 */
export function ditherPair(image, options = {}) {
  assertImage(image);

  const palette = options.palette;

  if (!palette) {
    throw new TypeError("ditherPair requires a palette.");
  }

  const strength = validateStrength(options.strength ?? 1);

  const matrixSize = validateMatrixSize(options.matrixSize ?? 4);

  const paletteColors = palette.toArray();

  if (paletteColors.length < 2) {
    throw new RangeError(
      "ditherPair requires a palette with at least two colors.",
    );
  }

  /*
   * Precompute palette color information once.
   */
  const paletteData = paletteColors.map((color) =>
    createPaletteColorData(color),
  );

  /*
   * Precompute every unordered palette pair once.
   *
   * Pair geometry never changes during the processing pass,
   * so calculating it repeatedly would only waste CPU time.
   */
  const pairData = createPalettePairs(paletteData);

  const result = ImageDataBuffer.clone(image);

  /*
   * Calculate every overlapping 2x2 decision exactly once.
   */
  const localData = calculateLocalDecisions(image, pairData, strength);

  /*
   * Use the requested matrix size as spatial context while
   * distributing the local A/B decisions.
   */
  distributeMatrixDecisions(image, result, localData, matrixSize);

  return result;
}

/**
 * Return the matrix sizes supported by pair dithering.
 *
 * @returns {number[]}
 */
export function getPairMatrixSizes() {
  return [...PAIR_MATRIX_SIZES];
}

/**
 * Create cached information for one palette color.
 */
function createPaletteColorData(color) {
  const luminance = getLuminance(color);

  return {
    color,
    luminance,
    chroma: getChromaVector(color, luminance),
    chromaMagnitude: getChromaMagnitude(color, luminance),
  };
}

/**
 * Create all unordered palette pairs.
 *
 * A+B and B+A represent the same pair, so only one direction
 * is stored.
 */
function createPalettePairs(paletteData) {
  const pairs = [];

  for (let indexA = 0; indexA < paletteData.length - 1; indexA++) {
    const colorA = paletteData[indexA];

    for (let indexB = indexA + 1; indexB < paletteData.length; indexB++) {
      const colorB = paletteData[indexB];

      if (sameColor(colorA.color, colorB.color)) {
        continue;
      }

      const dr = colorB.color.r - colorA.color.r;

      const dg = colorB.color.g - colorA.color.g;

      const db = colorB.color.b - colorA.color.b;

      const denominator = dr * dr + dg * dg + db * db;

      pairs.push({ colorA, colorB, dr, dg, db, denominator });
    }
  }

  return pairs;
}

/**
 * Calculate all local A/B decisions.
 *
 * Every overlapping 2x2 neighborhood is processed exactly once.
 * Each neighborhood produces a small set of candidate pairs.
 * Every pixel then selects the candidate that best represents
 * its own original RGB color.
 */
function calculateLocalDecisions(image, pairData, strength) {
  const pixelCount = image.width * image.height;

  const decisions = new Array(pixelCount);

  /*
   * Store each local 2x2 decision separately.
   */
  const matrixWidth = Math.max(0, image.width - BASE_MATRIX_SIZE + 1);

  const matrixHeight = Math.max(0, image.height - BASE_MATRIX_SIZE + 1);

  const matrixDecisions = new Array(matrixWidth * matrixHeight);

  for (let startY = 0; startY < matrixHeight; startY++) {
    for (let startX = 0; startX < matrixWidth; startX++) {
      const matrixDecision = calculateLocalMatrixDecision(
        image,
        pairData,
        startX,
        startY,
        strength,
      );

      matrixDecisions[startY * matrixWidth + startX] = matrixDecision;
    }
  }

  /*
   * Combine the precomputed neighborhoods for each pixel.
   *
   * A pixel can belong to up to four overlapping 2x2 matrices.
   * All available local candidates are compared against the
   * original pixel color.
   */
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const pixelIndex = y * image.width + x;

      const target = getPixelColor(image, x, y);

      let bestDecision = null;
      let bestScore = Infinity;

      /*
       * A pixel can belong to up to four 2x2 matrices.
       */
      for (let offsetY = -1; offsetY <= 0; offsetY++) {
        for (let offsetX = -1; offsetX <= 0; offsetX++) {
          const startX = x + offsetX;

          const startY = y + offsetY;

          if (
            startX < 0 ||
            startY < 0 ||
            startX >= matrixWidth ||
            startY >= matrixHeight
          ) {
            continue;
          }

          const matrix = matrixDecisions[startY * matrixWidth + startX];

          const localX = x - startX;

          const localY = y - startY;

          const localPixel = matrix.pixels[localY * BASE_MATRIX_SIZE + localX];

          /*
           * Evaluate every candidate generated by this
           * neighborhood against the actual pixel.
           */
          for (const candidate of localPixel.candidates) {
            const score = scorePairForTarget(target, candidate);

            if (score < bestScore) {
              bestScore = score;

              bestDecision = {
                ratio: candidate.ratio,
                colorA: candidate.colorA,
                colorB: candidate.colorB,
              };
            }
          }
        }
      }

      /*
       * Handle images smaller than 2x2.
       */
      if (!bestDecision) {
        bestDecision = calculateFallbackDecision(
          image,
          pairData,
          x,
          y,
          strength,
        );
      }

      decisions[pixelIndex] = bestDecision;
    }
  }

  return decisions;
}

/**
 * Calculate one overlapping 2x2 neighborhood.
 *
 * The neighborhood first finds the best palette pairs for its
 * average color. Each individual pixel then chooses between
 * those candidate pairs using its own original color.
 */
function calculateLocalMatrixDecision(
  image,
  pairData,
  startX,
  startY,
  strength,
) {
  const pixels = new Array(4);

  let r = 0;
  let g = 0;
  let b = 0;

  let index = 0;

  for (let localY = 0; localY < BASE_MATRIX_SIZE; localY++) {
    for (let localX = 0; localX < BASE_MATRIX_SIZE; localX++) {
      const imageX = startX + localX;

      const imageY = startY + localY;

      const target = getPixelColor(image, imageX, imageY);

      pixels[index++] = target;

      r += target.r;
      g += target.g;
      b += target.b;
    }
  }

  const matrixTarget = {
    r: r / (BASE_MATRIX_SIZE * BASE_MATRIX_SIZE),

    g: g / (BASE_MATRIX_SIZE * BASE_MATRIX_SIZE),

    b: b / (BASE_MATRIX_SIZE * BASE_MATRIX_SIZE),
  };

  /*
   * Keep only a small number of good pairs for this neighborhood.
   */
  const pairs = findBestColorPairs(
    matrixTarget,
    pairData,
    LOCAL_PAIR_CANDIDATES,
  );

  if (pairs.length === 0) {
    return { pixels: pixels.map(() => ({ candidates: [] })) };
  }

  return {
    pixels: pixels.map((target) => {
      const candidates = pairs.map((pair) => {
        let ratio = findBestMixRatio(target, pair);

        ratio = clamp(ratio * strength, 0, 1);

        return {
          ratio,
          colorA: pair.colorA.color,
          colorB: pair.colorB.color,
          pair,
        };
      });

      return { candidates };
    }),
  };
}

/**
 * Calculate a fallback decision for image borders.
 */
function calculateFallbackDecision(image, pairData, x, y, strength) {
  const target = getPixelColor(image, x, y);

  const pair = findBestColorPairs(target, pairData, 1)[0];

  if (!pair) {
    return {
      ratio: 0,
      colorA: pairData[0].colorA.color,
      colorB: pairData[0].colorB.color,
    };
  }

  return {
    ratio: clamp(findBestMixRatio(target, pair) * strength, 0, 1),
    colorA: pair.colorA.color,
    colorB: pair.colorB.color,
  };
}

/**
 * Distribute local decisions using one global error buffer.
 *
 * The matrix size controls the spatial processing context,
 * while quantization error is allowed to travel through the
 * entire image.
 */
function distributeMatrixDecisions(image, result, localData, matrixSize) {
  const error = Array.from(
    { length: image.height },
    () => new Float64Array(image.width),
  );

  for (
    let matrixStartY = 0;
    matrixStartY < image.height;
    matrixStartY += matrixSize
  ) {
    const matrixEndY = Math.min(matrixStartY + matrixSize, image.height);

    for (
      let matrixStartX = 0;
      matrixStartX < image.width;
      matrixStartX += matrixSize
    ) {
      const matrixEndX = Math.min(matrixStartX + matrixSize, image.width);

      processDistributionMatrix(
        image,
        result,
        localData,
        error,
        matrixStartX,
        matrixStartY,
        matrixEndX,
        matrixEndY,
      );
    }
  }
}

/**
 * Process one spatial distribution matrix.
 *
 * The error buffer is shared by all matrices. This prevents
 * quantization error from being discarded at matrix boundaries.
 */
function processDistributionMatrix(
  image,
  result,
  localData,
  error,
  startX,
  startY,
  endX,
  endY,
) {
  for (let y = startY; y < endY; y++) {
    /*
     * Alternate scan direction on every row to reduce directional
     * artifacts while keeping the error diffusion deterministic.
     */
    const reverse = (y - startY) % 2 === 1;

    const width = endX - startX;

    for (let scanX = 0; scanX < width; scanX++) {
      const x = reverse ? endX - 1 - scanX : startX + scanX;

      const index = y * image.width + x;

      const decision = localData[index];

      if (!decision?.colorA || !decision?.colorB) {
        continue;
      }

      let ratio = decision.ratio + error[y][x];

      ratio = clamp(ratio, 0, 1);

      const useB = ratio >= 0.5;

      const quantized = useB ? 1 : 0;

      const quantizationError = ratio - quantized;

      diffuseDistributionError(
        error,
        x,
        y,
        quantizationError,
        image.width,
        image.height,
        reverse,
      );

      const color = useB ? decision.colorB : decision.colorA;

      const offset = index * 4;

      result.data[offset] = color.r;

      result.data[offset + 1] = color.g;

      result.data[offset + 2] = color.b;
    }
  }
}

/**
 * Diffuse binary distribution error using Atkinson diffusion.
 *
 * Atkinson intentionally propagates only six eighths of the
 * quantization error, leaving the remaining error behind.
 */
function diffuseDistributionError(error, x, y, value, width, height, reverse) {
  const direction = reverse ? -1 : 1;

  const offsets = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ];

  for (const [offsetX, offsetY] of offsets) {
    const targetX = x + offsetX * direction;

    const targetY = y + offsetY;

    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
      continue;
    }

    error[targetY][targetX] += value / 8;
  }
}

/**
 * Find the best palette pairs for a target.
 *
 * Pair selection uses RGB reconstruction together with
 * chromatic information. Neutral pairs are strongly discouraged
 * when the target contains meaningful color.
 */
function findBestColorPairs(target, pairData, count) {
  const bestPairs = [];

  for (const pair of pairData) {
    const ratio = findBestMixRatio(target, pair);

    const mixed = mixColors(pair.colorA.color, pair.colorB.color, ratio);

    const score = scoreColorRepresentation(target, mixed, pair);

    insertBestPair(bestPairs, { ...pair, ratio, score }, count);
  }

  return bestPairs;
}

/**
 * Score how well a synthetic pair representation explains
 * the target color.
 *
 * RGB remains important, but chromatic direction receives
 * a strong additional weight. This prevents a neutral
 * black + white pair from winning against a chromatic pair
 * merely because its luminance happens to be close.
 */
function scoreColorRepresentation(target, mixed, pair) {
  const rgbError = getNormalizedRgbError(target, mixed);

  const targetLuminance = getLuminance(target);

  const mixedLuminance = getLuminance(mixed);

  const targetChroma = getChromaVector(target, targetLuminance);

  const mixedChroma = getChromaVector(mixed, mixedLuminance);

  const targetChromaMagnitude = getVectorMagnitude(targetChroma);

  const mixedChromaMagnitude = getVectorMagnitude(mixedChroma);

  /*
   * Chromatic direction is undefined for neutral colors.
   */
  let directionError = 0;

  if (targetChromaMagnitude > 0.0001) {
    if (mixedChromaMagnitude <= 0.0001) {
      /*
       * A saturated target should strongly reject
       * a neutral synthetic representation.
       */
      directionError = 1;
    } else {
      const dot =
        targetChroma[0] * mixedChroma[0] +
        targetChroma[1] * mixedChroma[1] +
        targetChroma[2] * mixedChroma[2];

      const denominator = targetChromaMagnitude * mixedChromaMagnitude;

      const cosine = clamp(dot / denominator, -1, 1);

      directionError = (1 - cosine) / 2;
    }
  }

  /*
   * Compare the chroma magnitude independently from direction.
   */
  const chromaMagnitudeError =
    Math.abs(targetChromaMagnitude - mixedChromaMagnitude) / 255;

  /*
   * Explicitly identify neutral pairs. This is important for
   * palettes containing black and white because they can otherwise
   * become surprisingly competitive for colorful targets.
   */
  const pairChroma = pair.colorA.chromaMagnitude + pair.colorB.chromaMagnitude;

  let neutralPenalty = 0;

  if (targetChromaMagnitude > 15 && pairChroma < 10) {
    neutralPenalty = 2;
  }

  return (
    rgbError * RGB_ERROR_WEIGHT +
    directionError * CHROMA_DIRECTION_WEIGHT +
    chromaMagnitudeError * CHROMA_MAGNITUDE_WEIGHT +
    neutralPenalty
  );
}

/**
 * Score a candidate pair directly for an individual pixel.
 */
function scorePairForTarget(target, candidate) {
  const mixed = mixColors(candidate.colorA, candidate.colorB, candidate.ratio);

  return scoreColorRepresentation(target, mixed, candidate.pair);
}

/**
 * Insert a candidate into the sorted list of best pairs.
 *
 * The list remains capped at the requested number of candidates.
 */
function insertBestPair(bestPairs, candidate, count) {
  let insertIndex = bestPairs.length;

  for (let index = 0; index < bestPairs.length; index++) {
    if (candidate.score < bestPairs[index].score) {
      insertIndex = index;
      break;
    }
  }

  if (insertIndex === bestPairs.length) {
    if (bestPairs.length < count) {
      bestPairs.push(candidate);
    }

    return;
  }

  bestPairs.splice(insertIndex, 0, candidate);

  if (bestPairs.length > count) {
    bestPairs.pop();
  }
}

/**
 * Calculate the optimal mix ratio analytically.
 *
 * The ratio minimizes squared RGB error between the target and
 * the line segment defined by the two palette colors.
 */
function findBestMixRatio(target, pair) {
  if (pair.denominator <= 0) {
    return 0;
  }

  const tr = target.r - pair.colorA.color.r;

  const tg = target.g - pair.colorA.color.g;

  const tb = target.b - pair.colorA.color.b;

  const numerator = tr * pair.dr + tg * pair.dg + tb * pair.db;

  return clamp(numerator / pair.denominator, 0, 1);
}

/**
 * Calculate the synthetic appearance of two colors.
 */
function mixColors(colorA, colorB, ratio) {
  return {
    r: colorA.r + (colorB.r - colorA.r) * ratio,

    g: colorA.g + (colorB.g - colorA.g) * ratio,

    b: colorA.b + (colorB.b - colorA.b) * ratio,
  };
}

/**
 * Calculate normalized squared RGB error.
 */
function getNormalizedRgbError(colorA, colorB) {
  const dr = colorA.r - colorB.r;

  const dg = colorA.g - colorB.g;

  const db = colorA.b - colorB.b;

  return (dr * dr + dg * dg + db * db) / 195075;
}

/**
 * Calculate perceptual luminance.
 */
function getLuminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Calculate the chroma vector relative to luminance.
 *
 * Neutral colors such as black, white, and gray have a small
 * chromatic vector while saturated colors have a larger one.
 */
function getChromaVector(color, luminance) {
  return [color.r - luminance, color.g - luminance, color.b - luminance];
}

/**
 * Calculate the magnitude of a chroma vector.
 */
function getChromaMagnitude(color, luminance) {
  const chroma = getChromaVector(color, luminance);

  return getVectorMagnitude(chroma);
}

/**
 * Calculate the magnitude of a three-dimensional vector.
 */
function getVectorMagnitude(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Read one RGB pixel directly from the image buffer.
 */
function getPixelColor(image, x, y) {
  const offset = (y * image.width + x) * 4;

  return {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
  };
}

/**
 * Check whether two colors are identical.
 */
function sameColor(colorA, colorB) {
  return (
    colorA.r === colorB.r && colorA.g === colorB.g && colorA.b === colorB.b
  );
}

/**
 * Validate the matrix size.
 */
function validateMatrixSize(value) {
  if (!Number.isInteger(value) || !PAIR_MATRIX_SIZES.has(value)) {
    throw new RangeError(`Unsupported pair matrix size: ${value}.`);
  }

  return value;
}

/**
 * Validate dither strength.
 */
function validateStrength(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Dither strength must be a non-negative number.");
  }

  return value;
}

/**
 * Clamp a value to a range.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate the input image.
 */
function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("ditherPair expects an ImageDataBuffer.");
  }
}
