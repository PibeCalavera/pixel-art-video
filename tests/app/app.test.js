import { beforeEach, describe, expect, test, vi } from "vitest";

import { createApp } from "../../src/app/app.js";

class MockWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = { message: new Set(), error: new Set() };
    this.postMessage = vi.fn();
    this.terminate = vi.fn();

    MockWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type].delete(listener);
  }

  emitMessage(data) {
    for (const listener of this.listeners.message) {
      listener({ data });
    }
  }

  emitError(error) {
    for (const listener of this.listeners.error) {
      listener(error);
    }
  }
}

const TEST_WORKER_URL = "worker.js";

function createImage(
  width = 2,
  height = 2,
  pixels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
) {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

beforeEach(() => {
  MockWorker.instances.length = 0;
});

describe("application controller", () => {
  test("creates an application with the initial state", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const state = app.getState();

    expect(state.image.original).toBeNull();
    expect(state.image.result).toBeNull();
    expect(state.processing.status).toBe("idle");
    expect(state.preview.realtime).toBe(true);

    const worker = MockWorker.instances[0];

    expect(worker.url).toBe(TEST_WORKER_URL);
    expect(worker.options).toEqual({ type: "module" });
  });

  test("sets the original image", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const image = createImage();

    app.setOriginalImage(image);

    expect(app.getState().image.original).toBe(image);
    expect(app.getState().image.result).toBeNull();
    expect(app.getState().processing.status).toBe("idle");
  });

  test("notifies subscribers when state changes", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const listener = vi.fn();

    app.subscribe(listener);
    app.setRealtimePreview(false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(app.getState());
  });

  test("allows subscribers to unsubscribe", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const listener = vi.fn();

    const unsubscribe = app.subscribe(listener);

    unsubscribe();
    app.setRealtimePreview(false);

    expect(listener).not.toHaveBeenCalled();
  });

  test("updates processing options", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    app.updateProcessingOptions({
      resize: { width: 64, height: 64 },
      dither: { algorithm: "bayer" },
    });

    const options = app.getState().processing.options;

    expect(options.resize.width).toBe(64);
    expect(options.resize.height).toBe(64);
    expect(options.dither.algorithm).toBe("bayer");
  });

  test("sends the original image to the worker", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];
    const image = createImage();

    app.setOriginalImage(image);

    const requestId = app.process({
      resize: { algorithm: "nearest", width: 1, height: 1 },
    });

    expect(requestId).toBe("request-1");
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    const [message, transferList] = worker.postMessage.mock.calls[0];

    expect(message.id).toBe("request-1");
    expect(message.image.width).toBe(2);
    expect(message.image.height).toBe(2);
    expect(message.image.data).toBeInstanceOf(ArrayBuffer);

    expect(transferList).toEqual([message.image.data]);

    expect(app.getState().processing.status).toBe("processing");
  });

  test("merges processing options without replacing nested defaults", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    app.setOriginalImage(createImage());

    app.process({
      resize: { width: 64, height: 64 },
      dither: { strength: 0.5 },
    });

    const worker = MockWorker.instances[0];
    const [message] = worker.postMessage.mock.calls[0];

    expect(message.options.resize).toEqual({
      algorithm: "nearest",
      width: 64,
      height: 64,
    });

    expect(message.options.quantize).toEqual({
      algorithm: "nearest",
      palette: null,
    });

    expect(message.options.dither).toEqual({
      algorithm: "none",
      strength: 0.5,
      palette: null,
    });
  });

  test("updates state through processing transitions", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    app.setOriginalImage(createImage());

    const states = [];

    app.subscribe((state) => {
      states.push(state.processing.status);
    });

    app.process();

    expect(states).toEqual(["processing"]);
    expect(app.getState().processing.status).toBe("processing");
    expect(app.getState().processing.error).toBeNull();
  });

  test("rejects processing without an original image", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    expect(() => app.process()).toThrow(
      "Cannot process without an original image.",
    );
  });

  test("stores a successful worker result", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());
    app.process();

    const resultData = new Uint8ClampedArray([10, 20, 30, 255]);

    worker.emitMessage({
      id: "request-1",
      type: "success",
      image: { width: 1, height: 1, data: resultData.buffer },
    });

    const state = app.getState();

    expect(state.processing.status).toBe("success");
    expect(state.processing.error).toBeNull();

    expect(state.image.result).toEqual({
      width: 1,
      height: 1,
      data: expect.any(Uint8ClampedArray),
    });

    expect(Array.from(state.image.result.data)).toEqual([10, 20, 30, 255]);
  });

  test("stores a worker processing error", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());
    app.process();

    worker.emitMessage({
      id: "request-1",
      type: "error",
      error: {
        name: "RangeError",
        message: 'Unknown resize algorithm: "unknown".',
      },
    });

    const state = app.getState();

    expect(state.processing.status).toBe("error");

    expect(state.processing.error).toEqual({
      name: "RangeError",
      message: 'Unknown resize algorithm: "unknown".',
    });
  });

  test("stores a worker runtime error for the active request", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());
    app.process();

    worker.emitError({
      error: new Error("Worker crashed."),
      message: "Worker crashed.",
    });

    const state = app.getState();

    expect(state.processing.status).toBe("error");

    expect(state.processing.error).toEqual({
      name: "Error",
      message: "Worker crashed.",
    });
  });

  test("ignores a stale worker success result", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());

    app.process();
    app.process();

    worker.emitMessage({
      id: "request-1",
      type: "success",
      image: {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([10, 20, 30, 255]).buffer,
      },
    });

    const state = app.getState();

    expect(state.processing.status).toBe("processing");
    expect(state.image.result).toBeNull();
  });

  test("accepts the latest worker success result", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());

    app.process();
    app.process();

    worker.emitMessage({
      id: "request-2",
      type: "success",
      image: {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([100, 110, 120, 255]).buffer,
      },
    });

    const state = app.getState();

    expect(state.processing.status).toBe("success");

    expect(Array.from(state.image.result.data)).toEqual([100, 110, 120, 255]);
  });

  test("ignores a stale worker processing error", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());

    app.process();
    app.process();

    worker.emitMessage({
      id: "request-1",
      type: "error",
      error: { name: "RangeError", message: "Old request failed." },
    });

    const state = app.getState();

    expect(state.processing.status).toBe("processing");
    expect(state.processing.error).toBeNull();
  });

  test("ignores a worker runtime error when there is no active request", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    worker.emitError({
      error: new Error("Worker crashed."),
      message: "Worker crashed.",
    });

    const state = app.getState();

    expect(state.processing.status).toBe("idle");
    expect(state.processing.error).toBeNull();
  });

  test("terminates the worker when disposed", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];
    const listener = vi.fn();

    app.subscribe(listener);
    app.dispose();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.listeners.message.size).toBe(0);
    expect(worker.listeners.error.size).toBe(0);

    app.setRealtimePreview(false);

    expect(listener).not.toHaveBeenCalled();
  });

  test("generates a different request id for each processing request", () => {
    const app = createApp({
      WorkerClass: MockWorker,
      workerUrl: TEST_WORKER_URL,
    });

    const worker = MockWorker.instances[0];

    app.setOriginalImage(createImage());

    const firstId = app.process();
    const secondId = app.process();

    expect(firstId).toBe("request-1");
    expect(secondId).toBe("request-2");

    expect(worker.postMessage).toHaveBeenCalledTimes(2);
  });
});
