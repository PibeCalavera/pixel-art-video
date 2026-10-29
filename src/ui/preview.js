export function createPreview(canvas) {
  validateCanvas(canvas);

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to get the 2D canvas context.");
  }

  context.imageSmoothingEnabled = false;

  return { render, clear };

  function render(image) {
    validateImage(image);

    canvas.width = image.width;
    canvas.height = image.height;

    context.imageSmoothingEnabled = false;

    const imageData = new ImageData(image.data, image.width, image.height);

    context.putImageData(imageData, 0, 0);
  }

  function clear() {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function validateCanvas(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new TypeError("Preview requires an HTMLCanvasElement.");
  }
}

function validateImage(image) {
  if (!image || typeof image !== "object") {
    throw new TypeError("Preview requires an image.");
  }

  if (!Number.isInteger(image.width) || image.width <= 0) {
    throw new RangeError("Image width must be a positive integer.");
  }

  if (!Number.isInteger(image.height) || image.height <= 0) {
    throw new RangeError("Image height must be a positive integer.");
  }

  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError("Image data must be a Uint8ClampedArray.");
  }

  const expectedLength = image.width * image.height * 4;

  if (image.data.length !== expectedLength) {
    throw new RangeError("Image data length does not match its dimensions.");
  }
}
