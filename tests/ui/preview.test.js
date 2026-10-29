import { beforeEach, describe, expect, test, vi } from "vitest";

import { createPreview } from "../../src/ui/preview.js";

class MockCanvasElement {
  constructor() {
    this.width = 0;
    this.height = 0;

    this.context = {
      imageSmoothingEnabled: true,
      putImageData: vi.fn(),
      clearRect: vi.fn(),
    };
  }

  getContext(type) {
    if (type !== "2d") {
      return null;
    }

    return this.context;
  }
}

class MockImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

globalThis.HTMLCanvasElement = MockCanvasElement;
globalThis.ImageData = MockImageData;

function createCanvas() {
  return new MockCanvasElement();
}

function createImage(
  width = 2,
  height = 2,
  pixels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
) {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

describe("preview", () => {
  let canvas;
  let preview;

  beforeEach(() => {
    canvas = createCanvas();
    preview = createPreview(canvas);
  });

  test("creates a preview for a canvas", () => {
    expect(preview).toHaveProperty("render");
    expect(preview).toHaveProperty("clear");
  });

  test("disables image smoothing", () => {
    expect(canvas.context.imageSmoothingEnabled).toBe(false);
  });

  test("renders an image to the canvas", () => {
    const image = createImage();

    preview.render(image);

    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);

    expect(canvas.context.putImageData).toHaveBeenCalledTimes(1);

    const [imageData, x, y] = canvas.context.putImageData.mock.calls[0];

    expect(imageData).toBeInstanceOf(MockImageData);
    expect(imageData.width).toBe(2);
    expect(imageData.height).toBe(2);
    expect(Array.from(imageData.data)).toEqual(Array.from(image.data));

    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  test("keeps image smoothing disabled when rendering", () => {
    canvas.context.imageSmoothingEnabled = true;

    preview.render(createImage());

    expect(canvas.context.imageSmoothingEnabled).toBe(false);
  });

  test("clears the canvas", () => {
    canvas.width = 32;
    canvas.height = 16;

    preview.clear();

    expect(canvas.context.clearRect).toHaveBeenCalledWith(0, 0, 32, 16);
  });

  test("rejects a non-canvas element", () => {
    expect(() => createPreview({})).toThrow(TypeError);
  });

  test("rejects a missing image", () => {
    expect(() => preview.render(null)).toThrow(TypeError);
  });

  test("rejects invalid image dimensions", () => {
    expect(() =>
      preview.render({ width: 0, height: 2, data: new Uint8ClampedArray(16) }),
    ).toThrow(RangeError);
  });

  test("rejects invalid image data", () => {
    expect(() =>
      preview.render({ width: 2, height: 2, data: new Uint8Array(16) }),
    ).toThrow(TypeError);
  });

  test("rejects image data with incorrect length", () => {
    expect(() =>
      preview.render({ width: 2, height: 2, data: new Uint8ClampedArray(4) }),
    ).toThrow(RangeError);
  });
});
