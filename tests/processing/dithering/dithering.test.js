import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../../src/processing/image.js";
import { ditherNone } from "../../../src/processing/dithering/none.js";

describe("ditherNone", () => {
  test("returns an independent copy of the image", () => {
    const image = ImageDataBuffer.empty(2, 1);

    image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });

    image.setPixel(1, 0, { r: 0, g: 255, b: 0, a: 255 });

    const result = ditherNone(image);

    expect(result).not.toBe(image);
    expect(result.data).not.toBe(image.data);

    expect(result.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    expect(result.getPixel(1, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  test("does not modify the original image", () => {
    const image = ImageDataBuffer.empty(1, 1);

    image.setPixel(0, 0, { r: 120, g: 80, b: 40, a: 200 });

    const result = ditherNone(image);

    result.setPixel(0, 0, { r: 0, g: 0, b: 0, a: 0 });

    expect(image.getPixel(0, 0)).toEqual({ r: 120, g: 80, b: 40, a: 200 });
  });

  test("preserves image dimensions", () => {
    const image = ImageDataBuffer.empty(3, 2);

    const result = ditherNone(image);

    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
  });

  test("rejects a non-ImageDataBuffer input", () => {
    expect(() => ditherNone(null)).toThrow(TypeError);
  });
});
