import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let ffmpeg = null;
let loadingPromise = null;
let conversionPromise = null;

/**
 * Initializes FFmpeg once and reuses the instance.
 *
 * @returns {Promise<FFmpeg>}
 */
async function getFFmpeg() {
  if (ffmpeg?.loaded) {
    return ffmpeg;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    const instance = new FFmpeg();

    instance.on("log", ({ message }) => {
      console.info("[FFmpeg]", message);
    });

    instance.on("progress", ({ progress }) => {
      const percentage = Math.min(100, Math.max(0, Math.round(progress * 100)));

      console.info(`[FFmpeg] Conversion progress: ${percentage}%`);
    });

    await instance.load({ coreURL, wasmURL });

    ffmpeg = instance;

    console.info("[FFmpeg] Initialized successfully.");

    return instance;
  })();

  try {
    return await loadingPromise;
  } catch (error) {
    loadingPromise = null;
    ffmpeg = null;

    console.error("[FFmpeg] Initialization failed:", error);

    throw new Error(`Unable to initialize FFmpeg: ${error?.message ?? error}`);
  } finally {
    if (!ffmpeg) {
      loadingPromise = null;
    }
  }
}

/**
 * Converts a WebM Blob into an MP4 Blob using H.264 and AAC.
 *
 * @param {Blob} webmBlob
 * @returns {Promise<Blob>}
 */
export async function convertWebMToMP4(webmBlob) {
  if (!(webmBlob instanceof Blob) || webmBlob.size === 0) {
    throw new TypeError("A valid WebM Blob is required.");
  }

  // Prevent simultaneous conversions using the same FFmpeg instance.
  if (conversionPromise) {
    throw new Error("Another video conversion is already running.");
  }

  conversionPromise = performConversion(webmBlob);

  try {
    return await conversionPromise;
  } finally {
    conversionPromise = null;
  }
}

/**
 * Perform the actual WebM to MP4 conversion.
 *
 * @param {Blob} webmBlob
 * @returns {Promise<Blob>}
 */
async function performConversion(webmBlob) {
  const instance = await getFFmpeg();

  const inputName = "input.webm";
  const outputName = "output.mp4";

  try {
    console.info(
      `[FFmpeg] Starting conversion. Input size: ${(
        webmBlob.size /
        (1024 * 1024)
      ).toFixed(2)} MB`,
    );

    // Remove files left by a previous unsuccessful conversion.
    for (const filename of [inputName, outputName]) {
      try {
        await instance.deleteFile(filename);
      } catch {
        // The file may not exist yet.
      }
    }

    // Write the WebM input into FFmpeg's virtual filesystem.
    await instance.writeFile(inputName, await fetchFile(webmBlob));

    // Verify that the input was written correctly.
    const inputStats = await instance.listDir("/");

    const inputFile = inputStats.find((file) => file.name === inputName);

    if (!inputFile) {
      throw new Error("FFmpeg could not find the input WebM file.");
    }

    console.info("[FFmpeg] Input file is ready.");

    // Convert video to H.264 and audio to AAC when an audio stream exists.
    const exitCode = await instance.exec([
      "-y",
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    console.info("[FFmpeg] Exit code:", exitCode);

    if (exitCode !== 0) {
      throw new Error(
        `FFmpeg conversion process exited with code ${exitCode}.`,
      );
    }

    // Verify that FFmpeg created the output file.
    const outputFiles = await instance.listDir("/");

    const outputFile = outputFiles.find((file) => file.name === outputName);

    if (!outputFile) {
      throw new Error("FFmpeg did not create the output MP4 file.");
    }

    // Read the generated MP4.
    const output = await instance.readFile(outputName);

    console.info("[FFmpeg] Output data:", {
      type: output?.constructor?.name,
      length: output?.length,
    });

    if (!output || output.length === 0) {
      throw new Error("FFmpeg generated an empty MP4 file.");
    }

    // Create the final MP4 Blob.
    const mp4Blob = new Blob([output], { type: "video/mp4" });

    if (mp4Blob.size === 0) {
      throw new Error("The generated MP4 Blob is empty.");
    }

    console.info(
      `[FFmpeg] Conversion completed. Output size: ${(
        mp4Blob.size /
        (1024 * 1024)
      ).toFixed(2)} MB`,
    );

    return mp4Blob;
  } catch (error) {
    console.error("[FFmpeg] Conversion failed:", error);

    throw new Error(`MP4 conversion failed: ${error?.message ?? error}`);
  } finally {
    // Clean up temporary files without destroying the reusable FFmpeg instance.
    for (const filename of [inputName, outputName]) {
      try {
        await instance.deleteFile(filename);
      } catch {
        // The file may not exist if conversion failed early.
      }
    }
  }
}
