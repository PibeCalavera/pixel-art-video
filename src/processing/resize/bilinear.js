import { ImageDataBuffer } from "../image.js";

/**
 * Resize an image using bilinear interpolation.
 *
 * @param {ImageDataBuffer} image
 * @param {{ width: number, height: number }} options
 * @returns {ImageDataBuffer}
 */
export function resizeBilinear(image, options = {}) {
  assertImage(image);

  const width = validateDimension(options.width, "width");
  const height = validateDimension(options.height, "height");

  if (image.width === width && image.height === height) {
    return ImageDataBuffer.clone(image);
  }

  const result = ImageDataBuffer.empty(width, height);

  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const sourceData = image.data;
  const targetData = result.data;

  const xScale = sourceWidth / width;
  const yScale = sourceHeight / height;

  for (let y = 0; y < height; y++) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.floor(sourceY);
    const y1 = y0 + 1;
    const fy = sourceY - y0;

    const sy0 = clampIndex(y0, sourceHeight);
    const sy1 = clampIndex(y1, sourceHeight);

    for (let x = 0; x < width; x++) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.floor(sourceX);
      const x1 = x0 + 1;
      const fx = sourceX - x0;

      const sx0 = clampIndex(x0, sourceWidth);
      const sx1 = clampIndex(x1, sourceWidth);

      const offset00 = (sy0 * sourceWidth + sx0) * 4;
      const offset10 = (sy0 * sourceWidth + sx1) * 4;
      const offset01 = (sy1 * sourceWidth + sx0) * 4;
      const offset11 = (sy1 * sourceWidth + sx1) * 4;

      const targetOffset = (y * width + x) * 4;

      for (let channel = 0; channel < 4; channel++) {
        const top =
          sourceData[offset00 + channel] * (1 - fx) +
          sourceData[offset10 + channel] * fx;

        const bottom =
          sourceData[offset01 + channel] * (1 - fx) +
          sourceData[offset11 + channel] * fx;

        targetData[targetOffset + channel] = Math.round(
          top * (1 - fy) + bottom * fy,
        );
      }
    }
  }

  return result;
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("resizeBilinear expects an ImageDataBuffer.");
  }
}

function validateDimension(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }

  return value;
}

function clampIndex(value, size) {
  return Math.max(0, Math.min(size - 1, value));
}
