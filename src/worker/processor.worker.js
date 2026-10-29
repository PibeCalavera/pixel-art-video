import { ImageDataBuffer } from "../processing/image.js";
import { getPalette, Palette } from "../processing/palette.js";
import { createPipeline } from "../processing/pipeline.js";

import {
  getResizeAlgorithm,
  getQuantizationAlgorithm,
  getDitheringAlgorithm,
} from "../processing/algorithms.js";

self.addEventListener("message", handleMessage);

function handleMessage(event) {
  const message = event.data;

  if (!isValidMessage(message)) {
    postError(message?.id ?? null, new TypeError("Invalid worker message."));
    return;
  }

  const { id, image, options = {} } = message;

  try {
    const input = createImageFromMessage(image);
    const normalizedOptions = normalizeProcessingOptions(options);
    const pipeline = createProcessingPipeline(normalizedOptions);
    const result = pipeline.process(input, normalizedOptions);

    self.postMessage({ id, type: "success", image: serializeImage(result) }, [
      result.data.buffer,
    ]);
  } catch (error) {
    postError(id, error);
  }
}

function isValidMessage(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    ("id" in message || "image" in message || "options" in message),
  );
}

function postError(id, error) {
  self.postMessage({
    id,
    type: "error",
    error: {
      name: error?.name ?? "Error",
      message: error?.message ?? "Unknown processing error.",
    },
  });
}

function createProcessingPipeline(options) {
  const resize = createResizeAlgorithm(options);
  const quantize = createQuantizationAlgorithm(options);
  const dither = createDitheringAlgorithm(options);

  return createPipeline({ resize, quantize, dither });
}

function createResizeAlgorithm(options) {
  const algorithm = options.resize?.algorithm;

  return algorithm ? getResizeAlgorithm(algorithm) : null;
}

function createQuantizationAlgorithm(options) {
  const ditherAlgorithm = options.dither?.algorithm ?? "none";
  const algorithm = options.quantize?.algorithm;

  if (ditherAlgorithm !== "none" || !algorithm) {
    return null;
  }

  return getQuantizationAlgorithm(algorithm);
}

function createDitheringAlgorithm(options) {
  const algorithm = options.dither?.algorithm ?? "none";

  return algorithm !== "none" ? getDitheringAlgorithm(algorithm) : null;
}

function normalizeProcessingOptions(options) {
  validateOptions(options);

  const ditherAlgorithm = options.dither?.algorithm ?? "none";
  const quantizeActive =
    ditherAlgorithm === "none" && Boolean(options.quantize?.algorithm);
  const ditherActive = ditherAlgorithm !== "none";

  if (!quantizeActive && !ditherActive) {
    return options;
  }

  const paletteInput = getPaletteInput(options);

  if (!paletteInput) {
    throw new Error("No palette selected.");
  }

  const palette = resolvePalette(paletteInput);

  return {
    ...options,
    quantize: { ...options.quantize, palette },
    dither: { ...options.dither, palette },
  };
}

function validateOptions(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("Processing options must be an object.");
  }
}

function getPaletteInput(options) {
  return options.quantize?.palette ?? options.dither?.palette ?? null;
}

function resolvePalette(palette) {
  if (palette instanceof Palette) {
    return palette;
  }

  if (typeof palette === "string") {
    return getPalette(palette);
  }

  if (isPaletteData(palette)) {
    return deserializePalette(palette);
  }

  throw new TypeError(
    "Invalid palette. Expected a palette ID or palette object.",
  );
}

function isPaletteData(palette) {
  return (
    palette && typeof palette === "object" && Array.isArray(palette.colors)
  );
}

function deserializePalette(palette) {
  validatePalette(palette);

  return new Palette(
    palette.colors.map(validatePaletteColor),
    palette.name ?? "Custom",
  );
}

function validatePalette(palette) {
  if (!palette || typeof palette !== "object") {
    throw new TypeError("Palette must be an object.");
  }

  if (!Array.isArray(palette.colors) || palette.colors.length === 0) {
    throw new TypeError("Palette colors must be a non-empty array.");
  }
}

function validatePaletteColor(color) {
  if (!color || typeof color !== "object") {
    throw new TypeError("Palette contains an invalid color.");
  }

  const { r, g, b } = color;

  if (!isValidChannel(r) || !isValidChannel(g) || !isValidChannel(b)) {
    throw new TypeError(
      "Palette colors must contain RGB channels between 0 and 255.",
    );
  }

  return { r, g, b };
}

function isValidChannel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function createImageFromMessage(image) {
  validateImage(image);

  const data = new Uint8ClampedArray(image.data);

  return new ImageDataBuffer(image.width, image.height, data);
}

function validateImage(image) {
  if (!image || typeof image !== "object") {
    throw new TypeError("Worker requires an image.");
  }

  if (!isValidDimension(image.width)) {
    throw new TypeError("Worker received invalid image dimensions.");
  }

  if (!isValidDimension(image.height)) {
    throw new TypeError("Worker received invalid image dimensions.");
  }

  if (!image.data) {
    throw new TypeError("Worker received image data that is missing.");
  }
}

function isValidDimension(value) {
  return Number.isInteger(value) && value > 0;
}

function serializeImage(image) {
  return { width: image.width, height: image.height, data: image.data };
}
