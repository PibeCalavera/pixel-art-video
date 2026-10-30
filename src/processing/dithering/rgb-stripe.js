import { ImageDataBuffer } from "../image.js";

const DEFAULT_LEVELS = [0, 33, 66, 100];
const DEFAULT_ORDER = ["R", "G", "B"];

const CHANNEL_INDEX = { R: 0, G: 1, B: 2 };

/**
 * Converts an image into a three-band RGB stripe pattern.
 *
 * Each source pixel becomes a 3x3 block. Every band has a uniform
 * intensity selected from the configured intensity levels.
 *
 * Fully transparent pixels remain transparent. All other pixels
 * are processed as fully opaque.
 *
 * @param {ImageDataBuffer} image
 * @param {Object} [options={}]
 * @param {"horizontal"|"vertical"} [options.layout="horizontal"]
 * @param {string[]} [options.channelOrder=["R","G","B"]]
 * @param {number[]} [options.intensityLevels=[0,33,66,100]]
 * @returns {ImageDataBuffer}
 */
export function ditherRGBStripe(image, options = {}) {
  assertImage(image);

  const {
    layout = "horizontal",
    channelOrder = DEFAULT_ORDER,
    intensityLevels = DEFAULT_LEVELS,
  } = options;

  validateOptions(layout, channelOrder, intensityLevels);

  const output = ImageDataBuffer.empty(image.width * 3, image.height * 3);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;

      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const alpha = image.data[offset + 3];

      if (alpha === 0) continue;

      const intensities = findClosestIntensities(
        red,
        green,
        blue,
        intensityLevels,
      );

      drawStripeBlock(output, x * 3, y * 3, intensities, layout, channelOrder);
    }
  }

  return output;
}

/**
 * Draws the three RGB bands inside a 3x3 block.
 *
 * @param {ImageDataBuffer} output
 * @param {number} outputX
 * @param {number} outputY
 * @param {number[]} intensities
 * @param {"horizontal"|"vertical"} layout
 * @param {string[]} channelOrder
 */
function drawStripeBlock(
  output,
  outputX,
  outputY,
  intensities,
  layout,
  channelOrder,
) {
  for (let band = 0; band < 3; band++) {
    const channel = CHANNEL_INDEX[channelOrder[band]];
    const color = createBandColor(channel, intensities[channel]);

    for (let cell = 0; cell < 3; cell++) {
      const pixelX = layout === "vertical" ? outputX + band : outputX + cell;
      const pixelY = layout === "vertical" ? outputY + cell : outputY + band;

      output.setPixel(pixelX, pixelY, color);
    }
  }
}

/**
 * Finds the RGB intensity combination closest to the source color.
 * Color distance is calculated in linear-light RGB.
 *
 * @param {number} red
 * @param {number} green
 * @param {number} blue
 * @param {number[]} levels
 * @returns {number[]}
 */
function findClosestIntensities(red, green, blue, levels) {
  const target = [
    srgbToLinear(red / 255),
    srgbToLinear(green / 255),
    srgbToLinear(blue / 255),
  ];

  let best = [0, 0, 0];
  let bestDistance = Infinity;

  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        const candidate = [r / 100, g / 100, b / 100];
        const distance = calculateColorDistance(target, candidate);

        if (distance < bestDistance) {
          bestDistance = distance;
          best = [r, g, b];
        }
      }
    }
  }

  return best;
}

/**
 * Calculates squared Euclidean distance between two RGB colors.
 *
 * @param {number[]} first
 * @param {number[]} second
 * @returns {number}
 */
function calculateColorDistance(first, second) {
  return first.reduce(
    (distance, value, index) => distance + (value - second[index]) ** 2,
    0,
  );
}

/**
 * Creates an opaque color emitted by one RGB band.
 *
 * @param {number} channel
 * @param {number} intensity
 * @returns {{r:number,g:number,b:number,a:number}}
 */
function createBandColor(channel, intensity) {
  const value = Math.round(linearToSrgb(intensity / 100) * 255);

  return {
    r: channel === 0 ? value : 0,
    g: channel === 1 ? value : 0,
    b: channel === 2 ? value : 0,
    a: 255,
  };
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

function validateOptions(layout, channelOrder, levels) {
  validateLayout(layout);
  validateChannelOrder(channelOrder);
  validateIntensityLevels(levels);
}

function validateLayout(layout) {
  if (layout !== "horizontal" && layout !== "vertical") {
    throw new RangeError(
      'RGB Stripe layout must be "horizontal" or "vertical".',
    );
  }
}

function validateChannelOrder(channelOrder) {
  const valid =
    Array.isArray(channelOrder) &&
    channelOrder.length === 3 &&
    new Set(channelOrder).size === 3 &&
    channelOrder.every((channel) => Object.hasOwn(CHANNEL_INDEX, channel));

  if (!valid) {
    throw new TypeError(
      "RGB Stripe channel order must contain R, G and B exactly once.",
    );
  }
}

function validateIntensityLevels(levels) {
  const valid =
    Array.isArray(levels) &&
    levels.length >= 2 &&
    levels[0] === 0 &&
    levels.at(-1) === 100 &&
    levels.every(
      (level, index) =>
        Number.isInteger(level) &&
        level >= 0 &&
        level <= 100 &&
        (index === 0 || level > levels[index - 1]),
    );

  if (!valid) {
    throw new RangeError(
      "RGB Stripe intensity levels must be strictly increasing integers from 0 to 100, including both endpoints.",
    );
  }
}

function assertImage(image) {
  if (!(image instanceof ImageDataBuffer)) {
    throw new TypeError("Expected an ImageDataBuffer.");
  }
}
