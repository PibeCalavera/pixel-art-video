import { ImageDataBuffer } from "../processing/image.js";

/**
 * Creates a video processor that reuses the application's image-processing
 * worker for each sampled video frame.
 *
 * @param {object} options
 * @param {object} options.app - Application state and worker controller.
 * @param {HTMLCanvasElement} options.previewCanvas - Existing image preview.
 * @param {HTMLVideoElement} options.videoPreview - Exported video player.
 * @param {Function} options.getProcessingOptions - Resolves options for a frame.
 */
export function createVideoProcessor({
  app,
  previewCanvas,
  videoPreview,
  getProcessingOptions,
}) {
  const sourceVideo = document.createElement("video");
  sourceVideo.preload = "auto";
  sourceVideo.playsInline = true;

  const frameCanvas = document.createElement("canvas");
  const frameContext = frameCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const outputCanvas = document.createElement("canvas");
  const outputContext = outputCanvas.getContext("2d");

  if (!frameContext || !outputContext) {
    throw new Error("Unable to create video processing canvases.");
  }

  let sourceUrl = null;
  let outputUrl = null;
  let processedFrames = [];
  let sourceDuration = 0;
  let isProcessing = false;

  return { loadFile, process, save, dispose };

  /**
   * Load a local video file and wait for its metadata.
   *
   * @param {File} file
   * @returns {Promise<{width: number, height: number, duration: number}>}
   */
  async function loadFile(file) {
    if (!(file instanceof File) || !file.type.startsWith("video/")) {
      throw new TypeError("Select a valid video file.");
    }

    releaseSourceUrl();

    sourceUrl = URL.createObjectURL(file);
    sourceVideo.src = sourceUrl;

    await waitForMetadata(sourceVideo);

    if (
      !Number.isFinite(sourceVideo.duration) ||
      sourceVideo.duration <= 0 ||
      sourceVideo.videoWidth <= 0 ||
      sourceVideo.videoHeight <= 0
    ) {
      throw new Error("The video has invalid duration or dimensions.");
    }

    sourceDuration = sourceVideo.duration;
    processedFrames = [];

    return {
      width: sourceVideo.videoWidth,
      height: sourceVideo.videoHeight,
      duration: sourceDuration,
    };
  }

  /**
   * Sample the video evenly and process every sampled frame.
   *
   * The selected frame count is distributed across the complete duration.
   * This first implementation keeps processed frames in memory, so use a
   * moderate frame count for long or high-resolution videos.
   *
   * @param {number} frameCount
   * @returns {Promise<{count: number, width: number, height: number}>}
   */
  async function process(frameCount) {
    if (isProcessing) {
      throw new Error("Video processing is already in progress.");
    }

    if (!sourceUrl || !sourceDuration) {
      throw new Error("Open a video before processing it.");
    }

    if (
      !Number.isSafeInteger(frameCount) ||
      frameCount < 1 ||
      frameCount > 300
    ) {
      throw new RangeError("Frame count must be an integer between 1 and 300.");
    }

    isProcessing = true;
    processedFrames = [];

    try {
      frameCanvas.width = sourceVideo.videoWidth;
      frameCanvas.height = sourceVideo.videoHeight;

      for (let index = 0; index < frameCount; index += 1) {
        // Sample the middle of each time interval to cover the whole video.
        const timestamp = ((index + 0.5) / frameCount) * sourceDuration;

        await seekTo(sourceVideo, timestamp);

        frameContext.drawImage(
          sourceVideo,
          0,
          0,
          frameCanvas.width,
          frameCanvas.height,
        );

        const frameData = frameContext.getImageData(
          0,
          0,
          frameCanvas.width,
          frameCanvas.height,
        );

        const frame = ImageDataBuffer.fromImageData(frameData);
        const options = getProcessingOptions(frame);

        const result = await processFrame(frame, options);
        processedFrames.push(result);
      }

      const firstFrame = processedFrames[0];

      outputCanvas.width = firstFrame.width;
      outputCanvas.height = firstFrame.height;
      drawFrame(firstFrame);

      // Show the processed result while waiting for video export.
      previewCanvas.width = firstFrame.width;
      previewCanvas.height = firstFrame.height;

      const previewContext = previewCanvas.getContext("2d");
      previewContext.putImageData(firstFrame.toImageData(), 0, 0);

      previewCanvas.hidden = false;
      videoPreview.hidden = true;

      // Reset the source to the beginning before a later export.
      await seekTo(sourceVideo, 0);

      return {
        count: processedFrames.length,
        width: firstFrame.width,
        height: firstFrame.height,
      };
    } finally {
      isProcessing = false;
    }
  }

  /**
   * Process one frame through the existing application worker.
   *
   * @param {ImageDataBuffer} frame
   * @param {object} options
   * @returns {Promise<ImageDataBuffer>}
   */
  function processFrame(frame, options) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};

      const cleanup = () => unsubscribe();

      unsubscribe = app.subscribe((state) => {
        if (state.processing.status === "success" && state.image.result) {
          const result = state.image.result;

          cleanup();

          resolve(
            new ImageDataBuffer(
              result.width,
              result.height,
              new Uint8ClampedArray(result.data),
            ),
          );
        } else if (state.processing.status === "error") {
          cleanup();

          reject(
            new Error(
              state.processing.error?.message ?? "Frame processing failed.",
            ),
          );
        }
      });

      try {
        app.setOriginalImage(frame);
        app.process(options);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  /**
   * Encode the processed frames as WebM using MediaRecorder.
   *
   * Audio is included when the browser exposes an audio track through
   * captureStream(). Actual codec support depends on the browser.
   *
   * @returns {Promise<Blob>}
   */
  async function save() {
    if (processedFrames.length === 0) {
      throw new Error("Process a video before exporting it.");
    }

    if (typeof MediaRecorder === "undefined") {
      throw new Error("Video export is not supported by this browser.");
    }

    if (typeof outputCanvas.captureStream !== "function") {
      throw new Error("Canvas video capture is not supported by this browser.");
    }

    const frameRate = Math.min(
      60,
      Math.max(1, processedFrames.length / sourceDuration),
    );

    const canvasStream = outputCanvas.captureStream(frameRate);
    const sourceCapture = getSourceCaptureStream();

    const tracks = [
      ...canvasStream.getVideoTracks(),
      ...(sourceCapture?.getAudioTracks() ?? []),
    ];

    const combinedStream = new MediaStream(tracks);
    const mimeType = getSupportedMimeType();

    const recorder = mimeType
      ? new MediaRecorder(combinedStream, { mimeType })
      : new MediaRecorder(combinedStream);

    const chunks = [];

    return new Promise((resolve, reject) => {
      let settled = false;
      let animationId = null;

      const cleanup = () => {
        if (animationId !== null) {
          cancelAnimationFrame(animationId);
        }

        sourceVideo.removeEventListener("ended", handleEnded);

        for (const track of combinedStream.getTracks()) {
          track.stop();
        }

        for (const track of sourceCapture?.getTracks() ?? []) {
          track.stop();
        }
      };

      const finish = (error = null) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if (error) {
          reject(error);
          return;
        }

        resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      recorder.addEventListener("error", () => {
        finish(new Error("Video recording failed."));
      });

      recorder.addEventListener("stop", () => {
        finish();
      });

      function renderCurrentFrame() {
        const progress = Math.min(
          0.999999,
          sourceVideo.currentTime / sourceDuration,
        );

        const index = Math.min(
          processedFrames.length - 1,
          Math.floor(progress * processedFrames.length),
        );

        drawFrame(processedFrames[index]);

        if (!sourceVideo.ended && !sourceVideo.paused) {
          animationId = requestAnimationFrame(renderCurrentFrame);
        }
      }

      function handleEnded() {
        drawFrame(processedFrames[processedFrames.length - 1]);

        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }

      sourceVideo.addEventListener("ended", handleEnded, { once: true });

      try {
        // The source is reset to time zero after processing.
        recorder.start(250);
        animationId = requestAnimationFrame(renderCurrentFrame);

        // Start playback during the export button's user interaction.
        const playback = sourceVideo.play();

        playback.catch((error) => {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }

          finish(
            new Error(
              `Unable to play the source video for export: ${error.message}`,
            ),
          );
        });
      } catch (error) {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }

        finish(error);
      }
    });
  }

  /**
   * Get the source media stream, if supported.
   *
   * @returns {MediaStream | null}
   */
  function getSourceCaptureStream() {
    const capture = sourceVideo.captureStream ?? sourceVideo.mozCaptureStream;

    if (typeof capture !== "function") {
      return null;
    }

    try {
      return capture.call(sourceVideo);
    } catch {
      return null;
    }
  }

  /**
   * Select a WebM codec supported by the current browser.
   *
   * @returns {string}
   */
  function getSupportedMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];

    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  }

  /**
   * Draw an ImageDataBuffer to the output canvas.
   *
   * @param {ImageDataBuffer} frame
   */
  function drawFrame(frame) {
    if (
      outputCanvas.width !== frame.width ||
      outputCanvas.height !== frame.height
    ) {
      outputCanvas.width = frame.width;
      outputCanvas.height = frame.height;
    }

    outputContext.putImageData(frame.toImageData(), 0, 0);
  }

  /**
   * Wait until the browser has decoded video metadata.
   *
   * @param {HTMLVideoElement} video
   * @returns {Promise<void>}
   */
  function waitForMetadata(video) {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", handleLoaded);
        video.removeEventListener("error", handleError);
      };

      const handleLoaded = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Unable to decode the selected video."));
      };

      video.addEventListener("loadedmetadata", handleLoaded, { once: true });
      video.addEventListener("error", handleError, { once: true });
    });
  }

  /**
   * Seek the video element to a timestamp and wait for the seek to finish.
   *
   * @param {HTMLVideoElement} video
   * @param {number} timestamp
   * @returns {Promise<void>}
   */
  function seekTo(video, timestamp) {
    const target = Math.max(
      0,
      Math.min(timestamp, Math.max(0, video.duration - 0.001)),
    );

    if (Math.abs(video.currentTime - target) < 0.001) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("seeked", handleSeeked);
        video.removeEventListener("error", handleError);
      };

      const handleSeeked = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Unable to seek to a video frame."));
      };

      video.addEventListener("seeked", handleSeeked, { once: true });
      video.addEventListener("error", handleError, { once: true });

      try {
        video.currentTime = target;
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  /**
   * Release the object URL associated with the source video.
   */
  function releaseSourceUrl() {
    sourceVideo.pause();
    sourceVideo.removeAttribute("src");
    sourceVideo.load();

    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }
  }

  /**
   * Release resources when the application is torn down.
   */
  function dispose() {
    releaseSourceUrl();

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      outputUrl = null;
    }

    processedFrames = [];
  }
}
