import { describe, expect, test } from "vitest";

import {
  getResizeAlgorithm,
  getQuantizationAlgorithm,
  getDitheringAlgorithm,
} from "../../src/processing/algorithms.js";

import { resizeNearest } from "../../src/processing/resize/nearest.js";
import { quantizeNearest } from "../../src/processing/quantization/nearest.js";

import { ditherNone } from "../../src/processing/dithering/none.js";
import { ditherBayer } from "../../src/processing/dithering/bayer.js";
import { ditherFloydSteinberg } from "../../src/processing/dithering/floyd-steinberg.js";

describe("processing algorithms", () => {
  test("resolves the nearest resize algorithm", () => {
    expect(getResizeAlgorithm("nearest")).toBe(resizeNearest);
  });

  test("resolves the nearest quantization algorithm", () => {
    expect(getQuantizationAlgorithm("nearest")).toBe(quantizeNearest);
  });

  test("resolves the none dithering algorithm", () => {
    expect(getDitheringAlgorithm("none")).toBe(ditherNone);
  });

  test("resolves the Bayer dithering algorithm", () => {
    expect(getDitheringAlgorithm("bayer")).toBe(ditherBayer);
  });

  test("resolves the Floyd-Steinberg dithering algorithm", () => {
    expect(getDitheringAlgorithm("floyd-steinberg")).toBe(ditherFloydSteinberg);
  });

  test("rejects an unknown resize algorithm", () => {
    expect(() => getResizeAlgorithm("unknown")).toThrow(RangeError);
  });

  test("rejects an unknown quantization algorithm", () => {
    expect(() => getQuantizationAlgorithm("unknown")).toThrow(RangeError);
  });

  test("rejects an unknown dithering algorithm", () => {
    expect(() => getDitheringAlgorithm("unknown")).toThrow(RangeError);
  });

  test("rejects an invalid algorithm name", () => {
    expect(() => getDitheringAlgorithm("")).toThrow(TypeError);

    expect(() => getDitheringAlgorithm(null)).toThrow(TypeError);
  });
});
