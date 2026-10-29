import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../../src/processing/image.js";
import { paletteFromHex } from "../../../src/processing/palette.js";
import { ditherFloydSteinberg } from "../../../src/processing/dithering/floyd-steinberg.js";

describe("ditherFloydSteinberg", () => {
  test("returns an image with the same dimensions", () => {
    const image = ImageDataBuffer.empty(4, 4);

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const result = ditherFloydSteinberg(image, { palette });

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

    const result = ditherFloydSteinberg(image, { palette });

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

  test("preserves the original alpha channel", () => {
    const image = ImageDataBuffer.empty(2, 1);

    image.setPixel(0, 0, { r: 100, g: 100, b: 100, a: 100 });

    image.setPixel(1, 0, { r: 200, g: 200, b: 200, a: 200 });

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const result = ditherFloydSteinberg(image, { palette });

    expect(result.getPixel(0, 0).a).toBe(100);
    expect(result.getPixel(1, 0).a).toBe(200);
  });

  test("does not modify the original image", () => {
    const image = ImageDataBuffer.empty(2, 2);

    image.setPixel(0, 0, { r: 100, g: 100, b: 100, a: 255 });

    const original = image.getPixel(0, 0);

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const result = ditherFloydSteinberg(image, { palette });

    expect(result).not.toBe(image);
    expect(result.data).not.toBe(image.data);
    expect(image.getPixel(0, 0)).toEqual(original);
  });

  test("requires a palette", () => {
    const image = ImageDataBuffer.empty(2, 2);

    expect(() => ditherFloydSteinberg(image)).toThrow(TypeError);
  });

  test("rejects a non-ImageDataBuffer input", () => {
    const palette = paletteFromHex(["#000000", "#ffffff"]);

    expect(() => ditherFloydSteinberg(null, { palette })).toThrow(TypeError);
  });
});
