import { ImageDataBuffer } from "./image.js";

/**
 * Processing pipeline.
 *
 * The pipeline orchestrates the processing stages but does not implement
 * any image-processing algorithm itself.
 *
 * Each stage receives an ImageDataBuffer and must return an ImageDataBuffer.
 *
 * Typical pipeline:
 *
 *   Input
 *     ↓
 *   Resize
 *     ↓
 *   Quantization
 *     ↓
 *   Dithering
 *     ↓
 *   Output
 */

/**
 * Creates a processing pipeline.
 *
 * @param {Object} options
 * @param {Function|null} [options.resize=null]
 * @param {Function|null} [options.quantize=null]
 * @param {Function|null} [options.dither=null]
 * @returns {ProcessingPipeline}
 */
export function createPipeline({
  resize = null,
  quantize = null,
  dither = null,
} = {}) {
  return new ProcessingPipeline({ resize, quantize, dither });
}

export class ProcessingPipeline {
  /**
   * @param {Object} stages
   * @param {Function|null} [stages.resize]
   * @param {Function|null} [stages.quantize]
   * @param {Function|null} [stages.dither]
   */
  constructor({ resize = null, quantize = null, dither = null } = {}) {
    this.stages = {
      resize: validateStage(resize, "resize"),
      quantize: validateStage(quantize, "quantize"),
      dither: validateStage(dither, "dither"),
    };
  }

  /**
   * Processes an image through all configured stages.
   *
   * @param {ImageDataBuffer} image
   * @param {Object} [options={}]
   * @returns {ImageDataBuffer}
   */
  process(image, options = {}) {
    assertImage(image);

    let result = image;

    result = this.runStage("resize", result, options.resize ?? {}, options);

    result = this.runStage("quantize", result, options.quantize ?? {}, options);

    result = this.runStage("dither", result, options.dither ?? {}, options);

    return result;
  }

  /**
   * Runs a single processing stage.
   *
   * @param {string} name
   * @param {ImageDataBuffer} image
   * @param {Object} stageOptions
   * @param {Object} pipelineOptions
   * @returns {ImageDataBuffer}
   */
  runStage(name, image, stageOptions, pipelineOptions) {
    const stage = this.stages[name];

    if (!stage) {
      return image;
    }

    const result = stage(image, stageOptions, pipelineOptions);

    assertImage(result);

    return result;
  }
}

/**
 * Creates a pipeline directly from stage functions.
 *
 * This is useful when the selected algorithms are resolved elsewhere,
 * for example by the Worker.
 *
 * @param {Object} stages
 * @returns {ProcessingPipeline}
 */
export function pipelineFromStages(stages) {
  return new ProcessingPipeline(stages);
}

/**
 * Validates a processing stage.
 *
 * @param {Function|null} stage
 * @param {string} name
 * @returns {Function|null}
 */
function validateStage(stage, name) {
  if (stage !== null && typeof stage !== "function") {
    throw new TypeError(`Pipeline stage "${name}" must be a function or null.`);
  }

  return stage;
}

/**
 * Ensures that a value is an ImageDataBuffer.
 *
 * @param {ImageDataBuffer} image
 */
function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError(
      "Pipeline stages must receive and return ImageDataBuffer instances.",
    );
  }
}
