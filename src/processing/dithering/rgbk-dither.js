import { ImageDataBuffer } from "../image.js";

/**
 * Valid 2x2 subpixel configurations.
 *
 * Flag order:
 * 0: top-left (R)
 * 1: top-right (B)
 * 2: bottom-left (G)
 * 3: bottom-right (G)
 *
 * A value of 1 activates the corresponding subpixel.
 * A value of 0 renders it as black.
 */
const COMBINATIONS = [
  [0, 0, 0, 0], // KKKK
  [0, 0, 1, 0], // KKGK
  [0, 0, 0, 1], // KKKG
  [0, 0, 1, 1], // KKGG
  [1, 0, 0, 0], // RKKK
  [1, 0, 1, 0], // RKGK
  [1, 0, 0, 1], // RKKG
  [1, 0, 1, 1], // RKGG
  [0, 1, 0, 0], // KBKK
  [0, 1, 1, 0], // KBGK
  [0, 1, 0, 1], // KBKG
  [0, 1, 1, 1], // KBGG
  [1, 1, 0, 0], // RBKK
  [1, 1, 1, 0], // RBGK
  [1, 1, 0, 1], // RBKG
  [1, 1, 1, 1], // RBGG
];

/** RGB channel values for the output subpixel colors. */
const BLACK = [0, 0, 0];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];

/** RGB values of the background used for color matching. */
const BACKGROUND = [0, 0, 0];

/** Alpha value for every opaque output pixel. */
const OPAQUE_ALPHA = 255;

/** Alpha value for every transparent output pixel. */
const TRANSPARENT_ALPHA = 0;

/**
 * Maps each subpixel position to its corresponding RGB color.
 * The order must match the flag order used by `COMBINATIONS`.
 */
const SUBPIXEL_COLORS = [RED, BLUE, GREEN, GREEN];

/**
 * Converts an image into a 2x-resolution RGBK subpixel representation.
 *
 * Fully transparent source pixels remain transparent in the output.
 * Every non-transparent source pixel is composited over a solid black
 * background for color matching, then matched to the closest valid
 * subpixel configuration in linear-light RGB space.
 *
 * Each visible source pixel becomes a 2x2 output block containing red,
 * green, blue, or black subpixels. Every output pixel belonging to the
 * figure is fully opaque, including black subpixels.
 *
 * @param {ImageDataBuffer} image - Source image containing RGBA pixel data.
 * @returns {ImageDataBuffer} An image with twice the source width and height,
 * preserving fully transparent pixels and using opaque pixels for the figure.
 * @throws {TypeError} If the input does not contain valid dimensions and RGBA data.
 */
export function ditherRetroRGBK(image) {
  if (
    !image ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    !image.data ||
    image.data.length < image.width * image.height * 4
  ) {
    throw new TypeError(
      "Expected an image with valid width, height and RGBA data.",
    );
  }

  const { width, height, data } = image;
  const output = ImageDataBuffer.empty(width * 2, height * 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex = (y * width + x) * 4;

      const r = data[sourceIndex];
      const g = data[sourceIndex + 1];
      const b = data[sourceIndex + 2];
      const alphaByte = data[sourceIndex + 3];

      const outputX = x * 2;
      const outputY = y * 2;

      // Preserve fully transparent source pixels as transparent background.
      if (alphaByte === TRANSPARENT_ALPHA) {
        writeTransparentPixel(output, outputX, outputY);
        writeTransparentPixel(output, outputX + 1, outputY);
        writeTransparentPixel(output, outputX, outputY + 1);
        writeTransparentPixel(output, outputX + 1, outputY + 1);
        continue;
      }

      // Composite visible source colors over black for color matching.
      const alpha = alphaByte / 255;
      const opaqueR = compositeChannel(r, BACKGROUND[0], alpha);
      const opaqueG = compositeChannel(g, BACKGROUND[1], alpha);
      const opaqueB = compositeChannel(b, BACKGROUND[2], alpha);

      const combination = findClosestCombination(opaqueR, opaqueG, opaqueB);

      // Every subpixel belonging to the figure is fully opaque,
      // including black subpixels.
      writePixel(output, outputX, outputY, combination[0] ? RED : BLACK);
      writePixel(output, outputX + 1, outputY, combination[1] ? BLUE : BLACK);
      writePixel(output, outputX, outputY + 1, combination[2] ? GREEN : BLACK);
      writePixel(
        output,
        outputX + 1,
        outputY + 1,
        combination[3] ? GREEN : BLACK,
      );
    }
  }

  return output;
}

/**
 * Composites a source channel over a background channel.
 *
 * @param {number} source - Source channel value in the range 0–255.
 * @param {number} background - Background channel value in the range 0–255.
 * @param {number} alpha - Normalized source alpha in the range 0–1.
 * @returns {number} The composited channel value, rounded to an integer.
 */
function compositeChannel(source, background, alpha) {
  return Math.round(source * alpha + background * (1 - alpha));
}

/**
 * Selects the valid subpixel configuration with the smallest squared
 * Euclidean distance from the source color in linear-light RGB space.
 *
 * Converting sRGB channel values to linear light before comparison makes
 * the distance calculation better reflect differences in emitted light.
 * If multiple configurations have the same distance, the first one in
 * COMBINATIONS is retained.
 *
 * @param {number} r - Source red channel value in the range 0–255.
 * @param {number} g - Source green channel value in the range 0–255.
 * @param {number} b - Source blue channel value in the range 0–255.
 * @returns {number[]} The selected four-flag subpixel configuration.
 */
function findClosestCombination(r, g, b) {
  const target = [
    srgbToLinear(r / 255),
    srgbToLinear(g / 255),
    srgbToLinear(b / 255),
  ];

  let bestCombination = COMBINATIONS[0];
  let bestDistance = Infinity;

  for (const combination of COMBINATIONS) {
    const candidate = getAverageColor(combination);

    const dr = target[0] - candidate[0];
    const dg = target[1] - candidate[1];
    const db = target[2] - candidate[2];

    const distance = dr * dr + dg * dg + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestCombination = combination;
    }
  }

  return bestCombination;
}

/**
 * Calculates the average linear-light RGB contribution of a 2x2 subpixel block.
 *
 * Each active subpixel contributes one quarter of its linear-light color,
 * corresponding to its share of the four positions in the output block.
 * Disabled subpixels contribute zero because they render as black.
 *
 * @param {number[]} combination - Four binary flags in the order defined by COMBINATIONS.
 * @returns {number[]} Average linear-light RGB values, normalized to the range 0–1.
 */
function getAverageColor(combination) {
  const result = [0, 0, 0];

  for (let i = 0; i < combination.length; i++) {
    if (!combination[i]) {
      continue;
    }

    const color = SUBPIXEL_COLORS[i];

    result[0] += srgbToLinear(color[0] / 255) / 4;
    result[1] += srgbToLinear(color[1] / 255) / 4;
    result[2] += srgbToLinear(color[2] / 255) / 4;
  }

  return result;
}

/**
 * Converts a normalized sRGB channel value to linear-light intensity.
 *
 * Applies the inverse sRGB transfer function. Input and output values are
 * expected to be normalized to the range 0–1.
 *
 * @param {number} value - Normalized sRGB channel value.
 * @returns {number} Corresponding linear-light intensity.
 */
function srgbToLinear(value) {
  if (value <= 0.04045) {
    return value / 12.92;
  }

  return ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Writes a fully opaque RGB pixel to the output image.
 *
 * Coordinates are expressed in output-image pixels. The caller is responsible
 * for supplying valid coordinates and channel values.
 *
 * @param {ImageDataBuffer} output - Destination image buffer.
 * @param {number} x - Horizontal output coordinate.
 * @param {number} y - Vertical output coordinate.
 * @param {number[]} color - RGB channel values for the pixel.
 */
function writePixel(output, x, y, color) {
  const index = (y * output.width + x) * 4;

  output.data[index] = color[0];
  output.data[index + 1] = color[1];
  output.data[index + 2] = color[2];
  output.data[index + 3] = OPAQUE_ALPHA;
}

/**
 * Writes a fully transparent pixel to the output image.
 *
 * @param {ImageDataBuffer} output - Destination image buffer.
 * @param {number} x - Horizontal output coordinate.
 * @param {number} y - Vertical output coordinate.
 */
function writeTransparentPixel(output, x, y) {
  const index = (y * output.width + x) * 4;

  output.data[index] = 0;
  output.data[index + 1] = 0;
  output.data[index + 2] = 0;
  output.data[index + 3] = TRANSPARENT_ALPHA;
}
