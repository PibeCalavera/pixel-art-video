import { ImageDataBuffer } from "../image.js";

/**
 * Resize an image using nearest-neighbor interpolation.
 *
 * @param {ImageDataBuffer} image
 * @param {{ width: number, height: number }} options
 * @returns {ImageDataBuffer}
 */
export function resizeNearest(image, options = {}) {
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

  const xRatio = sourceWidth / width;
  const yRatio = sourceHeight / height;

  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * yRatio));

    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * xRatio));

      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;

      targetData[targetOffset] = sourceData[sourceOffset];
      targetData[targetOffset + 1] = sourceData[sourceOffset + 1];
      targetData[targetOffset + 2] = sourceData[sourceOffset + 2];
      targetData[targetOffset + 3] = sourceData[sourceOffset + 3];
    }
  }

  return result;
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("resizeNearest expects an ImageDataBuffer.");
  }
}

function validateDimension(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }

  return value;
}
