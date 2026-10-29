import { createApp } from "./app/app.js";
import { createControls } from "./ui/controls.js";
import { createPreview } from "./ui/preview.js";
import { createExporter } from "./ui/export.js";
import { getPaletteDefinitions } from "./processing/palette.js";
import { ImageDataBuffer } from "./processing/image.js";
import { resolveTargetSize } from "./processing/target-size.js";

// Cache references to the primary application controls and preview elements.
const openImageButton = document.querySelector("#open-image-button");
const imageInput = document.querySelector("#image-input");
const processButton = document.querySelector("#process-button");
const saveButton = document.querySelector("#save-button");
const discardButton = document.querySelector("#discard-button");
const statusElement = document.querySelector("#status");
const imageSizeElement = document.querySelector("#image-size");
const previewCanvas = document.querySelector("#preview-canvas");
const emptyPreview = document.querySelector("#empty-preview");
const ditherStrengthValue = document.querySelector("#dither-strength-value");

// Fail early if required elements are missing from the document.
validateRequiredElement(openImageButton, "#open-image-button");
validateRequiredElement(imageInput, "#image-input");
validateRequiredElement(processButton, "#process-button");
validateRequiredElement(saveButton, "#save-button");
validateRequiredElement(discardButton, "#discard-button");
validateRequiredElement(statusElement, "#status");
validateRequiredElement(imageSizeElement, "#image-size");
validateRequiredElement(previewCanvas, "#preview-canvas");
validateRequiredElement(emptyPreview, "#empty-preview");

// Initialize the UI controllers and the application state manager.
const controls = createControls(document.body, {
  palettes: getPaletteDefinitions(),
});

const preview = createPreview(previewCanvas);

const exporter = createExporter(previewCanvas, { filename: "pixel-art.png" });

const app = createApp();

// Track pending real-time processing and the most recent processed image.
let realtimeTimer = null;
let lastProcessedImage = null;

// Register UI event handlers.
openImageButton.addEventListener("click", handleOpenImage);
imageInput.addEventListener("change", handleImageSelection);
processButton.addEventListener("click", handleProcess);
saveButton.addEventListener("click", handleSave);
discardButton.addEventListener("click", handleDiscard);

controls.onChange(handleControlsChange);
app.subscribe(renderState);

// Render the initial state and synchronize control labels.
renderState(app.getState());
updateDitherStrengthLabel();

/**
 * Build the processing options from the current controls.
 *
 * When an original image is available, resolve the selected resize mode
 * into concrete output dimensions before passing options to the processor.
 *
 * @param {ImageDataBuffer | null} [original] - Source image to process.
 * @returns {object} Normalized processing options.
 * @throws {Error} If a required palette has not been selected.
 */
function createProcessingOptions(original = app.getState().image.original) {
  const options = controls.getOptions();

  // Use a single palette consistently for quantization and dithering.
  const paletteId = options.dither.palette ?? options.quantize.palette ?? null;

  if (!paletteId) {
    throw new Error("No palette selected.");
  }

  // Resolve scale-based or exact resizing into concrete dimensions.
  // Without a source image, preserve the dimensions supplied by the controls.
  const targetSize = original
    ? resolveTargetSize(original.width, original.height, options.resize)
    : { width: options.resize.width, height: options.resize.height };

  return {
    resize: {
      algorithm: options.resize.algorithm,
      width: targetSize.width,
      height: targetSize.height,
    },

    quantize: { algorithm: options.quantize.algorithm, palette: paletteId },

    dither: {
      algorithm: options.dither.algorithm,
      strength: options.dither.strength,
      matrixSize: options.dither.matrixSize,
      palette: paletteId,
    },
  };
}

/**
 * Open the native file picker.
 */
function handleOpenImage() {
  imageInput.click();
}

/**
 * Synchronize processing settings with the application state.
 *
 * If real-time preview is enabled and an image is loaded, schedule
 * processing after a short debounce interval.
 */
function handleControlsChange() {
  try {
    const original = app.getState().image.original;
    const options = createProcessingOptions(original);

    app.updateProcessingOptions(options);
    updateDitherStrengthLabel();

    if (controls.getRealtimePreview() && original) {
      scheduleRealtimeProcessing();
    }
  } catch (error) {
    console.error("[Pixel Art] Invalid controls:", error);

    setStatus(error?.message ?? "Invalid settings.", true);
  }
}

/**
 * Load the image selected by the user and display the original preview.
 *
 * @param {Event} event - File input change event.
 */
async function handleImageSelection(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  setStatus(`Loading ${file.name}...`);

  try {
    const image = await loadImageFile(file);

    app.setOriginalImage(image);

    // Discard the previous result when a new source image is loaded.
    lastProcessedImage = null;

    preview.render(image);

    imageSizeElement.textContent = `${image.width} × ${image.height}`;

    emptyPreview.hidden = true;
    previewCanvas.hidden = false;

    setStatus(`Loaded ${file.name}.`);

    if (controls.getRealtimePreview()) {
      scheduleRealtimeProcessing();
    }
  } catch (error) {
    console.error("[Pixel Art] Unable to load image:", error);

    setStatus(error?.message ?? "Unable to load image.", true);
  } finally {
    // Allow the same file to be selected again.
    imageInput.value = "";
  }
}

/**
 * Process the currently loaded image using the selected settings.
 */
function handleProcess() {
  const original = app.getState().image.original;

  if (!original) {
    setStatus("Open an image before processing.", true);
    return;
  }

  try {
    const options = createProcessingOptions(original);

    app.process(options);
  } catch (error) {
    console.error("[Pixel Art] Unable to process image:", error);

    setStatus(error?.message ?? "Unable to process image.", true);
  }
}

/**
 * Export the most recently processed image.
 *
 * The exporter is responsible for encoding and saving the image.
 */
async function handleSave() {
  if (!lastProcessedImage) {
    return;
  }

  try {
    await exporter.save(lastProcessedImage);

    setStatus("Image saved.");
  } catch (error) {
    console.error("[Pixel Art] Unable to save image:", error);

    setStatus(error?.message ?? "Unable to save image.", true);
  }
}

/**
 * Discard the current processed result and restore the original preview.
 */
function handleDiscard() {
  lastProcessedImage = null;

  exporter.discard();

  setStatus("Result discarded.");

  renderState(app.getState());
}

/**
 * Schedule real-time processing with a debounce to avoid excessive work.
 *
 * Repeated control changes reset the timer so processing starts after
 * the user pauses interaction.
 */
function scheduleRealtimeProcessing() {
  if (realtimeTimer !== null) {
    clearTimeout(realtimeTimer);
  }

  realtimeTimer = setTimeout(() => {
    realtimeTimer = null;

    handleProcess();
  }, 120);
}

/**
 * Update the interface to reflect the latest application state.
 *
 * @param {object} state - Current application state.
 */
function renderState(state) {
  const original = state.image.original;
  const result = state.image.result;

  processButton.disabled =
    !original || state.processing.status === "processing";

  saveButton.disabled = !result;
  discardButton.disabled = !result;

  if (result) {
    lastProcessedImage = result;

    preview.render(result);

    imageSizeElement.textContent = `${result.width} × ${result.height}`;

    emptyPreview.hidden = true;
    previewCanvas.hidden = false;
  } else if (original) {
    preview.render(original);

    imageSizeElement.textContent = `${original.width} × ${original.height}`;

    emptyPreview.hidden = true;
    previewCanvas.hidden = false;
  } else {
    previewCanvas.hidden = true;
    emptyPreview.hidden = false;
    imageSizeElement.textContent = "No image";
  }

  // Keep the status message consistent with the processing lifecycle.
  switch (state.processing.status) {
    case "idle":
      if (original) {
        setStatus("Ready.");
      }
      break;

    case "processing":
      setStatus("Processing…");
      break;

    case "success":
      setStatus("Processing complete.");
      break;

    case "error":
      setStatus(state.processing.error?.message ?? "Processing failed.", true);
      break;

    default:
      break;
  }
}

/**
 * Refresh the displayed dithering strength value.
 */
function updateDitherStrengthLabel() {
  if (!ditherStrengthValue) {
    return;
  }

  const options = controls.getOptions();

  ditherStrengthValue.textContent = String(options.dither.strength);
}

/**
 * Decode an image file into the application's internal image buffer.
 *
 * ImageBitmap is used for decoding, and the temporary bitmap is released
 * after its pixel data has been copied to an ImageDataBuffer.
 *
 * @param {File} file - Image file selected by the user.
 * @returns {Promise<ImageDataBuffer>} Decoded image data.
 * @throws {TypeError | Error} If the file or browser APIs are invalid.
 */
async function loadImageFile(file) {
  if (!(file instanceof File)) {
    throw new TypeError("Expected an image file.");
  }

  if (!file.type.startsWith("image/")) {
    throw new TypeError("The selected file is not an image.");
  }

  if (typeof createImageBitmap !== "function") {
    throw new TypeError("Image loading is not supported by this browser.");
  }

  const bitmap = await createImageBitmap(file);

  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("The image has invalid dimensions.");
    }

    const canvas = document.createElement("canvas");

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      throw new Error("Unable to create a 2D canvas context.");
    }

    context.drawImage(bitmap, 0, 0);

    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);

    return ImageDataBuffer.fromImageData(imageData);
  } finally {
    // Release bitmap resources even if pixel extraction fails.
    bitmap.close();
  }
}

/**
 * Display a status message and mark whether it represents an error.
 *
 * @param {string} message - Message to display.
 * @param {boolean} [isError=false] - Whether the message indicates an error.
 */
function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.dataset.error = isError ? "true" : "false";
}

/**
 * Validate that a required DOM element exists.
 *
 * @param {Element | null} element - Element returned by a DOM query.
 * @param {string} selector - Selector used to find the element.
 * @throws {Error} If the element cannot be found.
 */
function validateRequiredElement(element, selector) {
  if (!element) {
    throw new Error(`Required element "${selector}" was not found.`);
  }
}
