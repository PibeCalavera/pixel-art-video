import { ImageDataBuffer } from "../processing/image.js";
import { fixWebmDuration } from "@fix-webm-duration/fix";

const MIN_FRAME_RATE = 1;
const MAX_FRAME_RATE = 60;
const MAX_FRAME_COUNT = 300;
const SEEK_TOLERANCE_SECONDS = 0.001;

const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/**
 * Creates a video processor using the application's image-processing worker.
 *
 * @param {object} options
 * @param {object} options.app
 * @param {Function} options.getProcessingOptions
 * @returns {{loadFile: Function, process: Function, save: Function, invalidate: Function, dispose: Function}}
 */
export function createVideoProcessor({ app, getProcessingOptions }) {
  if (!app || typeof app.subscribe !== "function") {
    throw new TypeError("A valid application controller is required.");
  }

  if (typeof getProcessingOptions !== "function") {
    throw new TypeError("getProcessingOptions must be a function.");
  }

  const sourceVideo = document.createElement("video");
  sourceVideo.preload = "auto";
  sourceVideo.playsInline = true;
  sourceVideo.muted = true;

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
  let processedFrames = [];
  let previewBlob = null;
  let sourceDuration = 0;
  let processedFrameRate = 24;
  let isProcessing = false;
  let isSaving = false;
  let isDisposed = false;
  let operationVersion = 0;

  let audioVideo = null;
  let audioContext = null;
  let audioSourceNode = null;
  let audioDestination = null;

  return { loadFile, process, save, invalidate, dispose };

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

    invalidate();
    releaseSourceUrl();
    releaseAudioVideo();

    sourceDuration = 0;

    sourceUrl = URL.createObjectURL(file);
    sourceVideo.src = sourceUrl;
    sourceVideo.load();

    try {
      await waitForMetadata(sourceVideo);
      assertNotDisposed();

      if (
        !Number.isFinite(sourceVideo.duration) ||
        sourceVideo.duration <= 0 ||
        sourceVideo.videoWidth <= 0 ||
        sourceVideo.videoHeight <= 0
      ) {
        throw new RangeError("The video has invalid duration or dimensions.");
      }

      sourceDuration = sourceVideo.duration;

      // Create an independent video element for audio playback.
      audioVideo = document.createElement("video");
      audioVideo.preload = "auto";
      audioVideo.playsInline = true;
      audioVideo.muted = false;
      audioVideo.volume = 1;
      audioVideo.src = sourceUrl;
      audioVideo.load();

      await waitForMetadata(audioVideo);
      assertNotDisposed();

      return {
        width: sourceVideo.videoWidth,
        height: sourceVideo.videoHeight,
        duration: sourceDuration,
      };
    } catch (error) {
      releaseSourceUrl();
      releaseAudioVideo();

      throw createOperationError("Unable to load the selected video", error);
    }
  }

  /**
   * Processes the source video and generates a playable WebM preview.
   *
   * @param {number} frameRate Frames per second.
   * @returns {Promise<{count: number, frameRate: number, width: number, height: number, blob: Blob}>}
   */
  async function process(frameRate) {
    assertNotDisposed();

    if (isProcessing || isSaving) {
      throw new Error("Another video operation is already in progress.");
    }

    if (!sourceUrl || sourceDuration <= 0) {
      throw new Error("Open a video before processing it.");
    }

    validateFrameRate(frameRate);

    if (!audioVideo) {
      throw new Error("The original audio source is not available.");
    }

    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new TypeError("Web Audio API is not supported by this browser.");
    }

    if (!audioContext) {
      audioContext = new AudioContextConstructor();
    }

    if (audioContext.state === "closed") {
      throw new Error("The audio context is no longer available.");
    }

    const audioContextReady = audioContext.resume();

    const frameCount = Math.ceil(sourceDuration * frameRate);

    if (frameCount > MAX_FRAME_COUNT) {
      throw new RangeError(
        `This video requires ${frameCount} frames at ${frameRate} FPS. ` +
          `The maximum is ${MAX_FRAME_COUNT} frames. Choose a lower frame rate.`,
      );
    }

    isProcessing = true;
    invalidate();

    const currentVersion = operationVersion;

    try {
      await audioContextReady;

      frameCanvas.width = sourceVideo.videoWidth;
      frameCanvas.height = sourceVideo.videoHeight;

      const timestamps = Array.from({ length: frameCount }, (_, index) =>
        Math.min(
          (index + 0.5) / frameRate,
          Math.max(0, sourceDuration - SEEK_TOLERANCE_SECONDS),
        ),
      );

      const results = [];

      for (let index = 0; index < timestamps.length; index += 1) {
        assertNotDisposed();
        assertOperationVersion(currentVersion);

        try {
          await seekTo(sourceVideo, timestamps[index]);

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

          assertOperationVersion(currentVersion);

          results.push(result);
        } catch (error) {
          throw createOperationError(
            `Failed to process frame ${index + 1} of ${frameCount}`,
            error,
          );
        }
      }

      assertNotDisposed();
      assertOperationVersion(currentVersion);

      if (results.length === 0) {
        throw new Error("Video processing did not produce any frames.");
      }

      const firstFrame = results[0];

      outputCanvas.width = firstFrame.width;
      outputCanvas.height = firstFrame.height;

      processedFrames = results;
      processedFrameRate = frameRate;

      // Generate the actual playable video before reporting success.
      previewBlob = await recordProcessedFrames(results, frameRate);

      assertNotDisposed();
      assertOperationVersion(currentVersion);

      await seekTo(sourceVideo, 0);

      return {
        count: processedFrames.length,
        frameRate: processedFrameRate,
        width: firstFrame.width,
        height: firstFrame.height,
        blob: previewBlob,
      };
    } catch (error) {
      if (operationVersion === currentVersion) {
        processedFrames = [];
        previewBlob = null;
      }

      throw error;
    } finally {
      isProcessing = false;
    }
  }

  /**
   * Sends one frame through the existing image-processing worker.
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
          } else if (state.processing.status === "error") {
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
   * Records the processed frames and original audio into a playable WebM.
   *
   * Video is captured from the output canvas. Audio is captured independently
   * from the original video through the Web Audio API.
   *
   * Frame scheduling uses the original video's duration as its timing reference.
   *
   * @param {ImageDataBuffer[]} frames
   * @param {number} frameRate
   * @returns {Promise<Blob>}
   */
  async function recordProcessedFrames(frames, frameRate) {
    if (typeof MediaRecorder === "undefined") {
      throw new TypeError("Video recording is not supported by this browser.");
    }

    if (typeof outputCanvas.captureStream !== "function") {
      throw new TypeError(
        "Canvas video capture is not supported by this browser.",
      );
    }

    if (!audioVideo) {
      throw new Error("The original audio source is not available.");
    }

    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new TypeError("Web Audio API is not supported by this browser.");
    }

    if (!audioContext) {
      audioContext = new AudioContextConstructor();
    }

    if (audioContext.state === "closed") {
      throw new Error("The audio context is no longer available.");
    }

    await audioContext.resume();

    // Use manual frame capture when supported by the browser.
    const videoStream = outputCanvas.captureStream(0);
    const videoTrack = videoStream.getVideoTracks()[0];

    if (!videoTrack) {
      stopStreamTracks(videoStream);
      throw new Error("Unable to create a video capture track.");
    }

    const supportsManualCapture = typeof videoTrack.requestFrame === "function";

    // Fall back to automatic capture if requestFrame() is unavailable.
    let recordingStream = videoStream;

    if (!supportsManualCapture) {
      stopStreamTracks(videoStream);
      recordingStream = outputCanvas.captureStream(frameRate);
    }

    let stream = null;

    try {
      // Route the original video's audio to a recording-only destination.
      audioDestination = audioContext.createMediaStreamDestination();

      if (!audioSourceNode) {
        audioSourceNode = audioContext.createMediaElementSource(audioVideo);
      }

      audioSourceNode.connect(audioDestination);

      stream = new MediaStream([
        ...recordingStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);

      const mimeType = getSupportedMimeType();

      let recorder;

      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (error) {
        throw createOperationError(
          "Unable to initialize video recording",
          error,
        );
      }

      return await new Promise((resolve, reject) => {
        const chunks = [];
        let settled = false;
        let timer = null;
        let frameIndex = 0;
        let recordingStartTime = 0;

        const cleanup = () => {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }

          recorder.removeEventListener("dataavailable", handleDataAvailable);
          recorder.removeEventListener("error", handleRecordingError);
          recorder.removeEventListener("stop", handleRecordingStopped);

          audioVideo.pause();

          // Keep audioSourceNode available for subsequent recordings.
          if (audioSourceNode) {
            audioSourceNode.disconnect();
          }

          if (audioDestination) {
            stopStreamTracks(audioDestination.stream);
            audioDestination = null;
          }

          stopStreamTracks(recordingStream);
        };

        const finish = async (error = null) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();

          if (error) {
            reject(error);
            return;
          }

          try {
            const blob = new Blob(chunks, {
              type: recorder.mimeType || "video/webm",
            });

            if (blob.size === 0) {
              throw new Error("Video recording produced an empty file.");
            }

            // Preserve the original video's exact duration.
            const duration = sourceDuration * 1000;

            const fixedBlob = await fixWebmDuration(blob, duration, {
              logger: false,
            });

            if (!fixedBlob || fixedBlob.size === 0) {
              throw new Error(
                "WebM metadata correction produced an empty file.",
              );
            }

            resolve(fixedBlob);
          } catch (error) {
            reject(
              createOperationError(
                "Unable to add duration metadata to the WebM video",
                error,
              ),
            );
          }
        };

        const finishWithError = (error) => {
          void finish(error).catch((finishError) => {
            console.error("[Pixel Art] Video finalization error:", finishError);
          });
        };

        const handleDataAvailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        const handleRecordingError = (event) => {
          finishWithError(
            createMediaElementError("Video recording failed", event),
          );
        };

        const handleRecordingStopped = () => {
          void finish().catch((error) => {
            console.error("[Pixel Art] Video finalization error:", error);
          });
        };

        /**
         * Captures the next frame according to elapsed recording time.
         *
         * The timer is recalculated on every iteration instead of assuming
         * that setTimeout() executes at an exact frame interval.
         */
        const renderNextFrame = () => {
          if (settled) {
            return;
          }

          try {
            assertNotDisposed();

            const elapsed = (performance.now() - recordingStartTime) / 1000;

            // Stop at the original video's duration.
            if (elapsed >= sourceDuration) {
              stopRecorder(recorder);
              return;
            }

            // Capture every frame that should have been displayed by now.
            if (
              frameIndex < frames.length &&
              elapsed >= frameIndex / frameRate
            ) {
              drawFrame(frames[frameIndex]);

              if (supportsManualCapture) {
                videoTrack.requestFrame();
              }

              frameIndex += 1;
            }

            // Calculate when the next frame should be captured.
            const nextFrameTime =
              frameIndex < frames.length
                ? frameIndex / frameRate
                : sourceDuration;

            const remainingTime = Math.max(
              0,
              nextFrameTime - (performance.now() - recordingStartTime) / 1000,
            );

            timer = setTimeout(
              renderNextFrame,
              Math.max(1, remainingTime * 1000),
            );
          } catch (error) {
            stopRecorder(recorder);
            finishWithError(error);
          }
        };

        /**
         * Starts audio playback and then starts frame scheduling.
         *
         * Keeping this as an independent async function avoids nested
         * promise callbacks and floating promises.
         *
         * @returns {Promise<void>}
         */
        const startRecordingPlayback = async () => {
          try {
            await audioVideo.play();

            if (settled) {
              return;
            }

            // Start the recording clock only after audio playback begins.
            recordingStartTime = performance.now();

            // Capture the first frame immediately.
            renderNextFrame();
          } catch (error) {
            stopRecorder(recorder);

            finishWithError(
              createOperationError(
                "Unable to play the original video's audio",
                error,
              ),
            );
          }
        };

        recorder.addEventListener("dataavailable", handleDataAvailable);
        recorder.addEventListener("error", handleRecordingError);
        recorder.addEventListener("stop", handleRecordingStopped);

        try {
          recorder.start(250);

          // Start audio playback from the beginning.
          audioVideo.currentTime = 0;

          // Explicitly handle the returned promise.
          void startRecordingPlayback();
        } catch (error) {
          stopRecorder(recorder);

          finishWithError(
            createOperationError("Unable to record processed frames", error),
          );
        }
      });
    } catch (error) {
      if (audioSourceNode) {
        // Disconnect but preserve the node for subsequent recordings.
        audioSourceNode.disconnect();
      }

      if (audioDestination) {
        stopStreamTracks(audioDestination.stream);
        audioDestination = null;
      }

      stopStreamTracks(recordingStream);

      throw error;
    }
  }

  /**
   * Returns the previously generated WebM.
   *
   * Exporting does not record the canvas again. This prevents repeated
   * exports from depending on playback or captureStream timing.
   *
   * @returns {Promise<Blob>}
   */
  async function save() {
    assertNotDisposed();

    if (isProcessing || isSaving) {
      throw new Error("Another video operation is already in progress.");
    }

    if (!previewBlob || previewBlob.size === 0) {
      throw new Error("Process a video before exporting it.");
    }

    isSaving = true;

    try {
      return previewBlob;
    } finally {
      isSaving = false;
    }
  }

  /**
   * Invalidates the previously processed result.
   *
   * Call this whenever processing settings change.
   */
  function invalidate() {
    operationVersion += 1;

    processedFrames = [];
    previewBlob = null;
  }

  /**
   * Draws a processed frame to the output canvas.
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
   * Releases the source video's object URL.
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
   * Releases the independent audio playback element and its resources.
   */
  function releaseAudioVideo() {
    if (audioVideo) {
      audioVideo.pause();
      audioVideo.removeAttribute("src");
      audioVideo.load();

      audioVideo = null;
    }

    if (audioSourceNode) {
      audioSourceNode.disconnect();
      audioSourceNode = null;
    }

    if (audioDestination) {
      stopStreamTracks(audioDestination.stream);
      audioDestination = null;
    }
  }

  /**
   * Releases processor resources.
   */
  function dispose() {
    if (isDisposed) {
      return;
    }

    isDisposed = true;
    invalidate();

    releaseSourceUrl();
    releaseAudioVideo();

    sourceDuration = 0;

    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch((error) => {
        console.warn("[Pixel Art] Unable to close audio context:", error);
      });
    }

    audioContext = null;
  }

  /**
   * Checks whether the processor has been disposed.
   */
  function assertNotDisposed() {
    if (isDisposed) {
      throw new Error("The video processor has been disposed.");
    }
  }

  /**
   * Checks whether an asynchronous processing operation is still current.
   *
   * @param {number} version
   */
  function assertOperationVersion(version) {
    if (version !== operationVersion) {
      throw new Error("Video processing was invalidated.");
    }
  }
}

/**
 * Validates the requested frame rate.
 *
 * @param {number} frameRate
 */
function validateFrameRate(frameRate) {
  if (!Number.isFinite(frameRate)) {
    throw new TypeError("Frame rate must be a number.");
  }

  if (
    !Number.isInteger(frameRate) ||
    frameRate < MIN_FRAME_RATE ||
    frameRate > MAX_FRAME_RATE
  ) {
    throw new RangeError(
      `Frame rate must be an integer between ${MIN_FRAME_RATE} and ${MAX_FRAME_RATE} FPS.`,
    );
  }
}

/**
 * Selects a supported WebM MIME type.
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
 * Waits for the video metadata to become available.
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
 * Seeks the video element to the requested timestamp.
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
 * Stops every track in a media stream.
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
 * Stops a MediaRecorder when it is active.
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
    // The recorder may have become inactive before stop() was called.
  }
}

/**
 * Converts an arbitrary error cause into readable text.
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
    // Use a fallback for non-serializable values.
  }

  return Object.prototype.toString.call(cause);
}

/**
 * Wraps an operation error while preserving its original cause.
 *
 * @param {string} operation
 * @param {unknown} cause
 * @returns {Error}
 */
function createOperationError(operation, cause) {
  return new Error(`${operation}: ${stringifyCause(cause)}`, { cause });
}

/**
 * Creates a readable error for a media-element event.
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
