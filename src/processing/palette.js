import paletteDefinitions from "../data/palettes.json";
/**
 * Immutable-ish palette representation used by the processing layer.
 *
 * UI/state should store palette IDs instead of Palette instances.
 * Use getPalette(id) when a processing stage needs the actual palette.
 */

export class Palette {
  constructor(colors, name = "Custom") {
    if (!Array.isArray(colors) || colors.length === 0) {
      throw new TypeError("A palette must contain at least one color.");
    }
    if (typeof name !== "string" || name.trim() === "") {
      throw new TypeError("Palette name must be a non-empty string.");
    }
    this.name = name;
    this.colors = colors.map(validateColor);
  }

  get size() {
    return this.colors.length;
  }

  get(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.colors.length) {
      throw new RangeError(`Palette index out of range: ${index}.`);
    }
    return { ...this.colors[index] };
  }

  toArray() {
    return this.colors.map((color) => ({ ...color }));
  }

  toHex() {
    return this.colors.map(colorToHex);
  }
}

/**
 * Find the nearest RGB color in a palette.
 *
 * Uses squared Euclidean distance in RGB space.
 */
export function findNearestColor(color, palette) {
  const source = validateColor(color);
  if (!(palette instanceof Palette)) {
    throw new TypeError("Expected a Palette instance.");
  }

  let nearest = palette.get(0);

  let nearestDistance = colorDistanceSquared(source, nearest);

  for (let index = 1; index < palette.size; index += 1) {
    const candidate = palette.get(index);
    const distance = colorDistanceSquared(source, candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Calculate squared Euclidean RGB distance.
 *
 * Alpha is intentionally ignored because palettes contain RGB colors
 * and the processing pipeline preserves the source alpha separately.
 */
export function colorDistanceSquared(a, b) {
  const colorA = validateColor(a);
  const colorB = validateColor(b);
  const red = colorA.r - colorB.r;
  const green = colorA.g - colorB.g;
  const blue = colorA.b - colorB.b;
  return red * red + green * green + blue * blue;
}

/**
 * Convert a #RRGGBB string to an RGB object.
 */
export function hexToColor(hex) {
  if (typeof hex !== "string") {
    throw new TypeError("Hex color must be a string.");
  }

  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new TypeError(`Invalid hex color: "${hex}".`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

/**
 * Convert an RGB object to #RRGGBB.
 */
export function colorToHex(color) {
  const validated = validateColor(color);
  return `#${toHexComponent(validated.r)}${toHexComponent(validated.g)}${toHexComponent(validated.b)}`;
}

/**
 * Create a Palette from hexadecimal color strings.
 */
export function paletteFromHex(colors, name = "Custom") {
  if (!Array.isArray(colors) || colors.length === 0) {
    throw new TypeError("Palette colors must be a non-empty array.");
  }
  return new Palette(colors.map(hexToColor), name);
}

/**
 * Create a grayscale palette with evenly distributed values.
 */
export function createGrayscalePalette(size, name = "Grayscale") {
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError("Grayscale palette size must be an integer >= 2.");
  }
  const colors = [];
  for (let index = 0; index < size; index += 1) {
    const value = Math.round((index / (size - 1)) * 255);
    colors.push({ r: value, g: value, b: value });
  }
  return new Palette(colors, name);
}

/**
 * Return all available palette IDs.
 *
 * This is useful for programmatic access and tests.
 */
export function getPaletteIds() {
  return Object.keys(paletteDefinitions);
}

/**
 * Return lightweight palette metadata for the UI.
 *
 * This function deliberately does not create Palette instances.
 */
export function getPaletteDefinitions() {
  return getPaletteIds().map((id) => {
    const definition = paletteDefinitions[id];
    validatePaletteDefinition(id, definition);
    return {
      id,
      name: definition.name ?? id,
      system: definition.system ?? null,
      manufacturer: definition.manufacturer ?? null,
      year: definition.year ?? null,
      category: definition.category ?? "other",
      type: definition.type ?? "custom",
      colorCount: definition.colorCount ?? definition.colors.length,
      simultaneousColors: definition.simultaneousColors ?? null,
      description: definition.description ?? null,
    };
  });
}

/**
 * Resolve a palette ID to a Palette instance.
 *
 * This is the main bridge between the data layer and processing layer.
 */
export function getPalette(id) {
  validatePaletteId(id);
  const definition = paletteDefinitions[id];
  validatePaletteDefinition(id, definition);
  return paletteFromHex(definition.colors, definition.name);
}

/**Check whether a palette ID exists.
 */
export function hasPalette(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    Object.hasOwn(paletteDefinitions, id)
  );
}

/**
 * Validate a palette ID.
 */
function validatePaletteId(id) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("Palette ID must be a non-empty string.");
  }
  if (!hasPalette(id)) {
    throw new RangeError(`Unknown palette: "${id}".`);
  }
}

/**
 * Validate a raw JSON palette definition.
 * */
function validatePaletteDefinition(id, definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError(`Invalid palette definition: "${id}".`);
  }
  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    throw new TypeError(`Palette "${id}" must have a valid name.`);
  }
  if (!Array.isArray(definition.colors) || definition.colors.length === 0) {
    throw new TypeError(
      `Palette "${id}" must contain a non-empty colors array.`,
    );
  }
  for (let index = 0; index < definition.colors.length; index += 1) {
    const color = definition.colors[index];
    try {
      hexToColor(color);
    } catch (error) {
      throw new TypeError(
        `Palette "${id}" contains an invalid color at index ${index}: ${error.message}`,
      );
    }
  }
}

/**
 * Validate an RGB color.
 */
function validateColor(color) {
  if (!color || typeof color !== "object") {
    throw new TypeError("Color must be an object.");
  }
  const { r, g, b } = color;
  if (!isValidChannel(r) || !isValidChannel(g) || !isValidChannel(b)) {
    throw new TypeError("Color channels must be integers between 0 and 255.");
  }
  return { r, g, b };
}

/**Validate one RGB channel.
 */
function isValidChannel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

/**Convert a channel to two hexadecimal characters.
 */
function toHexComponent(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}
