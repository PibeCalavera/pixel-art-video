import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../src/processing/image.js";
import { paletteFromHex } from "../../src/processing/palette.js";
import { quantizeNearest } from "../../src/processing/quantization/nearest.js";

describe("quantizeNearest", () => {
  test("replaces pixels with the nearest palette colors", () => {
    const image = ImageDataBuffer.empty(2, 1);

    image.setPixel(0, 0, { r: 250, g: 10, b: 10, a: 255 });

    image.setPixel(1, 0, { r: 10, g: 10, b: 245, a: 255 });

    const palette = paletteFromHex(["#ff0000", "#0000ff"]);

    const result = quantizeNearest(image, { palette });

    expect(result.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    expect(result.getPixel(1, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  test("preserves the original alpha channel", () => {
    const image = ImageDataBuffer.empty(1, 1);

    image.setPixel(0, 0, { r: 250, g: 10, b: 10, a: 127 });

    const palette = paletteFromHex(["#ff0000"]);

    const result = quantizeNearest(image, { palette });

    expect(result.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 127 });
  });

  test("does not modify the original image", () => {
    const image = ImageDataBuffer.empty(1, 1);

    image.setPixel(0, 0, { r: 250, g: 10, b: 10, a: 255 });

    const originalPixel = image.getPixel(0, 0);

    const palette = paletteFromHex(["#000000"]);

    const result = quantizeNearest(image, { palette });

    expect(result).not.toBe(image);
    expect(result.data).not.toBe(image.data);
    expect(image.getPixel(0, 0)).toEqual(originalPixel);
  });

  test("requires a palette", () => {
    const image = ImageDataBuffer.empty(1, 1);

    expect(() => quantizeNearest(image)).toThrow(TypeError);
  });

  test("rejects a non-ImageDataBuffer input", () => {
    const palette = paletteFromHex(["#000000"]);

    expect(() => quantizeNearest(null, { palette })).toThrow(TypeError);
  });
});
