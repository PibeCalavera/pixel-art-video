import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../../src/processing/image.js";
import { ditherRetroRGBK } from "../../../src/processing/dithering/rgbk-dither.js";

describe("ditherRetroRGBK", () => {
  test("doubles the source dimensions", () => {
    const image = ImageDataBuffer.empty(2, 3);

    const result = ditherRetroRGBK(image);

    expect(result.width).toBe(4);
    expect(result.height).toBe(6);
  });

  test("uses the expected RGB subpixel positions", () => {
    const image = ImageDataBuffer.empty(1, 1);

    // White should activate all four subpixels.
    image.setPixel(0, 0, { r: 255, g: 255, b: 255, a: 255 });

    const result = ditherRetroRGBK(image);

    expect(result.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    expect(result.getPixel(1, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 });

    expect(result.getPixel(0, 1)).toEqual({ r: 0, g: 255, b: 0, a: 255 });

    expect(result.getPixel(1, 1)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  test("preserves fully transparent source pixels", () => {
    const image = ImageDataBuffer.empty(1, 1);

    image.setPixel(0, 0, { r: 255, g: 255, b: 255, a: 0 });

    const result = ditherRetroRGBK(image);

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        expect(result.getPixel(x, y).a).toBe(0);
      }
    }
  });

  test("renders black subpixels as opaque black", () => {
    const image = ImageDataBuffer.empty(1, 1);

    // An opaque black pixel must produce opaque black subpixels.
    image.setPixel(0, 0, { r: 0, g: 0, b: 0, a: 255 });

    const result = ditherRetroRGBK(image);

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        expect(result.getPixel(x, y)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
      }
    }
  });

  test("does not modify the source image", () => {
    const image = ImageDataBuffer.empty(1, 1);

    image.setPixel(0, 0, { r: 120, g: 80, b: 40, a: 200 });

    const original = image.getPixel(0, 0);

    ditherRetroRGBK(image);

    expect(image.getPixel(0, 0)).toEqual(original);
  });

  test("rejects invalid image data", () => {
    expect(() => ditherRetroRGBK(null)).toThrow(TypeError);
    expect(() => ditherRetroRGBK({ width: 0, height: 1, data: [] })).toThrow(
      TypeError,
    );
  });
});
