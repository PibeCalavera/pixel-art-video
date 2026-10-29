import { ImageDataBuffer } from "../processing/image.js";

const MAX_FRAME_COUNT = 300;
const MAX_FRAME_RATE = 60;
const SEEK_TOLERANCE_SECONDS = 0.001;
const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/**
 * Creates a video processor that reuses the application's image-processing
 * worker to process sampled video frames.
 *
 * @param {object} options
 * @param {object} options.app Application state and worker controller.
 * @param {HTMLCanvasElement} options.previewCanvas Image preview canvas.
 * @param {HTMLVideoElement} options.videoPreview Exported video player.
 * @param {Function} options.getProcessingOptions Resolves processing options.
 * @returns {{loadFile: Function, process: Function, save: Function, dispose: Function}}
 */
export function createVideoProcessor({
  app,
  previewCanvas,
  videoPreview,
  getProcessingOptions,
}) {
  if (!app || typeof app.subscribe !== "function") {
    throw new TypeError("A valid application controller is required.");
  }

  if (!(previewCanvas instanceof HTMLCanvasElement)) {
    throw new TypeError("previewCanvas must be an HTMLCanvasElement.");
  }

  if (!(videoPreview instanceof HTMLVideoElement)) {
    throw new TypeError("videoPreview must be an HTMLVideoElement.");
  }

  if (typeof getProcessingOptions !== "function") {
    throw new TypeError("getProcessingOptions must be a function.");
  }

  const sourceVideo = document.createElement("video");
  sourceVideo.preload = "auto";
  sourceVideo.playsInline = true;
  sourceVideo.muted = false;

  const frameCanvas = document.createElement("canvas");
  const frameContext = frameCanvas.getContext("2d", {
    willReadFrequently: true,
  });

  const outputCanvas = document.createElement("canvas");
  const outputContext = outputCanvas.getContext("2d");

  if (!frameContext || !outputContext) {
    throw new Error("Unable to initialize the video processing canvases.");
  }

  let sourceUrl = null;
  let outputUrl = null;
  let processedFrames = [];
  let sourceDuration = 0;
  let isProcessing = false;
  let isSaving = false;
  let isDisposed = false;

  return { loadFile, process, save, dispose };

  /**
   * Loads a local video file and waits for its metadata.
   *
   * @param {File} file
   * @returns {Promise<{width: number, height: number, duration: number}>}
   */
  async function loadFile(file) {
    assertNotDisposed();

    if (!(file instanceof File) || !file.type.startsWith("video/")) {
      throw new TypeError("Select a valid video file.");
    }

    if (isProcessing || isSaving) {
      throw new Error("Cannot load a video while another operation is active.");
    }

    releaseSourceUrl();
    processedFrames = [];
    sourceDuration = 0;

    sourceUrl = URL.createObjectURL(file);
    sourceVideo.src = sourceUrl;

    try {
      await waitForMetadata(sourceVideo);
      assertNotDisposed();

      if (
        !Number.isFinite(sourceVideo.duration) ||
        sourceVideo.duration <= 0 ||
        sourceVideo.videoWidth <= 0 ||
        sourceVideo.videoHeight <= 0
      ) {
        throw new RangeError(
          "The selected video has an invalid duration or dimensions.",
        );
      }

      sourceDuration = sourceVideo.duration;

      return {
        width: sourceVideo.videoWidth,
        height: sourceVideo.videoHeight,
        duration: sourceDuration,
      };
    } catch (error) {
      releaseSourceUrl();
      throw createOperationError("Unable to load the selected video", error);
    }
  }

  /**
   * Samples the source video evenly and processes each frame sequentially.
   *
   * Sequential processing is required because the application controller
   * uses one active worker request at a time.
   *
   * @param {number} frameCount Number of frames to process.
   * @returns {Promise<{count: number, width: number, height: number}>}
   */
  async function process(frameCount) {
    assertNotDisposed();

    if (isProcessing || isSaving) {
      throw new Error("Another video operation is already in progress.");
    }

    if (!sourceUrl || sourceDuration <= 0) {
      throw new Error("Open a video before processing it.");
    }

    validateFrameCount(frameCount, MAX_FRAME_COUNT);

    isProcessing = true;
    processedFrames = [];

    try {
      frameCanvas.width = sourceVideo.videoWidth;
      frameCanvas.height = sourceVideo.videoHeight;

      const timestamps = Array.from(
        { length: frameCount },
        (_, index) => ((index + 0.5) / frameCount) * sourceDuration,
      );

      processedFrames = await timestamps.reduce(
        (sequence, timestamp, index) =>
          sequence.then(async (results) => {
            assertNotDisposed();

            try {
              await seekTo(sourceVideo, timestamp);
              assertNotDisposed();

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

              results.push(result);
              return results;
            } catch (error) {
              throw createOperationError(
                `Failed to process frame ${index + 1} of ${frameCount}`,
                error,
              );
            }
          }),
        Promise.resolve([]),
      );

      assertNotDisposed();

      const firstFrame = processedFrames[0];

      if (!firstFrame) {
        throw new Error("Video processing did not produce any frames.");
      }

      outputCanvas.width = firstFrame.width;
      outputCanvas.height = firstFrame.height;
      drawFrame(firstFrame);

      previewCanvas.width = firstFrame.width;
      previewCanvas.height = firstFrame.height;

      const previewContext = previewCanvas.getContext("2d");

      if (!previewContext) {
        throw new Error("Unable to initialize the image preview canvas.");
      }

      previewContext.putImageData(firstFrame.toImageData(), 0, 0);

      previewCanvas.hidden = false;
      videoPreview.hidden = true;

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
   * Processes a frame through the existing application worker.
   *
   * The application notifies subscribers synchronously when a request starts.
   * Only terminal success and error states settle this promise.
   *
   * @param {ImageDataBuffer} frame
   * @param {object} options
   * @returns {Promise<ImageDataBuffer>}
   */
  function processFrame(frame, options) {
    assertNotDisposed();

    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => {};

      const cleanup = () => {
        unsubscribe();
        unsubscribe = () => {};
      };

      const settle = (error, result) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      };

      try {
        app.setOriginalImage(frame);

        unsubscribe = app.subscribe((state) => {
          if (settled) {
            return;
          }

          if (state.processing.status === "success" && state.image.result) {
            const result = state.image.result;

            settle(
              null,
              new ImageDataBuffer(
                result.width,
                result.height,
                new Uint8ClampedArray(result.data),
              ),
            );
            return;
          }

          if (state.processing.status === "error") {
            settle(
              createOperationError(
                "Frame processing failed",
                state.processing.error,
              ),
            );
          }
        });

        app.process(options);
      } catch (error) {
        settle(
          createOperationError("Unable to submit frame for processing", error),
        );
      }
    });
  }

  /**
   * Exports the processed frames as WebM using MediaRecorder.
   *
   * The canvas supplies the processed video frames. Source audio is included
   * when the browser supports capturing the source video's audio track.
   *
   * @returns {Promise<Blob>}
   */
  async function save() {
    assertNotDisposed();

    if (isProcessing || isSaving) {
      throw new Error("Another video operation is already in progress.");
    }

    if (processedFrames.length === 0) {
      throw new Error("Process a video before exporting it.");
    }

    if (typeof MediaRecorder === "undefined") {
      throw new TypeError("Video export is not supported by this browser.");
    }

    if (typeof outputCanvas.captureStream !== "function") {
      throw new TypeError(
        "Canvas video capture is not supported by this browser.",
      );
    }

    isSaving = true;

    try {
      return await recordSourcePlayback();
    } finally {
      isSaving = false;
    }
  }

  /**
   * Records processed frames in sync with source playback.
   *
   * @returns {Promise<Blob>}
   */
  function recordSourcePlayback() {
    const frameRate = Math.min(
      MAX_FRAME_RATE,
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

    let recorder;

    try {
      recorder = mimeType
        ? new MediaRecorder(combinedStream, { mimeType })
        : new MediaRecorder(combinedStream);
    } catch (error) {
      stopStreamTracks(combinedStream);
      stopStreamTracks(sourceCapture);
      throw createOperationError("Unable to initialize video recording", error);
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      let animationId = null;

      const cleanup = () => {
        if (animationId !== null) {
          cancelAnimationFrame(animationId);
          animationId = null;
        }

        sourceVideo.removeEventListener("ended", handleEnded);
        recorder.removeEventListener("dataavailable", handleDataAvailable);
        recorder.removeEventListener("error", handleRecordingError);
        recorder.removeEventListener("stop", handleRecordingStopped);

        stopStreamTracks(combinedStream);
        stopStreamTracks(sourceCapture);
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

      const handleDataAvailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const handleRecordingError = (event) => {
        finish(createMediaElementError("Video recording failed", event));
      };

      const handleRecordingStopped = () => {
        finish();
      };

      const renderCurrentFrame = () => {
        if (settled || isDisposed) {
          return;
        }

        const progress = Math.min(
          0.999999,
          sourceVideo.currentTime / sourceDuration,
        );

        const frameIndex = Math.min(
          processedFrames.length - 1,
          Math.floor(progress * processedFrames.length),
        );

        const frame = processedFrames.at(frameIndex);

        if (frame) {
          drawFrame(frame);
        }

        if (!sourceVideo.ended && !sourceVideo.paused) {
          animationId = requestAnimationFrame(renderCurrentFrame);
        }
      };

      const handleEnded = () => {
        const lastFrame = processedFrames.at(-1);

        if (lastFrame) {
          drawFrame(lastFrame);
        }

        if (recorder.state !== "inactive") {
          recorder.stop();
        } else {
          finish();
        }
      };

      recorder.addEventListener("dataavailable", handleDataAvailable);
      recorder.addEventListener("error", handleRecordingError);
      recorder.addEventListener("stop", handleRecordingStopped);
      sourceVideo.addEventListener("ended", handleEnded, { once: true });

      seekTo(sourceVideo, 0)
        .then(() => {
          if (settled || isDisposed) {
            finish(new Error("Video export was cancelled."));
            return;
          }

          recorder.start(250);
          animationId = requestAnimationFrame(renderCurrentFrame);

          return sourceVideo.play();
        })
        .catch((error) => {
          stopRecorder(recorder);
          finish(createOperationError("Unable to start video export", error));
        });
    });
  }

  /**
   * Gets the source media stream when the browser supports captureStream().
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
   * Draws an ImageDataBuffer to the output canvas.
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
   * Releases the source video URL and resets the media element.
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
   * Releases resources when the processor is no longer needed.
   */
  function dispose() {
    if (isDisposed) {
      return;
    }

    isDisposed = true;
    releaseSourceUrl();

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      outputUrl = null;
    }

    processedFrames = [];
    sourceDuration = 0;
  }

  /**
   * Ensures the processor has not been disposed.
   */
  function assertNotDisposed() {
    if (isDisposed) {
      throw new Error("The video processor has been disposed.");
    }
  }
}

/**
 * Returns the first WebM MIME type supported by MediaRecorder.
 *
 * @returns {string}
 */
function getSupportedMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }

  return (
    WEBM_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

/**
 * Waits for video metadata or rejects if the media element reports an error.
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

    const handleError = (event) => {
      cleanup();
      reject(
        createMediaElementError("Unable to decode the selected video", event),
      );
    };

    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

/**
 * Seeks a video element to a timestamp and waits for the seek to finish.
 *
 * @param {HTMLVideoElement} video
 * @param {number} timestamp
 * @returns {Promise<void>}
 */
function seekTo(video, timestamp) {
  const target = Math.max(
    0,
    Math.min(timestamp, Math.max(0, video.duration - SEEK_TOLERANCE_SECONDS)),
  );

  if (Math.abs(video.currentTime - target) < SEEK_TOLERANCE_SECONDS) {
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

    const handleError = (event) => {
      cleanup();
      reject(createMediaElementError("Unable to seek to a video frame", event));
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });

    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(createOperationError("Unable to seek to a video frame", error));
    }
  });
}

/**
 * Stops every track in a media stream, if a stream is available.
 *
 * @param {MediaStream | null | undefined} stream
 */
function stopStreamTracks(stream) {
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Validates the requested number of video frames.
 *
 * @param {number} frameCount
 * @param {number} maximum
 */
function validateFrameCount(frameCount, maximum) {
  if (!Number.isSafeInteger(frameCount)) {
    throw new TypeError("Frame count must be a safe integer.");
  }

  if (frameCount < 1 || frameCount > maximum) {
    throw new RangeError(`Frame count must be between 1 and ${maximum}.`);
  }
}

/**
 * Stops a MediaRecorder without propagating an invalid-state exception.
 *
 * @param {MediaRecorder} recorder
 */
function stopRecorder(recorder) {
  if (recorder.state === "inactive") {
    return;
  }

  try {
    recorder.stop();
  } catch {
    // The recorder may have become inactive between the state check and stop().
  }
}

/**
 * Creates a readable description of an arbitrary error cause.
 *
 * @param {unknown} cause
 * @returns {string}
 */
function stringifyCause(cause) {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "string") {
    return cause;
  }

  if (cause === null || cause === undefined) {
    return "Unknown error.";
  }

  if (
    typeof cause === "number" ||
    typeof cause === "boolean" ||
    typeof cause === "bigint"
  ) {
    return String(cause);
  }

  try {
    const serialized = JSON.stringify(cause);

    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fall through when the cause cannot be serialized.
  }

  return Object.prototype.toString.call(cause);
}

/**
 * Wraps an operation error while retaining the original cause.
 *
 * @param {string} operation
 * @param {unknown} cause
 * @returns {Error}
 */
function createOperationError(operation, cause) {
  const detail = stringifyCause(cause);
  return new Error(`${operation}: ${detail}`, { cause });
}

/**
 * Creates a descriptive error for media-element events.
 *
 * @param {string} operation
 * @param {Event | unknown} cause
 * @returns {Error}
 */
function createMediaElementError(operation, cause) {
  const mediaError =
    cause instanceof Event && cause.currentTarget instanceof HTMLMediaElement
      ? cause.currentTarget.error
      : null;

  const detail = mediaError
    ? `Media error code ${mediaError.code}: ${mediaError.message || "No additional details."}`
    : stringifyCause(cause);

  return new Error(`${operation}: ${detail}`, { cause });
}
