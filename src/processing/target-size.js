/**
 * Calculates output dimensions for image and video processing.
 *
 * mode: "exact"  -> use the requested width and height.
 * mode: "scale"  -> multiply both original dimensions.
 */
export function resolveTargetSize(
  sourceWidth,
  sourceHeight,
  { mode = "scale", width = null, height = null, scale = 1 } = {},
) {
  assertDimension(sourceWidth, "Source width");
  assertDimension(sourceHeight, "Source height");

  let targetWidth;
  let targetHeight;

  if (mode === "scale") {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new RangeError("Scale must be greater than zero.");
    }

    targetWidth = Math.round(sourceWidth * scale);
    targetHeight = Math.round(sourceHeight * scale);
  } else if (mode === "exact") {
    targetWidth = width ?? sourceWidth;
    targetHeight = height ?? sourceHeight;

    assertDimension(targetWidth, "Target width");
    assertDimension(targetHeight, "Target height");
  } else {
    throw new TypeError(`Unknown resize mode: ${mode}`);
  }

  return { width: Math.max(1, targetWidth), height: Math.max(1, targetHeight) };
}

function assertDimension(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}
