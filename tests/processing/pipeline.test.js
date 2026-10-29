import { describe, expect, test } from "vitest";

import { ImageDataBuffer } from "../../src/processing/image.js";
import { createPipeline } from "../../src/processing/pipeline.js";

import { resizeNearest } from "../../src/processing/resize/nearest.js";
import { quantizeNearest } from "../../src/processing/quantization/nearest.js";

import { ditherNone } from "../../src/processing/dithering/none.js";
import { ditherBayer } from "../../src/processing/dithering/bayer.js";
import { ditherFloydSteinberg } from "../../src/processing/dithering/floyd-steinberg.js";

import { paletteFromHex } from "../../src/processing/palette.js";

describe("processing pipeline", () => {
  test("processes an image through resize, quantization and dithering", () => {
    const image = ImageDataBuffer.empty(2, 2);

    image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });
    image.setPixel(1, 0, { r: 0, g: 255, b: 0, a: 255 });
    image.setPixel(0, 1, { r: 0, g: 0, b: 255, a: 255 });
    image.setPixel(1, 1, { r: 255, g: 255, b: 255, a: 255 });

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const pipeline = createPipeline({
      resize: resizeNearest,
      quantize: quantizeNearest,
      dither: ditherNone,
    });

    const result = pipeline.process(image, {
      resize: { width: 4, height: 4 },
      quantize: { palette },
    });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.data.length).toBe(4 * 4 * 4);
  });

  test("processes an image using Bayer dithering", () => {
    const image = ImageDataBuffer.empty(4, 4);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        image.setPixel(x, y, { r: 128, g: 128, b: 128, a: 255 });
      }
    }

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const pipeline = createPipeline({ dither: ditherBayer });

    const result = pipeline.process(image, { dither: { palette } });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  test("processes an image using Floyd-Steinberg dithering", () => {
    const image = ImageDataBuffer.empty(4, 4);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        image.setPixel(x, y, { r: 128, g: 128, b: 128, a: 255 });
      }
    }

    const palette = paletteFromHex(["#000000", "#ffffff"]);

    const pipeline = createPipeline({ dither: ditherFloydSteinberg });

    const result = pipeline.process(image, { dither: { palette } });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });
});
