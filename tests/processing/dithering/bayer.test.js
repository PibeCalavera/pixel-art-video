import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../../src/processing/image.js";
import { ditherBayer } from "../../../src/processing/dithering/bayer.js";
import { paletteFromHex } from "../../../src/processing/palette.js";

describe("ditherBayer", () => {
  test("returns an image with the same dimensions", () => {
    const image = ImageDataBuffer.empty(4, 4);

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const result = ditherBayer(image, { palette });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  test("uses colors from the provided palette", () => {
    const image = ImageDataBuffer.empty(4, 4);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        image.setPixel(x, y, { r: 128, g: 128, b: 128, a: 255 });
      }
    }

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const result = ditherBayer(image, { palette });

    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const pixel = result.getPixel(x, y);

        const isBlack = pixel.r === 0 && pixel.g === 0 && pixel.b === 0;

        const isWhite = pixel.r === 255 && pixel.g === 255 && pixel.b === 255;

        expect(isBlack || isWhite).toBe(true);
        expect(pixel.a).toBe(255);
      }
    }
  });

  test("does not modify the original image", () => {
    const image = ImageDataBuffer.empty(2, 2);

    image.setPixel(0, 0, { r: 100, g: 100, b: 100, a: 255 });

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const original = image.getPixel(0, 0);

    const result = ditherBayer(image, { palette });

    expect(result).not.toBe(image);
    expect(result.data).not.toBe(image.data);
    expect(image.getPixel(0, 0)).toEqual(original);
  });

  test("requires a palette", () => {
    const image = ImageDataBuffer.empty(2, 2);

    expect(() => ditherBayer(image)).toThrow(TypeError);
  });

  test("rejects a non-ImageDataBuffer input", () => {
    const palette = paletteFromHex(["#000000", "#ffffff"]);

    expect(() => ditherBayer(null, { palette })).toThrow(TypeError);
  });
});
