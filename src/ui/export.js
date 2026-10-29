/**
 * Export utilities for processed images.
 *
 * This module belongs to the UI layer and therefore may depend on
 * browser APIs such as HTMLCanvasElement, ImageData and Blob.
 * Image processing itself must remain outside this module.
 */

/**
 * Creates an image exporter.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} [options]
 * @param {string} [options.filename="pixel-art.png"]
 * @returns {{
 *   save: Function,
 *   discard: Function
 * }}
 */
export function createExporter(canvas, options = {}) {
  validateCanvas(canvas);

  const filename = validateFilename(options.filename ?? "pixel-art.png");

  return { save, discard };

  /**
   * Saves an image as a PNG file.
   *
   * @param {Object} image
   * @returns {Promise<void>}
   */
  async function save(image) {
    validateImage(image);

    const exportCanvas = createCanvas(image.width, image.height);
    const context = get2dContext(exportCanvas);

    context.imageSmoothingEnabled = false;

    const imageData = new ImageData(image.data, image.width, image.height);

    context.putImageData(imageData, 0, 0);

    const blob = await canvasToBlob(exportCanvas);
    downloadBlob(blob, filename);
  }

  /**
   * Clears the preview canvas.
   */
  function discard() {
    const context = get2dContext(canvas);

    context.clearRect(0, 0, canvas.width, canvas.height);

    canvas.width = 0;
    canvas.height = 0;
  }
}

function createCanvas(width, height) {
  assertBrowserEnvironment();

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  return canvas;
}

function get2dContext(canvas) {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to get the 2D canvas context.");
  }

  return context;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to create PNG image."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  assertBrowserEnvironment();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function assertBrowserEnvironment() {
  if (typeof document === "undefined") {
    throw new TypeError("Export requires a browser document.");
  }
}

function validateCanvas(canvas) {
  if (isCanvasElement(canvas) || isCanvasCompatible(canvas)) {
    return;
  }

  throw new TypeError("Exporter requires an HTMLCanvasElement.");
}

function isCanvasElement(value) {
  return (
    typeof HTMLCanvasElement !== "undefined" &&
    value instanceof HTMLCanvasElement
  );
}

function isCanvasCompatible(value) {
  return value && typeof value.getContext === "function";
}

function validateImage(image) {
  if (!image || typeof image !== "object") {
    throw new TypeError("Export requires an image.");
  }

  validateImageDimensions(image);
  validateImageData(image);
}

function validateImageDimensions(image) {
  if (!Number.isInteger(image.width) || image.width <= 0) {
    throw new RangeError("Image width must be a positive integer.");
  }

  if (!Number.isInteger(image.height) || image.height <= 0) {
    throw new RangeError("Image height must be a positive integer.");
  }
}

function validateImageData(image) {
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError("Image data must be a Uint8ClampedArray.");
  }

  const expectedLength = image.width * image.height * 4;

  if (image.data.length !== expectedLength) {
    throw new RangeError("Image data length does not match its dimensions.");
  }
}

function validateFilename(filename) {
  if (typeof filename !== "string" || filename.trim() === "") {
    throw new TypeError("Filename must be a non-empty string.");
  }

  return filename;
}
