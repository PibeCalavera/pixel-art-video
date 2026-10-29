import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../src/processing/image.js";
import { resizeNearest } from "../../src/processing/resize/nearest.js";

describe("resizeNearest", () => {
  test("resizes a 2x2 image to 4x4", () => {
    const image = ImageDataBuffer.empty(2, 2);

    image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });
    image.setPixel(1, 0, { r: 0, g: 255, b: 0, a: 255 });
    image.setPixel(0, 1, { r: 0, g: 0, b: 255, a: 255 });
    image.setPixel(1, 1, { r: 255, g: 255, b: 255, a: 255 });

    const result = resizeNearest(image, { width: 4, height: 4 });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);

    expect(result.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    expect(result.getPixel(3, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 });

    expect(result.getPixel(0, 3)).toEqual({ r: 0, g: 0, b: 255, a: 255 });

    expect(result.getPixel(3, 3)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  test("returns an independent copy when dimensions are unchanged", () => {
    const image = ImageDataBuffer.empty(2, 2);

    image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });

    const result = resizeNearest(image, { width: 2, height: 2 });

    expect(result).not.toBe(image);
    expect(result.data).not.toBe(image.data);
    expect(result.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  test("rejects invalid dimensions", () => {
    const image = ImageDataBuffer.empty(2, 2);

    expect(() => resizeNearest(image, { width: 0, height: 4 })).toThrow(
      RangeError,
    );

    expect(() => resizeNearest(image, { width: 4, height: -1 })).toThrow(
      RangeError,
    );

    expect(() => resizeNearest(image, { width: 4.5, height: 4 })).toThrow(
      RangeError,
    );
  });

  test("rejects a non-ImageDataBuffer input", () => {
    expect(() => resizeNearest(null, { width: 4, height: 4 })).toThrow(
      TypeError,
    );
  });
});
