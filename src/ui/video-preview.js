/**
 * Create and manage the visible video preview.
 *
 * @param {HTMLVideoElement} videoElement
 * @returns {object}
 */
export function createVideoPreview(videoElement) {
  if (!(videoElement instanceof HTMLVideoElement)) {
    throw new TypeError("Expected an HTMLVideoElement.");
  }

  let sourceVideoUrl = null;
  let processedVideoUrl = null;
  let exportedVideoUrl = null;

  /**
   * Release an object URL.
   *
   * @param {string | null} url
   */
  function releaseUrl(url) {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Display a video using an object URL.
   *
   * @param {string} url
   */
  function display(url) {
    videoElement.pause();
    videoElement.src = url;
    videoElement.controls = true;
    videoElement.muted = false;
    videoElement.playsInline = true;
    videoElement.hidden = false;
    videoElement.load();
  }

  /**
   * Display the original video.
   *
   * @param {File} file
   */
  function showOriginal(file) {
    if (!(file instanceof File)) {
      throw new TypeError("Expected a video file.");
    }

    clear();

    sourceVideoUrl = URL.createObjectURL(file);

    display(sourceVideoUrl);
  }

  /**
   * Display the processed video without downloading it.
   *
   * @param {Blob} blob
   */
  function showProcessed(blob) {
    validateVideoBlob(blob);

    releaseUrl(processedVideoUrl);
    releaseUrl(exportedVideoUrl);

    processedVideoUrl = URL.createObjectURL(blob);
    exportedVideoUrl = null;

    display(processedVideoUrl);
  }

  /**
   * Display and download the exported video.
   *
   * @param {Blob} blob
   * @param {string} [filename="pixel-art-video.webm"]
   */
  function showExported(blob, filename = "pixel-art-video.webm") {
    validateVideoBlob(blob);

    releaseUrl(exportedVideoUrl);

    exportedVideoUrl = URL.createObjectURL(blob);

    display(exportedVideoUrl);

    const link = document.createElement("a");

    link.href = exportedVideoUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /**
   * Clear the video player and release all owned URLs.
   */
  function clear() {
    videoElement.pause();
    videoElement.removeAttribute("src");
    videoElement.load();

    releaseUrl(sourceVideoUrl);
    releaseUrl(processedVideoUrl);
    releaseUrl(exportedVideoUrl);

    sourceVideoUrl = null;
    processedVideoUrl = null;
    exportedVideoUrl = null;
  }

  /**
   * Release all resources.
   */
  function dispose() {
    clear();
  }

  return { showOriginal, showProcessed, showExported, clear, dispose };
}

/**
 * Validate a video Blob.
 *
 * @param {Blob} blob
 */
function validateVideoBlob(blob) {
  if (!(blob instanceof Blob)) {
    throw new TypeError("Expected a video Blob.");
  }

  if (blob.size === 0) {
    throw new Error("The video is empty.");
  }
}
