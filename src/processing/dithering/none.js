import { ImageDataBuffer } from "../image.js";

/**
 * Apply no dithering.
 *
 * The image is cloned so that every processing stage returns
 * a new ImageDataBuffer and never mutates its input.
 *
 * @param {ImageDataBuffer} image
 * @returns {ImageDataBuffer}
 */
export function ditherNone(image) {
  assertImage(image);

  return ImageDataBuffer.clone(image);
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("ditherNone expects an ImageDataBuffer.");
  }
}
