const DEFAULT_PROCESSING_OPTIONS = {
  resize: { algorithm: "nearest", width: null, height: null },

  quantize: { algorithm: "nearest", palette: null },

  dither: { algorithm: "none", strength: 1, palette: null },
};

const PROCESSING_STATUSES = new Set(["idle", "processing", "success", "error"]);

export function createInitialState() {
  return {
    image: { original: null, result: null },

    processing: {
      options: createDefaultProcessingOptions(),
      status: "idle",
      error: null,
    },

    preview: { realtime: true },
  };
}

export function createDefaultProcessingOptions() {
  return {
    resize: { ...DEFAULT_PROCESSING_OPTIONS.resize },

    quantize: { ...DEFAULT_PROCESSING_OPTIONS.quantize },

    dither: { ...DEFAULT_PROCESSING_OPTIONS.dither },
  };
}

export function updateProcessingOptions(state, options) {
  validateState(state);

  if (!options || typeof options !== "object") {
    throw new TypeError("Processing options must be an object.");
  }

  return {
    ...state,

    processing: {
      ...state.processing,

      options: mergeProcessingOptions(state.processing.options, options),
    },
  };
}

export function setOriginalImage(state, image) {
  validateState(state);

  return {
    ...state,

    image: { original: image, result: null },

    processing: { ...state.processing, status: "idle", error: null },
  };
}

export function setProcessedImage(state, image) {
  validateState(state);

  return {
    ...state,

    image: { ...state.image, result: image },

    processing: { ...state.processing, status: "success", error: null },
  };
}

export function setProcessingStatus(state, status) {
  validateState(state);

  if (!PROCESSING_STATUSES.has(status)) {
    throw new RangeError(`Invalid processing status: "${status}".`);
  }

  return {
    ...state,

    processing: {
      ...state.processing,
      status,
      error: status === "processing" ? null : state.processing.error,
    },
  };
}

export function setProcessingError(state, error) {
  validateState(state);

  return {
    ...state,

    processing: {
      ...state.processing,
      status: "error",
      error: normalizeError(error),
    },
  };
}

export function clearProcessingError(state) {
  validateState(state);

  return {
    ...state,

    processing: { ...state.processing, error: null },
  };
}

export function setRealtimePreview(state, enabled) {
  validateState(state);

  if (typeof enabled !== "boolean") {
    throw new TypeError("Realtime preview must be a boolean.");
  }

  return {
    ...state,

    preview: { ...state.preview, realtime: enabled },
  };
}

function mergeProcessingOptions(current, updates) {
  return {
    ...current,

    resize: { ...current.resize, ...(updates.resize ?? {}) },

    quantize: { ...current.quantize, ...(updates.quantize ?? {}) },

    dither: { ...current.dither, ...(updates.dither ?? {}) },
  };
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  if (error && typeof error === "object" && typeof error.message === "string") {
    return { name: error.name ?? "Error", message: error.message };
  }

  return { name: "Error", message: String(error) };
}

function validateState(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("State must be an object.");
  }

  if (!state.image || typeof state.image !== "object") {
    throw new TypeError("State image must be an object.");
  }

  if (!state.processing || typeof state.processing !== "object") {
    throw new TypeError("State processing must be an object.");
  }

  if (
    !state.processing.options ||
    typeof state.processing.options !== "object"
  ) {
    throw new TypeError("State processing options must be an object.");
  }

  if (!state.preview || typeof state.preview !== "object") {
    throw new TypeError("State preview must be an object.");
  }
}
