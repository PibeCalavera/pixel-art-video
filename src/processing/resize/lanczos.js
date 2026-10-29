import { ImageDataBuffer } from "../image.js";

const LANCZOS_RADIUS = 3;

/**
 * Resize an image using Lanczos interpolation.
 *
 * @param {ImageDataBuffer} image
 * @param {{ width: number, height: number }} options
 * @returns {ImageDataBuffer}
 */
export function resizeLanczos(image, options = {}) {
  assertImage(image);

  const width = validateDimension(options.width, "width");
  const height = validateDimension(options.height, "height");

  if (image.width === width && image.height === height) {
    return ImageDataBuffer.clone(image);
  }

  const horizontal = createContributors(image.width, width, LANCZOS_RADIUS);

  const vertical = createContributors(image.height, height, LANCZOS_RADIUS);

  const intermediate = ImageDataBuffer.empty(width, image.height);
  const result = ImageDataBuffer.empty(width, height);

  resizeHorizontal(image, intermediate, horizontal);
  resizeVertical(intermediate, result, vertical);

  return result;
}

function resizeHorizontal(source, target, contributors) {
  const sourceWidth = source.width;
  const sourceData = source.data;
  const targetData = target.data;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < target.width; x++) {
      const targetOffset = (y * target.width + x) * 4;
      const samples = contributors[x];

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;

      for (const sample of samples) {
        const offset = (y * sourceWidth + sample.index) * 4;
        const weight = sample.weight;

        r += sourceData[offset] * weight;
        g += sourceData[offset + 1] * weight;
        b += sourceData[offset + 2] * weight;
        a += sourceData[offset + 3] * weight;
        weightSum += weight;
      }

      targetData[targetOffset] = clampChannel(r / weightSum);
      targetData[targetOffset + 1] = clampChannel(g / weightSum);
      targetData[targetOffset + 2] = clampChannel(b / weightSum);
      targetData[targetOffset + 3] = clampChannel(a / weightSum);
    }
  }
}

function resizeVertical(source, target, contributors) {
  const sourceWidth = source.width;
  const sourceData = source.data;
  const targetData = target.data;

  for (let y = 0; y < target.height; y++) {
    const samples = contributors[y];

    for (let x = 0; x < target.width; x++) {
      const targetOffset = (y * target.width + x) * 4;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;

      for (const sample of samples) {
        const offset = (sample.index * sourceWidth + x) * 4;
        const weight = sample.weight;

        r += sourceData[offset] * weight;
        g += sourceData[offset + 1] * weight;
        b += sourceData[offset + 2] * weight;
        a += sourceData[offset + 3] * weight;
        weightSum += weight;
      }

      targetData[targetOffset] = clampChannel(r / weightSum);
      targetData[targetOffset + 1] = clampChannel(g / weightSum);
      targetData[targetOffset + 2] = clampChannel(b / weightSum);
      targetData[targetOffset + 3] = clampChannel(a / weightSum);
    }
  }
}

function createContributors(sourceSize, targetSize, radius) {
  const scale = sourceSize / targetSize;
  const contributors = new Array(targetSize);

  for (let target = 0; target < targetSize; target++) {
    const sourcePosition = (target + 0.5) * scale - 0.5;

    const effectiveRadius = scale > 1 ? radius * scale : radius;

    const left = Math.ceil(sourcePosition - effectiveRadius);
    const right = Math.floor(sourcePosition + effectiveRadius);

    const samples = [];

    for (let source = left; source <= right; source++) {
      const distance = (source - sourcePosition) / Math.max(scale, 1);

      const weight = lanczos(distance, radius);

      if (weight === 0) {
        continue;
      }

      samples.push({ index: clampIndex(source, sourceSize), weight });
    }

    contributors[target] = samples;
  }

  return contributors;
}

function lanczos(value, radius) {
  if (value === 0) {
    return 1;
  }

  if (Math.abs(value) >= radius) {
    return 0;
  }

  const piValue = Math.PI * value;

  return (
    (Math.sin(piValue) / piValue) *
    (Math.sin(piValue / radius) / (piValue / radius))
  );
}

function clampIndex(value, size) {
  return Math.max(0, Math.min(size - 1, value));
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function validateDimension(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }

  return value;
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("resizeLanczos expects an ImageDataBuffer.");
  }
}
