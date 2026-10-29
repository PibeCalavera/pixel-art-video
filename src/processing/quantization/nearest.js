import { findNearestColor } from "../palette.js";
import { ImageDataBuffer } from "../image.js";

/** * Quantize an image by replacing each pixel with the nearest * color from the provided palette.
 * @param {ImageDataBuffer} image
 * @param {{ palette: import("../palette.js").Palette }} options
 * @returns {ImageDataBuffer}
 */

export function quantizeNearest(image, options = {}) {
  assertImage(image);
  const palette = options.palette;
  if (!palette) {
    throw new TypeError("quantizeNearest requires a palette.");
  }

  const result = ImageDataBuffer.clone(image);

  const data = result.data;

  for (let i = 0; i < data.length; i += 4) {
    const color = {
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      a: data[i + 3],
    };

    const nearest = findNearestColor(color, palette);
    data[i] = nearest.r;
    data[i + 1] = nearest.g;
    data[i + 2] = nearest.b;
    data[i + 3] = color.a;
  }
  return result;
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("quantizeNearest expects an ImageDataBuffer.");
  }
}
