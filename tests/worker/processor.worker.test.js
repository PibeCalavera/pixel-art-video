import { beforeEach, describe, expect, test, vi } from "vitest";
const messageListeners = [];
const postMessage = vi.fn();
globalThis.self = {
  addEventListener: vi.fn((type, listener) => {
    if (type === "message") {
      messageListeners.push(listener);
    }
  }),
  postMessage,
};
await import("../../src/worker/processor.worker.js");
function sendMessage(data) {
  const listener = messageListeners[0];
  if (!listener) {
    throw new Error("Worker message listener was not registered.");
  }
  listener({ data });
}
function createImage(width, height, pixels) {
  return { width, height, data: new Uint8ClampedArray(pixels).buffer };
}
function createBlackAndWhitePalette() {
  return {
    name: "Black and White",
    colors: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
  };
}
describe("processor worker", () => {
  beforeEach(() => {
    postMessage.mockClear();
  });
  test("processes an image successfully", () => {
    sendMessage({
      id: "test-1",
      image: createImage(
        2,
        2,
        [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
      ),
      options: { resize: { algorithm: "nearest", width: 1, height: 1 } },
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, transferList] = postMessage.mock.calls[0];
    expect(message.id).toBe("test-1");
    expect(message.type).toBe("success");
    expect(message.image.width).toBe(1);
    expect(message.image.height).toBe(1);
    expect(message.image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(message.image.data.length).toBe(4);
    expect(transferList).toEqual([message.image.data.buffer]);
  });
  test("can process an image without optional stages", () => {
    sendMessage({
      id: "test-2",
      image: createImage(1, 1, [128, 64, 32, 255]),
      options: {},
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message).toEqual(
      expect.objectContaining({ id: "test-2", type: "success" }),
    );
    expect(message.image.width).toBe(1);
    expect(message.image.height).toBe(1);
    expect(Array.from(message.image.data)).toEqual([128, 64, 32, 255]);
  });
  test("resolves dithering algorithms through the worker", () => {
    sendMessage({
      id: "test-3",
      image: createImage(
        2,
        2,
        [0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 64, 64, 64, 255],
      ),
      options: { dither: { algorithm: "none" } },
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message.id).toBe("test-3");
    expect(message.type).toBe("success");
    expect(Array.from(message.image.data)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 64, 64, 64, 255,
    ]);
  });
  test("quantizes when dithering is disabled", () => {
    const palette = createBlackAndWhitePalette();
    sendMessage({
      id: "test-6",
      image: createImage(1, 1, [128, 128, 128, 255]),
      options: {
        quantize: { algorithm: "nearest", palette },
        dither: { algorithm: "none", palette },
      },
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message.id).toBe("test-6");
    expect(message.type).toBe("success");
    expect(Array.from(message.image.data)).toEqual([255, 255, 255, 255]);
  });
  test("does not quantize before Bayer dithering", () => {
    const palette = createBlackAndWhitePalette();
    sendMessage({
      id: "test-7",
      image: createImage(1, 1, [150, 150, 150, 255]),
      options: {
        quantize: { algorithm: "nearest", palette },
        dither: { algorithm: "bayer", palette, strength: 1 },
      },
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message.id).toBe("test-7");
    expect(message.type).toBe("success");
    /* * Bayer operates directly on the original 150 gray value. * * At (0, 0), the 4x4 Bayer threshold produces a negative * adjustment, moving the value toward black before palette * selection. * * 150 would normally quantize to white with this palette, * but Bayer dithering changes it to a value near 30, which * quantizes to black. */ expect(
      Array.from(message.image.data),
    ).toEqual([0, 0, 0, 255]);
  });
  test("returns an error for an unknown algorithm", () => {
    sendMessage({
      id: "test-4",
      image: createImage(1, 1, [128, 128, 128, 255]),
      options: { resize: { algorithm: "unknown", width: 2, height: 2 } },
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message.id).toBe("test-4");
    expect(message.type).toBe("error");
    expect(message.error.name).toBe("RangeError");
    expect(message.error.message).toContain(
      'Unknown resize algorithm: "unknown".',
    );
  });
  test("returns an error when the image is missing", () => {
    sendMessage({ id: "test-5", options: {} });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message] = postMessage.mock.calls[0];
    expect(message.id).toBe("test-5");
    expect(message.type).toBe("error");
    expect(message.error.name).toBe("TypeError");
    expect(message.error.message).toBe("Worker requires an image.");
  });
});
