import { findNearestColor } from "../palette.js";
import { ImageDataBuffer } from "../image.js";

/**
 * Apply Floyd-Steinberg error-diffusion dithering.
 * @param {ImageDataBuffer} image
 * @param {{
 *   palette: import("../palette.js").Palette,
 *   strength?: number
 * }} options
 * @returns {ImageDataBuffer}
 */
export function ditherFloydSteinberg(image, options = {}) {
  assertImage(image);

  const palette = options.palette;
  if (!palette) {
    throw new TypeError("ditherFloydSteinberg requires a palette.");
  }

  const strength = validateStrength(options.strength ?? 1);
  const result = ImageDataBuffer.clone(image);
  const { width, height, data } = result;
  const errors = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const offset = pixelIndex * 4;
      const errorOffset = pixelIndex * 3;

      const color = {
        r: clampChannel(data[offset] + errors[errorOffset]),
        g: clampChannel(data[offset + 1] + errors[errorOffset + 1]),
        b: clampChannel(data[offset + 2] + errors[errorOffset + 2]),
      };

      const nearest = findNearestColor(color, palette);

      data[offset] = nearest.r;
      data[offset + 1] = nearest.g;
      data[offset + 2] = nearest.b;

      const error = {
        r: (color.r - nearest.r) * strength,
        g: (color.g - nearest.g) * strength,
        b: (color.b - nearest.b) * strength,
      };

      distributeError(errors, width, height, x + 1, y, error, 7 / 16);

      distributeError(errors, width, height, x - 1, y + 1, error, 3 / 16);

      distributeError(errors, width, height, x, y + 1, error, 5 / 16);

      distributeError(errors, width, height, x + 1, y + 1, error, 1 / 16);
    }
  }

  return result;
}

function distributeError(errors, width, height, x, y, error, factor) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }

  const offset = (y * width + x) * 3;

  errors[offset] += error.r * factor;
  errors[offset + 1] += error.g * factor;
  errors[offset + 2] += error.b * factor;
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function validateStrength(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Dither strength must be a non-negative number.");
  }

  return value;
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("ditherFloydSteinberg expects an ImageDataBuffer.");
  }
}
