import { ImageDataBuffer } from "../processing/image.js";
import { getPalette, Palette } from "../processing/palette.js";
import { createPipeline } from "../processing/pipeline.js";

import {
  getResizeAlgorithm,
  getQuantizationAlgorithm,
  getDitheringAlgorithm,
} from "../processing/algorithms.js";

/**
 * Dithering algorithms that perform their own color selection
 * and therefore do not require a palette.
 */
const PALETTE_FREE_DITHERING_ALGORITHMS = new Set(["rgbk", "rgb-stripe"]);

self.addEventListener("message", handleMessage);

/**
 * Processes an image received from the main thread.
 *
 * @param {MessageEvent} event
 */
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

/**
 * Checks the minimum message structure required by the worker.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
function isValidMessage(message) {
  return (
    message !== null &&
    typeof message === "object" &&
    "id" in message &&
    "image" in message
  );
}

/**
 * Sends a serialized error response to the main thread.
 *
 * @param {string|number|null} id
 * @param {Error} error
 */
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

/**
 * Creates a processing pipeline from the selected algorithms.
 *
 * @param {Object} options
 * @returns {import("../processing/pipeline.js").ProcessingPipeline}
 */
function createProcessingPipeline(options) {
  const resize = createResizeAlgorithm(options);
  const quantize = createQuantizationAlgorithm(options);
  const dither = createDitheringAlgorithm(options);

  return createPipeline({ resize, quantize, dither });
}

/**
 * Resolves the configured resize algorithm.
 *
 * @param {Object} options
 * @returns {Function|null}
 */
function createResizeAlgorithm(options) {
  const algorithm = options.resize?.algorithm;

  return algorithm ? getResizeAlgorithm(algorithm) : null;
}

/**
 * Resolves quantization only when dithering is disabled.
 *
 * Dithering takes precedence over quantization in the pipeline.
 *
 * @param {Object} options
 * @returns {Function|null}
 */
function createQuantizationAlgorithm(options) {
  const ditherAlgorithm = options.dither?.algorithm ?? "none";
  const algorithm = options.quantize?.algorithm;

  if (ditherAlgorithm !== "none" || !algorithm) {
    return null;
  }

  return getQuantizationAlgorithm(algorithm);
}

/**
 * Resolves the configured dithering algorithm.
 *
 * @param {Object} options
 * @returns {Function|null}
 */
function createDitheringAlgorithm(options) {
  const algorithm = options.dither?.algorithm ?? "none";

  return algorithm !== "none" ? getDitheringAlgorithm(algorithm) : null;
}

/**
 * Validates processing options and resolves palettes when required.
 *
 * @param {Object} options
 * @returns {Object} Normalized processing options.
 */
function normalizeProcessingOptions(options) {
  validateOptions(options);

  const ditherAlgorithm = options.dither?.algorithm ?? "none";

  const quantizeActive =
    ditherAlgorithm === "none" && Boolean(options.quantize?.algorithm);

  const ditherActive =
    ditherAlgorithm !== "none" &&
    !PALETTE_FREE_DITHERING_ALGORITHMS.has(ditherAlgorithm);

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

/**
 * Validates the processing options container.
 *
 * @param {unknown} options
 * @throws {TypeError}
 */
function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Processing options must be an object.");
  }
}

/**
 * Gets the palette from quantization or dithering options.
 *
 * @param {Object} options
 * @returns {Palette|string|Object|null}
 */
function getPaletteInput(options) {
  return options.quantize?.palette ?? options.dither?.palette ?? null;
}

/**
 * Resolves a palette ID or serialized palette into a Palette instance.
 *
 * @param {Palette|string|Object} palette
 * @returns {Palette}
 */
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

/**
 * Checks whether a value contains serialized palette data.
 *
 * @param {unknown} palette
 * @returns {boolean}
 */
function isPaletteData(palette) {
  return (
    palette !== null &&
    typeof palette === "object" &&
    Array.isArray(palette.colors)
  );
}

/**
 * Creates a Palette instance from serialized data.
 *
 * @param {Object} palette
 * @returns {Palette}
 */
function deserializePalette(palette) {
  validatePalette(palette);

  return new Palette(
    palette.colors.map(validatePaletteColor),
    palette.name ?? "Custom",
  );
}

/**
 * Validates the structure of serialized palette data.
 *
 * @param {Object} palette
 */
function validatePalette(palette) {
  if (!palette || typeof palette !== "object") {
    throw new TypeError("Palette must be an object.");
  }

  if (!Array.isArray(palette.colors) || palette.colors.length === 0) {
    throw new TypeError("Palette colors must be a non-empty array.");
  }
}

/**
 * Validates and normalizes an RGB palette color.
 *
 * @param {Object} color
 * @returns {{r:number,g:number,b:number}}
 */
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

/**
 * Checks whether a channel is an integer in the 8-bit RGB range.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidChannel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Creates an ImageDataBuffer from a worker message.
 *
 * @param {Object} image
 * @returns {ImageDataBuffer}
 */
function createImageFromMessage(image) {
  if (!validateImage(image)) {
    throw new TypeError("Worker received invalid RGBA image data.");
  }

  const data = normalizeImageData(image.data);

  return new ImageDataBuffer(image.width, image.height, data);
}

/**
 * Validates the image received by the worker.
 *
 * Supports ArrayBuffer, typed byte arrays and plain arrays.
 *
 * @param {Object} image
 * @returns {boolean}
 */
function validateImage(image) {
  if (!image || typeof image !== "object") {
    return false;
  }

  const { width, height, data } = image;

  if (!isValidDimension(width) || !isValidDimension(height)) {
    return false;
  }

  const expectedLength = width * height * 4;

  if (!Number.isSafeInteger(expectedLength)) {
    return false;
  }

  return getImageDataLength(data) === expectedLength;
}

/**
 * Checks whether a dimension is a positive safe integer.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidDimension(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Returns the number of bytes in an RGBA data source.
 *
 * @param {*} data
 * @returns {number}
 */
function getImageDataLength(data) {
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  if (
    ArrayBuffer.isView(data) &&
    !(data instanceof DataView) &&
    data.BYTES_PER_ELEMENT === 1
  ) {
    return data.byteLength;
  }

  if (Array.isArray(data)) {
    return data.length;
  }

  return -1;
}

/**
 * Converts supported input data into a Uint8ClampedArray.
 *
 * @param {ArrayBuffer|ArrayBufferView|Array<number>} data
 * @returns {Uint8ClampedArray}
 */
function normalizeImageData(data) {
  if (data instanceof ArrayBuffer) {
    return new Uint8ClampedArray(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  }

  if (Array.isArray(data)) {
    return new Uint8ClampedArray(data);
  }

  throw new TypeError("Unsupported RGBA image data format.");
}

/**
 * Serializes an ImageDataBuffer for transfer to the main thread.
 *
 * @param {ImageDataBuffer} image
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
function serializeImage(image) {
  return { width: image.width, height: image.height, data: image.data };
}
