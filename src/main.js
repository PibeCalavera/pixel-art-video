import { createApp } from "./app/app.js";
import { createControls } from "./ui/controls.js";
import { createPreview } from "./ui/preview.js";
import { createExporter } from "./ui/export.js";
import { createVideoProcessor } from "./ui/video.js";
import { getPaletteDefinitions } from "./processing/palette.js";
import { ImageDataBuffer } from "./processing/image.js";
import { resolveTargetSize } from "./processing/target-size.js";

// Cache references to the primary image and video interface elements.
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

// Video-specific controls.
const openVideoButton = document.querySelector("#open-video-button");
const videoInput = document.querySelector("#video-input");
const videoFrameCount = document.querySelector("#video-frame-count");
const processVideoButton = document.querySelector("#process-video-button");
const saveVideoButton = document.querySelector("#save-video-button");
const videoPreview = document.querySelector("#video-preview");

// Validate required elements before initializing the application.
validateRequiredElement(openImageButton, "#open-image-button");
validateRequiredElement(imageInput, "#image-input");
validateRequiredElement(processButton, "#process-button");
validateRequiredElement(saveButton, "#save-button");
validateRequiredElement(discardButton, "#discard-button");
validateRequiredElement(statusElement, "#status");
validateRequiredElement(imageSizeElement, "#image-size");
validateRequiredElement(previewCanvas, "#preview-canvas");
validateRequiredElement(emptyPreview, "#empty-preview");

validateRequiredElement(openVideoButton, "#open-video-button");
validateRequiredElement(videoInput, "#video-input");
validateRequiredElement(videoFrameCount, "#video-frame-count");
validateRequiredElement(processVideoButton, "#process-video-button");
validateRequiredElement(saveVideoButton, "#save-video-button");
validateRequiredElement(videoPreview, "#video-preview");

// Initialize the existing image-processing interface.
const controls = createControls(document.body, {
  palettes: getPaletteDefinitions(),
});

const preview = createPreview(previewCanvas);

const exporter = createExporter(previewCanvas, { filename: "pixel-art.png" });

const app = createApp();

// Track pending image processing and the most recent processed image.
let realtimeTimer = null;
let lastProcessedImage = null;

// Track video processing and exported object URLs.
let videoReady = false;
let videoLoaded = false;
let lastVideoUrl = null;

// Initialize the video processor using the existing image-processing pipeline.
const videoProcessor = createVideoProcessor({
  app,
  previewCanvas,
  videoPreview,
  getProcessingOptions: createProcessingOptions,
});

// Register image-related event handlers.
openImageButton.addEventListener("click", handleOpenImage);
imageInput.addEventListener("change", handleImageSelection);
processButton.addEventListener("click", handleProcess);
saveButton.addEventListener("click", handleSave);
discardButton.addEventListener("click", handleDiscard);

controls.onChange(handleControlsChange);

// Register video-related event handlers.
openVideoButton.addEventListener("click", handleOpenVideo);
videoInput.addEventListener("change", handleVideoSelection);
processVideoButton.addEventListener("click", handleProcessVideo);
saveVideoButton.addEventListener("click", handleSaveVideo);

// Subscribe to application state changes and render the initial interface.
app.subscribe(renderState);

renderState(app.getState());
updateDitherStrengthLabel();

/**
 * Build normalized processing options from the current controls.
 *
 * When a source image is available, resolve the selected resize mode into
 * concrete output dimensions before passing the options to the processor.
 *
 * @param {ImageDataBuffer | null} [original] - Source image.
 * @returns {object} Normalized processing options.
 * @throws {Error} If no palette has been selected.
 */
function createProcessingOptions(original = app.getState().image.original) {
  const options = controls.getOptions();

  // Use one palette consistently for quantization and dithering.
  const paletteId = options.dither.palette ?? options.quantize.palette ?? null;

  if (!paletteId) {
    throw new Error("No palette selected.");
  }

  // Resolve scale-based and exact resizing when source dimensions are known.
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
 * Open the image file picker.
 */
function handleOpenImage() {
  imageInput.click();
}

/**
 * Open the video file picker.
 */
function handleOpenVideo() {
  videoInput.click();
}

/**
 * Synchronize image-processing settings and schedule a real-time preview.
 */
function handleControlsChange() {
  try {
    const original = app.getState().image.original;
    const options = createProcessingOptions(original);

    app.updateProcessingOptions(options);
    updateDitherStrengthLabel();

    if (controls.getRealtimePreview() && original && !videoLoaded) {
      scheduleRealtimeProcessing();
    }
  } catch (error) {
    console.error("[Pixel Art] Invalid controls:", error);

    setStatus(error?.message ?? "Invalid settings.", true);
  }
}

/**
 * Load an image selected by the user.
 *
 * @param {Event} event - File input change event.
 */
async function handleImageSelection(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  // Return to image mode and invalidate any previous video result.
  videoLoaded = false;
  videoReady = false;
  processVideoButton.disabled = true;
  saveVideoButton.disabled = true;
  videoPreview.pause();
  videoPreview.hidden = true;
  videoPreview.removeAttribute("src");
  videoPreview.load();

  setStatus(`Loading ${file.name}...`);

  try {
    const image = await loadImageFile(file);

    app.setOriginalImage(image);

    // Discard the previous processed image when a new source is loaded.
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
 * Save the most recently processed image.
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
 * Discard the current image result and restore the original preview.
 */
function handleDiscard() {
  lastProcessedImage = null;

  exporter.discard();

  setStatus("Result discarded.");

  renderState(app.getState());
}

/**
 * Schedule real-time image processing with a debounce.
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
 * Load a video selected by the user and display its metadata.
 *
 * @param {Event} event - File input change event.
 */
async function handleVideoSelection(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  videoLoaded = false;
  videoReady = false;

  processVideoButton.disabled = true;
  saveVideoButton.disabled = true;

  // Clear the previous exported video preview.
  videoPreview.pause();
  videoPreview.hidden = true;
  videoPreview.removeAttribute("src");
  videoPreview.load();

  if (lastVideoUrl) {
    URL.revokeObjectURL(lastVideoUrl);
    lastVideoUrl = null;
  }

  setStatus(`Loading ${file.name}...`);

  try {
    const metadata = await videoProcessor.loadFile(file);

    videoLoaded = true;

    imageSizeElement.textContent = `${metadata.width} × ${metadata.height} · ${formatDuration(metadata.duration)}`;

    emptyPreview.hidden = false;
    previewCanvas.hidden = true;

    setStatus(
      `Loaded ${file.name}. Choose the output frame count and process the video.`,
    );
  } catch (error) {
    console.error("[Pixel Art] Unable to load video:", error);

    setStatus(error?.message ?? "Unable to load video.", true);
  } finally {
    videoInput.value = "";
    processVideoButton.disabled = !videoLoaded;
  }
}

/**
 * Process a video using the requested number of sampled frames.
 */
async function handleProcessVideo() {
  if (!videoLoaded) {
    setStatus("Open a video before processing it.", true);
    return;
  }

  const frameCount = Number(videoFrameCount.value);

  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 300) {
    setStatus("Frame count must be an integer between 1 and 300.", true);
    return;
  }

  processVideoButton.disabled = true;
  saveVideoButton.disabled = true;
  videoReady = false;

  try {
    setStatus(`Processing ${frameCount} video frames...`);

    const result = await videoProcessor.process(frameCount);

    videoReady = true;
    saveVideoButton.disabled = false;

    setStatus(
      `Processed ${result.count} frames at ${result.width} × ${result.height}. Export when ready.`,
    );
  } catch (error) {
    console.error("[Pixel Art] Unable to process video:", error);

    setStatus(error?.message ?? "Unable to process video.", true);
  } finally {
    processVideoButton.disabled = !videoLoaded;
  }
}

/**
 * Export the processed video as a WebM file.
 */
async function handleSaveVideo() {
  if (!videoReady) {
    return;
  }

  saveVideoButton.disabled = true;

  try {
    setStatus("Exporting video...");

    const blob = await videoProcessor.save();

    if (!blob || blob.size === 0) {
      throw new Error("The exported video is empty.");
    }

    if (lastVideoUrl) {
      URL.revokeObjectURL(lastVideoUrl);
    }

    lastVideoUrl = URL.createObjectURL(blob);

    videoPreview.src = lastVideoUrl;
    videoPreview.hidden = false;
    previewCanvas.hidden = true;

    videoPreview.load();

    // Trigger a download without navigating away from the application.
    const link = document.createElement("a");
    link.href = lastVideoUrl;
    link.download = "pixel-art-video.webm";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setStatus("Video exported as WebM.");
  } catch (error) {
    console.error("[Pixel Art] Unable to export video:", error);

    setStatus(error?.message ?? "Unable to export video.", true);
  } finally {
    saveVideoButton.disabled = !videoReady;
  }
}

/**
 * Render the latest application state in the image interface.
 *
 * @param {object} state - Current application state.
 */
function renderState(state) {
  // Do not let image-state updates replace the active video interface.
  if (videoLoaded) {
    processButton.disabled = true;
    saveButton.disabled = true;
    discardButton.disabled = true;
    return;
  }

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

  // Reflect the current processing lifecycle in the status message.
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
 * Update the displayed dithering strength.
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
 * @param {File} file - Image file selected by the user.
 * @returns {Promise<ImageDataBuffer>}
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
    bitmap.close();
  }
}

/**
 * Format a duration as minutes and seconds.
 *
 * @param {number} seconds - Duration in seconds.
 * @returns {string}
 */
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

/**
 * Display a status message and its error state.
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
 */
function validateRequiredElement(element, selector) {
  if (!element) {
    throw new Error(`Required element "${selector}" was not found.`);
  }
}
