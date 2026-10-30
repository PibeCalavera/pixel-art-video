import { ImageDataBuffer } from "../processing/image.js";
import { resolveTargetSize } from "../processing/target-size.js";
import { convertWebMToMP4 } from "../processing/video-export.js";

/**
 * Create the editor controller.
 *
 * Coordinates image and video workflows, editor modes, application state
 * and user interactions.
 *
 * @param {object} dependencies - Required application dependencies.
 * @returns {object} Editor controller interface.
 */
export function createEditorController({
  app,
  controls,
  preview,
  exporter,
  videoProcessor,
  videoPreview,
  elements,
}) {
  if (!app || typeof app.getState !== "function") {
    throw new TypeError("Expected an application instance.");
  }

  if (!controls || typeof controls.getOptions !== "function") {
    throw new TypeError("Expected a controls instance.");
  }

  if (!preview || typeof preview.render !== "function") {
    throw new TypeError("Expected a preview instance.");
  }

  if (!exporter || typeof exporter.save !== "function") {
    throw new TypeError("Expected an exporter instance.");
  }

  if (
    !videoProcessor ||
    typeof videoProcessor.loadFile !== "function" ||
    typeof videoProcessor.process !== "function" ||
    typeof videoProcessor.save !== "function" ||
    typeof videoProcessor.invalidate !== "function" ||
    typeof videoProcessor.dispose !== "function"
  ) {
    throw new TypeError("Expected a valid video processor instance.");
  }

  if (
    !videoPreview ||
    typeof videoPreview.showOriginal !== "function" ||
    typeof videoPreview.showProcessed !== "function" ||
    typeof videoPreview.showExported !== "function" ||
    typeof videoPreview.clear !== "function" ||
    typeof videoPreview.dispose !== "function"
  ) {
    throw new TypeError("Expected a valid video preview instance.");
  }

  validateElements(elements);

  const {
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
  } = elements;

  let editorMode = "image";
  let realtimeTimer = null;
  let lastProcessedImage = null;

  let videoReady = false;
  let videoLoaded = false;
  let currentVideoFile = null;
  let isProcessingVideo = false;
  let isSavingVideo = false;

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

  // Subscribe to application state changes.
  app.subscribe(renderState);

  setPreviewMode("empty");
  renderState(app.getState());
  updateDitherStrengthLabel();
  setEditorMode("image");

  /**
   * Display one of the available preview modes.
   *
   * All preview elements share the same visual area.
   *
   * @param {"empty"|"image"|"video"} mode - Preview mode.
   */
  function setPreviewMode(mode) {
    emptyPreview.hidden = mode !== "empty";
    previewCanvas.hidden = mode !== "image";
    videoElement.hidden = mode !== "video";
  }

  /**
   * Change the active editor mode.
   *
   * Switching to video mode cancels pending real-time image processing.
   *
   * @param {"image"|"video"} mode - Editor mode.
   */
  function setEditorMode(mode) {
    if (mode !== "image" && mode !== "video") {
      throw new TypeError('Editor mode must be "image" or "video".');
    }

    editorMode = mode;

    controls.setEditorMode(mode);

    if (mode === "video" && realtimeTimer !== null) {
      clearTimeout(realtimeTimer);
      realtimeTimer = null;
    }
  }

  /**
   * Build normalized processing options from the current controls.
   *
   * When a source image is available, resolve the selected resize mode into
   * concrete output dimensions before passing the options to the processor.
   *
   * RGBK and RGB Stripe do not require an external palette.
   *
   * @param {ImageDataBuffer | null} [original] - Source image.
   * @returns {object} Normalized processing options.
   * @throws {Error} If the selected algorithm requires a palette and none exists.
   */
  function createProcessingOptions(original = app.getState().image.original) {
    const options = controls.getOptions();

    const ditherAlgorithm = options.dither.algorithm;

    // These dithering algorithms generate their own color structure.
    const paletteFreeDithering = ["rgbk", "rgb-stripe"].includes(
      ditherAlgorithm,
    );

    // Quantization is used when dithering is disabled.
    const quantizationActive =
      ditherAlgorithm === "none" && options.quantize.algorithm !== "none";

    // A palette is required for quantization and palette-based dithering.
    const paletteRequired =
      quantizationActive ||
      (ditherAlgorithm !== "none" && !paletteFreeDithering);

    // Use one palette consistently for quantization and dithering.
    const paletteId =
      options.dither.palette ?? options.quantize.palette ?? null;

    if (paletteRequired && !paletteId) {
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
        algorithm: ditherAlgorithm,
        strength: options.dither.strength,
        matrixSize: options.dither.matrixSize,
        palette: paletteId,

        // RGB Stripe-specific options.
        layout: options.dither.layout,
        channelOrder: options.dither.channelOrder,
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
   *
   * Changes to video processing settings invalidate the previous result.
   */
  function handleControlsChange() {
    try {
      const original = app.getState().image.original;
      const options = createProcessingOptions(original);

      app.updateProcessingOptions(options);

      updateDitherStrengthLabel();

      if (editorMode === "video" && videoLoaded) {
        // The previous processed video no longer matches the current settings.
        videoReady = false;
        saveVideoButton.disabled = true;

        videoProcessor.invalidate();

        // Restore the original video until another processing operation finishes.
        if (currentVideoFile) {
          videoPreview.showOriginal(currentVideoFile);
          setPreviewMode("video");
        }

        setStatus("Video settings changed. Process the video again.");
      }

      if (controls.getRealtimePreview() && original && editorMode === "image") {
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

    setEditorMode("image");

    videoLoaded = false;
    videoReady = false;
    currentVideoFile = null;

    videoProcessor.invalidate();

    processVideoButton.disabled = true;
    saveVideoButton.disabled = true;
    videoExportFormat.disabled = false;

    videoPreview.clear();

    setPreviewMode("empty");

    setStatus(`Loading ${file.name}...`);

    try {
      const image = await loadImageFile(file);

      app.setOriginalImage(image);

      lastProcessedImage = null;

      preview.render(image);

      imageSizeElement.textContent = `${image.width} × ${image.height}`;

      setPreviewMode("image");

      setStatus(`Loaded ${file.name}.`);

      if (controls.getRealtimePreview()) {
        scheduleRealtimeProcessing();
      }
    } catch (error) {
      console.error("[Pixel Art] Unable to load image:", error);

      setPreviewMode("empty");

      setStatus(error?.message ?? "Unable to load image.", true);
    } finally {
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

    // Do not process an image through the image action in video mode.
    if (editorMode !== "image") {
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
    if (!lastProcessedImage || editorMode !== "image") {
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
    if (editorMode !== "image") {
      return;
    }

    lastProcessedImage = null;

    exporter.discard();

    setStatus("Result discarded.");

    renderState(app.getState());
  }

  /**
   * Schedule real-time image processing with a debounce.
   */
  function scheduleRealtimeProcessing() {
    if (editorMode !== "image") {
      return;
    }

    if (realtimeTimer !== null) {
      clearTimeout(realtimeTimer);
    }

    realtimeTimer = setTimeout(() => {
      realtimeTimer = null;

      if (editorMode === "image") {
        handleProcess();
      }
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

    setEditorMode("video");

    videoLoaded = false;
    videoReady = false;
    currentVideoFile = file;

    videoProcessor.invalidate();

    processVideoButton.disabled = true;
    saveVideoButton.disabled = true;
    videoExportFormat.disabled = false;

    videoPreview.clear();

    setPreviewMode("empty");

    setStatus(`Loading ${file.name}...`);

    try {
      const metadata = await videoProcessor.loadFile(file);

      videoPreview.showOriginal(file);

      videoLoaded = true;

      imageSizeElement.textContent =
        `${metadata.width} × ${metadata.height} · ` +
        `${formatDuration(metadata.duration)}`;

      setPreviewMode("video");

      setStatus(
        `Loaded ${file.name}. Choose the output frame rate and process the video.`,
      );
    } catch (error) {
      console.error("[Pixel Art] Unable to load video:", error);

      videoPreview.clear();

      setEditorMode("image");

      videoLoaded = false;
      videoReady = false;
      currentVideoFile = null;

      const original = app.getState().image.original;

      if (original) {
        preview.render(original);

        imageSizeElement.textContent = `${original.width} × ${original.height}`;

        setPreviewMode("image");
      } else {
        imageSizeElement.textContent = "No image";

        setPreviewMode("empty");
      }

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
    if (!videoLoaded || editorMode !== "video") {
      setStatus("Open a video before processing it.", true);
      return;
    }

    if (isProcessingVideo || isSavingVideo) {
      return;
    }

    const frameRate = Number(videoFrameRate.value);

    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 60) {
      setStatus("Frame rate must be an integer between 1 and 60 FPS.", true);
      return;
    }

    isProcessingVideo = true;

    processVideoButton.disabled = true;
    saveVideoButton.disabled = true;
    videoExportFormat.disabled = true;
    videoReady = false;

    try {
      setStatus(`Processing video at ${frameRate} FPS...`);

      const result = await videoProcessor.process(frameRate);

      if (!result.blob || result.blob.size === 0) {
        throw new Error("Video processing did not produce a valid preview.");
      }

      // Display the processed video immediately, before exporting.
      videoPreview.showProcessed(result.blob);

      videoReady = true;

      saveVideoButton.disabled = false;

      setPreviewMode("video");

      setStatus(
        `Processed ${result.count} frames at ${result.frameRate} FPS, ` +
          `${result.width} × ${result.height}. Preview ready.`,
      );
    } catch (error) {
      console.error("[Pixel Art] Unable to process video:", error);

      videoReady = false;
      saveVideoButton.disabled = true;

      if (currentVideoFile) {
        videoPreview.showOriginal(currentVideoFile);
        setPreviewMode("video");
      }

      setStatus(error?.message ?? "Unable to process video.", true);
    } finally {
      isProcessingVideo = false;
      processVideoButton.disabled = !videoLoaded;
      videoExportFormat.disabled = false;
    }
  }

  /**
   * Export the processed video using the selected file format.
   *
   * WebM is exported directly. MP4 is generated by converting the
   * processed WebM only when the user requests an MP4 export.
   */
  async function handleSaveVideo() {
    if (
      !videoReady ||
      editorMode !== "video" ||
      isSavingVideo ||
      isProcessingVideo
    ) {
      return;
    }

    const exportFormat = videoExportFormat.value;

    if (!["webm", "mp4"].includes(exportFormat)) {
      setStatus("Select a valid video export format.", true);
      return;
    }

    isSavingVideo = true;
    saveVideoButton.disabled = true;
    processVideoButton.disabled = true;
    videoExportFormat.disabled = true;

    try {
      setStatus(
        exportFormat === "mp4"
          ? "Converting video to MP4..."
          : "Exporting video as WebM...",
      );

      // Get the already generated WebM. No video reprocessing is required.
      const webmBlob = await videoProcessor.save();

      if (!(webmBlob instanceof Blob) || webmBlob.size === 0) {
        throw new Error("The exported video is empty.");
      }

      let exportBlob;
      let filename;

      if (exportFormat === "mp4") {
        exportBlob = await convertWebMToMP4(webmBlob);
        filename = "pixel-art-video.mp4";
      } else {
        exportBlob = webmBlob;
        filename = "pixel-art-video.webm";
      }

      if (!(exportBlob instanceof Blob) || exportBlob.size === 0) {
        throw new Error("Video export produced an empty file.");
      }

      videoPreview.showExported(exportBlob, filename);

      setPreviewMode("video");

      setStatus(
        exportFormat === "mp4"
          ? "Video exported as MP4."
          : "Video exported as WebM.",
      );
    } catch (error) {
      console.error("[Pixel Art] Unable to export video:", error);

      setStatus(error?.message ?? "Unable to export video.", true);
    } finally {
      isSavingVideo = false;
      saveVideoButton.disabled = !videoReady;
      processVideoButton.disabled = !videoLoaded;
      videoExportFormat.disabled = false;
    }
  }

  /**
   * Render the latest application state in the image interface.
   *
   * Image processing also runs internally when processing video frames.
   * Do not let those state updates replace the active video interface.
   *
   * @param {object} state - Current application state.
   */
  function renderState(state) {
    if (editorMode === "video") {
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

      setPreviewMode("image");
    } else if (original) {
      preview.render(original);

      imageSizeElement.textContent = `${original.width} × ${original.height}`;

      setPreviewMode("image");
    } else {
      setPreviewMode("empty");

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
        setStatus(
          state.processing.error?.message ?? "Processing failed.",
          true,
        );
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
   * Return the current editor mode.
   *
   * @returns {"image"|"video"}
   */
  function getEditorMode() {
    return editorMode;
  }

  /**
   * Release resources owned by the controller.
   */
  function dispose() {
    if (realtimeTimer !== null) {
      clearTimeout(realtimeTimer);
      realtimeTimer = null;
    }

    videoProcessor.dispose();
    videoPreview.dispose();
  }

  return {
    getEditorMode,
    getProcessingOptions: createProcessingOptions,
    dispose,
  };
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
 * Validate the required DOM elements.
 *
 * @param {object} elements - DOM element references.
 * @throws {Error} If a required element is missing.
 */
function validateElements(elements) {
  if (!elements || typeof elements !== "object") {
    throw new TypeError("Expected DOM element references.");
  }

  const requiredElements = [
    "openImageButton",
    "imageInput",
    "processButton",
    "saveButton",
    "discardButton",
    "statusElement",
    "imageSizeElement",
    "previewCanvas",
    "emptyPreview",
    "openVideoButton",
    "videoInput",
    "videoFrameRate",
    "processVideoButton",
    "saveVideoButton",
    "videoExportFormat",
    "videoPreview",
  ];

  for (const key of requiredElements) {
    if (!elements[key]) {
      throw new Error(`Required element "${key}" was not found.`);
    }
  }

  if (!["webm", "mp4"].includes(elements.videoExportFormat.value)) {
    throw new Error("Video export format must be WebM or MP4.");
  }
}
