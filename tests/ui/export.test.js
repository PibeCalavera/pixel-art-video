import { beforeEach, describe, expect, test, vi } from "vitest";
import { createExporter } from "../../src/ui/export.js";
class MockCanvasContext {
  constructor() {
    this.imageSmoothingEnabled = true;
    this.putImageDataCalls = [];
    this.clearRectCalls = [];
  }
  putImageData(imageData, x, y) {
    this.putImageDataCalls.push({ imageData, x, y });
  }
  clearRect(x, y, width, height) {
    this.clearRectCalls.push({ x, y, width, height });
  }
}
class MockCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.context = new MockCanvasContext();
  }
  getContext(type) {
    if (type !== "2d") {
      return null;
    }
    return this.context;
  }
  toBlob(callback, type) {
    callback(new Blob(["test"], { type }));
  }
}
const createdCanvases = [];
const links = [];
const documentMock = {
  createElement: vi.fn((type) => {
    if (type === "canvas") {
      const canvas = new MockCanvas();
      createdCanvases.push(canvas);
      return canvas;
    }
    if (type === "a") {
      const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      links.push(link);
      return link;
    }
    throw new Error(`Unsupported element type: ${type}`);
  }),
  body: { appendChild: vi.fn() },
};
globalThis.document = documentMock;
globalThis.URL = {
  createObjectURL: vi.fn(() => "blob:test"),
  revokeObjectURL: vi.fn(),
};
globalThis.ImageData = class MockImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};
function createCanvas() {
  return new MockCanvas();
}
function createImage(width, height, pixels) {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}
describe("createExporter", () => {
  beforeEach(() => {
    createdCanvases.length = 0;
    links.length = 0;
    documentMock.createElement.mockClear();
    documentMock.body.appendChild.mockClear();
    globalThis.URL.createObjectURL.mockClear();
    globalThis.URL.revokeObjectURL.mockClear();
  });
  test("creates an exporter", () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas);
    expect(exporter).toEqual({
      save: expect.any(Function),
      discard: expect.any(Function),
    });
  });
  test("saves an image as PNG", async () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas);
    const image = createImage(2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);
    await exporter.save(image);
    expect(createdCanvases).toHaveLength(1);
    const exportCanvas = createdCanvases[0];
    expect(exportCanvas.width).toBe(2);
    expect(exportCanvas.height).toBe(1);
    expect(exportCanvas.context.imageSmoothingEnabled).toBe(false);
    expect(exportCanvas.context.putImageDataCalls).toHaveLength(1);
    const [{ imageData, x, y }] = exportCanvas.context.putImageDataCalls;
    expect(imageData.width).toBe(2);
    expect(imageData.height).toBe(1);
    expect(Array.from(imageData.data)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(links).toHaveLength(1);
    expect(links[0].download).toBe("pixel-art.png");
    expect(links[0].href).toBe("blob:test");
    expect(links[0].click).toHaveBeenCalledTimes(1);
    expect(links[0].remove).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
  test("uses a custom filename", async () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas, { filename: "my-pixel-art.png" });
    await exporter.save(createImage(1, 1, [0, 0, 0, 255]));
    expect(links[0].download).toBe("my-pixel-art.png");
  });
  test("discards the preview", () => {
    const canvas = createCanvas();
    canvas.width = 16;
    canvas.height = 16;
    const exporter = createExporter(canvas);
    exporter.discard();
    expect(canvas.context.clearRectCalls).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
    ]);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
  test("rejects an invalid image", async () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas);
    await expect(exporter.save(null)).rejects.toThrow(
      "Export requires an image.",
    );
  });
  test("rejects invalid image dimensions", async () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas);
    await expect(
      exporter.save({ width: 0, height: 1, data: new Uint8ClampedArray(4) }),
    ).rejects.toThrow("Image width must be a positive integer.");
  });
  test("rejects invalid image data", async () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas);
    await expect(
      exporter.save({ width: 1, height: 1, data: new Uint8Array(4) }),
    ).rejects.toThrow("Image data must be a Uint8ClampedArray.");
  });
  test("rejects mismatched image data length", async () => {
    const canvas = createCanvas();
    const exporter = createExporter(canvas);
    await expect(
      exporter.save({ width: 2, height: 2, data: new Uint8ClampedArray(4) }),
    ).rejects.toThrow("Image data length does not match its dimensions.");
  });
  test("rejects an invalid filename", () => {
    const canvas = createCanvas();
    expect(() => createExporter(canvas, { filename: "" })).toThrow(
      "Filename must be a non-empty string.",
    );
  });
});
