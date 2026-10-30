import { createApp } from "./app/app.js";
import { createEditorController } from "./app/editor-controller.js";

import { createControls } from "./ui/controls.js";
import { createPreview } from "./ui/preview.js";
import { createExporter } from "./ui/export.js";
import { createVideoPreview } from "./ui/video-preview.js";
import { createVideoProcessor } from "./ui/video.js";

import { getPaletteDefinitions } from "./processing/palette.js";

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
const videoFrameRate = document.querySelector("#video-frame-rate");
const processVideoButton = document.querySelector("#process-video-button");
const saveVideoButton = document.querySelector("#save-video-button");
const videoExportFormat = document.querySelector("#video-export-format");
const videoElement = document.querySelector("#video-preview");

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
validateRequiredElement(videoFrameRate, "#video-frame-rate");
validateRequiredElement(processVideoButton, "#process-video-button");
validateRequiredElement(saveVideoButton, "#save-video-button");
validateRequiredElement(videoExportFormat, "#video-export-format");
validateRequiredElement(videoElement, "#video-preview");

// Initialize the application and its UI dependencies.
const app = createApp();

const controls = createControls(document.body, {
  palettes: getPaletteDefinitions(),
});

const preview = createPreview(previewCanvas);

const exporter = createExporter(previewCanvas, { filename: "pixel-art.png" });

// Initialize the video presentation module.
const videoPreview = createVideoPreview(videoElement);

// The processing options are provided by the editor controller.
// The function is assigned after the controller has been initialized.
let getProcessingOptions = null;

// Initialize the video processor independently of the video presentation.
const videoProcessor = createVideoProcessor({
  app,

  getProcessingOptions(original) {
    if (typeof getProcessingOptions !== "function") {
      throw new Error("Processing options are not initialized.");
    }

    return getProcessingOptions(original);
  },
});

// Collect DOM references for the editor controller.
const elements = {
  openImageButton,
  imageInput,
  processButton,
  saveButton,
  discardButton,
  statusElement,
  imageSizeElement,
  previewCanvas,
  emptyPreview,
  ditherStrengthValue,

  openVideoButton,
  videoInput,
  videoFrameRate,
  processVideoButton,
  saveVideoButton,
  videoExportFormat,
  videoPreview: videoElement,
};

// Compose the editor controller.
const editorController = createEditorController({
  app,
  controls,
  preview,
  exporter,
  videoProcessor,
  videoPreview,
  elements,
});

// Provide normalized processing options to the video processor.
getProcessingOptions = editorController.getProcessingOptions;

/**
 * Validate that a required DOM element exists.
 *
 * @param {Element | null} element - Element returned by a DOM query.
 * @param {string} selector - Selector used to find the element.
 * @throws {Error} If the element does not exist.
 */
function validateRequiredElement(element, selector) {
  if (!element) {
    throw new Error(`Required element "${selector}" was not found.`);
  }
}
