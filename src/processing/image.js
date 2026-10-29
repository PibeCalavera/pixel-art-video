/**
 * Internal image representation used by the processing pipeline.
 *
 * Pixels are stored as RGBA values in a Uint8ClampedArray:
 *
 *   [R, G, B, A, R, G, B, A, ...]
 *
 * This module intentionally has no dependency on the DOM or Canvas.
 */

/**
 * Represents an image being processed.
 */
export class ImageDataBuffer {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Uint8ClampedArray} data
   */
  constructor(width, height, data) {
    validateDimensions(width, height);

    if (!(data instanceof Uint8ClampedArray)) {
      throw new TypeError("Image data must be a Uint8ClampedArray.");
    }

    const expectedLength = width * height * 4;

    if (data.length !== expectedLength) {
      throw new RangeError(
        `Invalid image data length. Expected ${expectedLength}, got ${data.length}.`,
      );
    }

    this.width = width;
    this.height = height;
    this.data = data;
  }

  /**
   * Creates an empty image initialized to transparent black.
   *
   * @param {number} width
   * @param {number} height
   * @returns {ImageDataBuffer}
   */
  static empty(width, height) {
    validateDimensions(width, height);

    return new ImageDataBuffer(
      width,
      height,
      new Uint8ClampedArray(width * height * 4),
    );
  }

  /**
   * Creates a copy of an existing image.
   *
   * @param {ImageDataBuffer} image
   * @returns {ImageDataBuffer}
   */
  static clone(image) {
    assertImage(image);

    return new ImageDataBuffer(
      image.width,
      image.height,
      new Uint8ClampedArray(image.data),
    );
  }

  /**
   * Creates an ImageDataBuffer from a native ImageData object.
   *
   * @param {ImageData} imageData
   * @returns {ImageDataBuffer}
   */
  static fromImageData(imageData) {
    if (!(imageData instanceof ImageData)) {
      throw new TypeError("Expected an ImageData object.");
    }

    return new ImageDataBuffer(
      imageData.width,
      imageData.height,
      new Uint8ClampedArray(imageData.data),
    );
  }

  /**
   * Converts this image to a native ImageData object.
   *
   * @returns {ImageData}
   */
  toImageData() {
    return new ImageData(
      new Uint8ClampedArray(this.data),
      this.width,
      this.height,
    );
  }

  /**
   * Returns the pixel offset for the given coordinates.
   *
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getOffset(x, y) {
    validateCoordinates(x, y, this.width, this.height);

    return (y * this.width + x) * 4;
  }

  /**
   * Gets a pixel.
   *
   * @param {number} x
   * @param {number} y
   * @returns {{r: number, g: number, b: number, a: number}}
   */
  getPixel(x, y) {
    const offset = this.getOffset(x, y);

    return {
      r: this.data[offset],
      g: this.data[offset + 1],
      b: this.data[offset + 2],
      a: this.data[offset + 3],
    };
  }

  /**
   * Sets a pixel.
   *
   * @param {number} x
   * @param {number} y
   * @param {{r: number, g: number, b: number, a?: number}} color
   */
  setPixel(x, y, color) {
    const offset = this.getOffset(x, y);

    this.data[offset] = color.r;
    this.data[offset + 1] = color.g;
    this.data[offset + 2] = color.b;
    this.data[offset + 3] = color.a ?? 255;
  }

  /**
   * Returns the total number of pixels.
   *
   * @returns {number}
   */
  get pixelCount() {
    return this.width * this.height;
  }

  /**
   * Returns the total memory occupied by the pixel buffer.
   *
   * @returns {number}
   */
  get byteLength() {
    return this.data.byteLength;
  }
}

/**
 * Creates an ImageDataBuffer from a canvas.
 *
 * This is the only canvas-specific helper in this module.
 * The processing algorithms themselves remain independent of Canvas.
 *
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @returns {ImageDataBuffer}
 */
export function fromCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("Expected a canvas or OffscreenCanvas.");
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Unable to obtain a 2D rendering context.");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  return ImageDataBuffer.fromImageData(imageData);
}

/**
 * Draws an ImageDataBuffer onto a canvas.
 *
 * @param {ImageDataBuffer} image
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 */
export function drawToCanvas(image, canvas) {
  assertImage(image);

  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("Expected a canvas or OffscreenCanvas.");
  }

  if (canvas.width !== image.width) {
    canvas.width = image.width;
  }

  if (canvas.height !== image.height) {
    canvas.height = image.height;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to obtain a 2D rendering context.");
  }

  context.putImageData(image.toImageData(), 0, 0);
}

/**
 * Creates a blank image with the specified dimensions and background color.
 *
 * @param {number} width
 * @param {number} height
 * @param {{r: number, g: number, b: number, a?: number}} color
 * @returns {ImageDataBuffer}
 */
export function createSolidImage(width, height, color) {
  validateDimensions(width, height);
  validateColor(color);

  const data = new Uint8ClampedArray(width * height * 4);
  const alpha = color.a ?? 255;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = alpha;
  }

  return new ImageDataBuffer(width, height, data);
}

/**
 * Validates image dimensions.
 *
 * @param {number} width
 * @param {number} height
 */
function validateDimensions(width, height) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError("Image width must be a positive integer.");
  }

  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError("Image height must be a positive integer.");
  }
}

/**
 * Validates image coordinates.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 */
function validateCoordinates(x, y, width, height) {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= width ||
    y < 0 ||
    y >= height
  ) {
    throw new RangeError(`Pixel coordinates out of bounds: (${x}, ${y}).`);
  }
}

/**
 * Validates a color object.
 *
 * @param {{r: number, g: number, b: number, a?: number}} color
 */
function validateColor(color) {
  if (!color || typeof color !== "object") {
    throw new TypeError("Color must be an object.");
  }

  for (const channel of ["r", "g", "b"]) {
    if (
      !Number.isFinite(color[channel]) ||
      color[channel] < 0 ||
      color[channel] > 255
    ) {
      throw new RangeError(
        `Color channel "${channel}" must be between 0 and 255.`,
      );
    }
  }

  if (
    color.a !== undefined &&
    (!Number.isFinite(color.a) || color.a < 0 || color.a > 255)
  ) {
    throw new RangeError("Alpha channel must be between 0 and 255.");
  }
}

/**
 * Ensures that a value is an ImageDataBuffer.
 *
 * @param {ImageDataBuffer} image
 */
function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("Expected an ImageDataBuffer.");
  }
}
