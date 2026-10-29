import { describe, expect, test } from "vitest";

import {
  createInitialState,
  createDefaultProcessingOptions,
  updateProcessingOptions,
  setOriginalImage,
  setProcessingStatus,
  setProcessingError,
  setProcessedImage,
  setRealtimePreview,
} from "../../src/app/state.js";

describe("application state", () => {
  test("creates the initial state", () => {
    const state = createInitialState();

    expect(state.image.original).toBeNull();
    expect(state.image.result).toBeNull();

    expect(state.processing.status).toBe("idle");
    expect(state.processing.error).toBeNull();

    expect(state.processing.options.resize.algorithm).toBe("nearest");
    expect(state.processing.options.quantize.algorithm).toBe("nearest");
    expect(state.processing.options.dither.algorithm).toBe("none");

    expect(state.preview.realtime).toBe(true);
  });

  test("creates independent default processing options", () => {
    const first = createDefaultProcessingOptions();
    const second = createDefaultProcessingOptions();

    first.resize.width = 32;

    expect(second.resize.width).toBeNull();
  });

  test("updates processing options without replacing unrelated options", () => {
    const state = createInitialState();

    const updated = updateProcessingOptions(state, {
      resize: { width: 64, height: 64 },
      dither: { algorithm: "bayer", strength: 0.5 },
    });

    expect(updated.processing.options.resize).toEqual({
      algorithm: "nearest",
      width: 64,
      height: 64,
    });

    expect(updated.processing.options.dither).toEqual({
      algorithm: "bayer",
      strength: 0.5,
      palette: null,
    });

    expect(updated.processing.options.quantize.algorithm).toBe("nearest");

    expect(state.processing.options.resize.width).toBeNull();
    expect(state.processing.options.dither.algorithm).toBe("none");
  });

  test("sets the original image and clears the previous result", () => {
    const original = { width: 100, height: 50 };
    const previousResult = { width: 32, height: 16 };

    const state = createInitialState();

    const withResult = setProcessedImage(
      { ...state, image: { original, result: previousResult } },
      previousResult,
    );

    const updated = setOriginalImage(withResult, original);

    expect(updated.image.original).toBe(original);
    expect(updated.image.result).toBeNull();
    expect(updated.processing.status).toBe("idle");
    expect(updated.processing.error).toBeNull();
  });

  test("sets processing status", () => {
    const state = createInitialState();

    const processing = setProcessingStatus(state, "processing");

    expect(processing.processing.status).toBe("processing");
    expect(processing.processing.error).toBeNull();
  });

  test("sets a processing error", () => {
    const state = createInitialState();
    const error = new Error("Processing failed.");

    const updated = setProcessingError(state, error);

    expect(updated.processing.status).toBe("error");
    expect(updated.processing.error).toEqual({
      name: "Error",
      message: "Processing failed.",
    });
  });

  test("sets the processed image and marks processing as successful", () => {
    const state = createInitialState();
    const result = { width: 32, height: 32 };

    const updated = setProcessedImage(state, result);

    expect(updated.image.result).toBe(result);
    expect(updated.processing.status).toBe("success");
    expect(updated.processing.error).toBeNull();
  });

  test("enables and disables realtime preview", () => {
    const state = createInitialState();

    const disabled = setRealtimePreview(state, false);

    expect(disabled.preview.realtime).toBe(false);

    const enabled = setRealtimePreview(disabled, true);

    expect(enabled.preview.realtime).toBe(true);
  });

  test("rejects an invalid processing status", () => {
    const state = createInitialState();

    expect(() => setProcessingStatus(state, "unknown")).toThrow(RangeError);
  });

  test("rejects invalid realtime preview values", () => {
    const state = createInitialState();

    expect(() => setRealtimePreview(state, "true")).toThrow(TypeError);
  });

  test("rejects invalid processing options", () => {
    const state = createInitialState();

    expect(() => updateProcessingOptions(state, null)).toThrow(TypeError);
  });
});
