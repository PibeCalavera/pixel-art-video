import { findNearestColor } from "../palette.js";
import { ImageDataBuffer } from "../image.js";

/*
 * Ordered dithering matrices.
 *
 * Each matrix defines the spatial threshold order used by Bayer dithering.
 */
const BAYER_MATRICES = {
  2: [
    [0, 2],
    [3, 1],
  ],

  4: [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ],

  8: [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ],
};

/**
 * Apply ordered Bayer dithering using a configurable matrix size.
 *
 * @param {ImageDataBuffer} image
 * @param {object} options
 * @returns {ImageDataBuffer}
 */
export function ditherBayer(image, options = {}) {
  assertImage(image);

  const palette = options.palette;

  if (!palette) {
    throw new TypeError("ditherBayer requires a palette.");
  }

  const strength = validateStrength(options.strength ?? 1);
  const matrixSize = validateMatrixSize(options.matrixSize ?? 4);

  const matrix = BAYER_MATRICES[matrixSize];
  const matrixMax = matrixSize * matrixSize;

  const result = ImageDataBuffer.clone(image);
  const data = result.data;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;

      const matrixValue = matrix[y % matrixSize][x % matrixSize];

      /*
       * Normalize the matrix value to a 0..1 threshold.
       *
       * The offset centers the threshold within each matrix cell.
       */
      const threshold = (matrixValue + 0.5) / matrixMax;

      /*
       * Adjust the input color according to the Bayer threshold
       * before selecting the nearest palette color.
       */
      const adjustment = (threshold - 0.5) * 255 * strength;

      const color = {
        r: clampChannel(data[offset] + adjustment),
        g: clampChannel(data[offset + 1] + adjustment),
        b: clampChannel(data[offset + 2] + adjustment),
      };

      const nearest = findNearestColor(color, palette);

      data[offset] = nearest.r;
      data[offset + 1] = nearest.g;
      data[offset + 2] = nearest.b;
    }
  }

  return result;
}

/**
 * Return the matrix sizes supported by the Bayer implementation.
 *
 * @returns {number[]}
 */
export function getBayerMatrixSizes() {
  return Object.keys(BAYER_MATRICES).map(Number);
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("ditherBayer expects an ImageDataBuffer.");
  }
}

function validateMatrixSize(value) {
  if (!Number.isInteger(value) || !BAYER_MATRICES[value]) {
    throw new RangeError(`Unsupported Bayer matrix size: ${value}.`);
  }

  return value;
}

function validateStrength(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Dither strength must be a non-negative number.");
  }

  return value;
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
