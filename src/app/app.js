import {
  createInitialState,
  updateProcessingOptions,
  setOriginalImage,
  setProcessingError,
  setProcessingStatus,
  setProcessedImage,
  setRealtimePreview,
} from "./state.js";

export function createApp(options = {}) {
  let state = createInitialState();
  let requestId = 0;
  let activeRequestId = null;

  const listeners = new Set();

  const worker = createWorker(options);

  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", handleWorkerError);

  return {
    getState,
    subscribe,
    setOriginalImage: handleSetOriginalImage,
    updateProcessingOptions: handleUpdateProcessingOptions,
    setRealtimePreview: handleSetRealtimePreview,
    process,
    dispose,
  };

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Listener must be a function.");
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  function handleSetOriginalImage(image) {
    state = setOriginalImage(state, image);

    notify();

    return state;
  }

  function handleUpdateProcessingOptions(options) {
    state = updateProcessingOptions(state, options);

    notify();

    return state;
  }

  function handleSetRealtimePreview(enabled) {
    state = setRealtimePreview(state, enabled);

    notify();

    return state;
  }

  function process(options = {}) {
    if (!state.image.original) {
      throw new Error("Cannot process without an original image.");
    }

    state = updateProcessingOptions(state, options);

    const processingOptions = state.processing.options;
    const id = `request-${++requestId}`;

    activeRequestId = id;

    state = setProcessingStatus(state, "processing");

    notify();

    const image = serializeImage(state.image.original);

    worker.postMessage({ id, image, options: processingOptions }, [image.data]);

    return id;
  }

  function handleWorkerMessage(event) {
    const message = event.data;

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.id !== activeRequestId) {
      return;
    }

    if (message.type === "success") {
      const image = deserializeImage(message.image);

      state = setProcessedImage(state, image);
      activeRequestId = null;

      notify();

      return;
    }

    if (message.type === "error") {
      state = setProcessingError(state, createWorkerError(message.error));

      activeRequestId = null;

      notify();
    }
  }

  function handleWorkerError(event) {
    if (activeRequestId === null) {
      return;
    }

    state = setProcessingError(
      state,
      event.error ?? new Error(event.message ?? "Worker processing failed."),
    );

    activeRequestId = null;

    notify();
  }

  function notify() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function dispose() {
    worker.removeEventListener("message", handleWorkerMessage);
    worker.removeEventListener("error", handleWorkerError);

    worker.terminate();

    activeRequestId = null;

    listeners.clear();
  }
}

function createWorker(options) {
  if (options.WorkerClass) {
    const workerUrl = options.workerUrl;

    return new options.WorkerClass(workerUrl, { type: "module" });
  }

  return new Worker(new URL("../worker/processor.worker.js", import.meta.url), {
    type: "module",
  });
}

function serializeImage(image) {
  if (!image || typeof image !== "object") {
    throw new TypeError("Image must be an object.");
  }

  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError("Image data must be a Uint8ClampedArray.");
  }

  const data = new Uint8ClampedArray(image.data);

  return { width: image.width, height: image.height, data: data.buffer };
}

function deserializeImage(image) {
  if (!image || typeof image !== "object") {
    throw new TypeError("Worker returned an invalid image.");
  }

  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

function createWorkerError(error) {
  if (!error || typeof error !== "object") {
    return new Error(String(error));
  }

  const result = new Error(error.message ?? "Worker processing failed.");

  if (error.name) {
    result.name = error.name;
  }

  return result;
}
