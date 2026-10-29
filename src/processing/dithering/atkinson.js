import { ImageDataBuffer } from "../image.js";

/**
 * Apply Atkinson error-diffusion dithering using a palette.
 *
 * Atkinson distributes one eighth of the quantization error to
 * six neighboring pixels and intentionally leaves two eighths
 * undistributed.
 *
 * @param {ImageDataBuffer} image
 * @param {{
 *   palette: import("../palette.js").Palette,
 *   strength?: number
 * }} options
 * @returns {ImageDataBuffer}
 */
export function ditherAtkinson(image, options = {}) {
  assertImage(image);

  const palette = options.palette;

  if (!palette) {
    throw new TypeError("ditherAtkinson requires a palette.");
  }

  const strength = validateStrength(options.strength ?? 1);

  const paletteColors = palette.toArray();

  if (paletteColors.length === 0) {
    throw new RangeError("ditherAtkinson requires a non-empty palette.");
  }

  const result = ImageDataBuffer.clone(image);
  const data = result.data;

  /*
   * Store the accumulated RGB quantization error separately
   * from the output image.
   */
  const errorR = new Float64Array(image.width * image.height);

  const errorG = new Float64Array(image.width * image.height);

  const errorB = new Float64Array(image.width * image.height);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;

      const offset = index * 4;

      const red = clampChannel(data[offset] + errorR[index] * strength);

      const green = clampChannel(data[offset + 1] + errorG[index] * strength);

      const blue = clampChannel(data[offset + 2] + errorB[index] * strength);

      const source = { r: red, g: green, b: blue };

      const output = findNearestColor(source, paletteColors);

      data[offset] = output.r;
      data[offset + 1] = output.g;
      data[offset + 2] = output.b;

      /*
       * Calculate the RGB quantization error introduced by
       * replacing the source color with the selected palette color.
       */
      const quantizationErrorR = red - output.r;

      const quantizationErrorG = green - output.g;

      const quantizationErrorB = blue - output.b;

      diffuseError(
        errorR,
        errorG,
        errorB,
        image.width,
        image.height,
        x,
        y,
        quantizationErrorR,
        quantizationErrorG,
        quantizationErrorB,
      );
    }
  }

  return result;
}

/**
 * Find the closest color from the entire palette in RGB space.
 *
 * @param {{ r: number, g: number, b: number }} color
 * @param {{ r: number, g: number, b: number }[]} paletteColors
 * @returns {{ r: number, g: number, b: number }}
 */
function findNearestColor(color, paletteColors) {
  let nearest = paletteColors[0];

  let nearestDistance = getColorDistanceSquared(color, nearest);

  for (let index = 1; index < paletteColors.length; index++) {
    const candidate = paletteColors[index];

    const distance = getColorDistanceSquared(color, candidate);

    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}

/**
 * Diffuse quantization error using the Atkinson kernel.
 *
 * The error is distributed equally to six neighboring pixels.
 * Each destination receives one eighth of the error.
 */
function diffuseError(
  errorR,
  errorG,
  errorB,
  width,
  height,
  x,
  y,
  valueR,
  valueG,
  valueB,
) {
  const destinations = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ];

  for (const [offsetX, offsetY] of destinations) {
    const targetX = x + offsetX;

    const targetY = y + offsetY;

    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
      continue;
    }

    const index = targetY * width + targetX;

    errorR[index] += valueR / 8;

    errorG[index] += valueG / 8;

    errorB[index] += valueB / 8;
  }
}

/**
 * Calculate squared RGB distance.
 */
function getColorDistanceSquared(colorA, colorB) {
  const red = colorA.r - colorB.r;

  const green = colorA.g - colorB.g;

  const blue = colorA.b - colorB.b;

  return red * red + green * green + blue * blue;
}

/**
 * Clamp an RGB channel to the valid range.
 */
function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Validate dithering strength.
 */
function validateStrength(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Dither strength must be a non-negative number.");
  }

  return value;
}

/**
 * Validate the input image.
 */
function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("ditherAtkinson expects an ImageDataBuffer.");
  }
}
