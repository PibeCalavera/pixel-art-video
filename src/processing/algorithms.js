import {
  resizeNearest,
  resizeBilinear,
  resizeLanczos,
} from "./resize/index.js";

import { quantizeNearest } from "./quantization/nearest.js";

import {
  ditherNone,
  ditherBayer,
  ditherFloydSteinberg,
  ditherAtkinson,
  ditherPair,
  ditherRetroRGBK,
  ditherRGBStripe,
} from "./dithering/index.js";

const RESIZE_ALGORITHMS = {
  nearest: resizeNearest,
  bilinear: resizeBilinear,
  lanczos: resizeLanczos,
};

const QUANTIZATION_ALGORITHMS = { nearest: quantizeNearest };

const DITHERING_ALGORITHMS = {
  none: ditherNone,
  bayer: ditherBayer,
  "floyd-steinberg": ditherFloydSteinberg,
  atkinson: ditherAtkinson,
  "pair-dither": ditherPair,
  rgbk: ditherRetroRGBK,
  "rgb-stripe": ditherRGBStripe,
};

export function getResizeAlgorithm(name) {
  return resolveAlgorithm(RESIZE_ALGORITHMS, name, "resize");
}

export function getQuantizationAlgorithm(name) {
  return resolveAlgorithm(QUANTIZATION_ALGORITHMS, name, "quantization");
}

export function getDitheringAlgorithm(name) {
  return resolveAlgorithm(DITHERING_ALGORITHMS, name, "dithering");
}

function resolveAlgorithm(algorithms, name, category) {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError(
      `${category} algorithm name must be a non-empty string.`,
    );
  }

  const algorithm = algorithms[name];

  if (!algorithm) {
    throw new RangeError(`Unknown ${category} algorithm: "${name}".`);
  }

  return algorithm;
}
