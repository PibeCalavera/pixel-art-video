/**
 * Creates and manages the image-processing controls.
 *
 * @param {HTMLElement} root - Container holding the control elements.
 * @param {Object} [options]
 * @param {Array<Object>} [options.palettes=[]] - Available color palettes.
 * @returns {{
 *   getOptions: Function,
 *   setOptions: Function,
 *   getRealtimePreview: Function,
 *   setRealtimePreview: Function,
 *   setEditorMode: Function,
 *   onChange: Function
 * }}
 */
export function createControls(root, { palettes = [] } = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("Controls require an HTMLElement root.");
  }

  const elements = {
    resizeAlgorithm: root.querySelector('[data-control="resize-algorithm"]'),
    resizeMode: root.querySelector('[data-control="resize-mode"]'),
    resizeScale: root.querySelector('[data-control="resize-scale"]'),
    resizeScaleGroup: root.querySelector("[data-resize-scale-group]"),
    resizeExactGroup: root.querySelector("[data-resize-exact-group]"),
    targetWidth: root.querySelector('[data-control="target-width"]'),
    targetHeight: root.querySelector('[data-control="target-height"]'),

    quantizationAlgorithm: root.querySelector(
      '[data-control="quantization-algorithm"]',
    ),

    palette: root.querySelector('[data-control="palette"]'),
    paletteGroup: root.querySelector("[data-palette-group]"),

    ditherAlgorithm: root.querySelector('[data-control="dither-algorithm"]'),
    ditherStrength: root.querySelector('[data-control="dither-strength"]'),
    strengthGroup: root.querySelector("[data-strength-group]"),

    bayerMatrixSize: root.querySelector('[data-control="bayer-matrix-size"]'),
    matrixGroup: root.querySelector("[data-matrix-group]"),

    rgbStripeGroup: root.querySelector("[data-rgb-stripe-group]"),
    rgbStripeLayout: root.querySelector('[data-control="rgb-stripe-layout"]'),
    rgbStripeChannelOrder: root.querySelector(
      '[data-control="rgb-stripe-channel-order"]',
    ),

    realtimePreview: root.querySelector('[data-control="realtime-preview"]'),
  };

  const imageOnlyGroups = [...root.querySelectorAll("[data-image-only]")];

  const videoOnlyGroups = [...root.querySelectorAll("[data-video-only]")];

  let editorMode = "image";

  populatePaletteSelect(elements.palette, palettes);

  updateResizeMode();
  updateDitherControls();
  updateEditorMode();

  elements.resizeMode?.addEventListener("change", updateResizeMode);
  elements.ditherAlgorithm?.addEventListener("change", updateDitherControls);

  return {
    getOptions,
    setOptions,
    getRealtimePreview,
    setRealtimePreview,
    setEditorMode,
    onChange,
  };

  /**
   * Reads the current control values.
   *
   * @returns {Object} Processing options.
   */
  function getOptions() {
    const paletteId = getValue(elements.palette, null);
    const resizeMode = getValue(elements.resizeMode, "scale");
    const ditherAlgorithm = getValue(elements.ditherAlgorithm, "none");

    const ditherOptions = {
      algorithm: ditherAlgorithm,
      strength: getNumber(elements.ditherStrength, 1),
      matrixSize: getPositiveInteger(elements.bayerMatrixSize, 4),
      palette: paletteId,
    };

    if (ditherAlgorithm === "rgb-stripe") {
      ditherOptions.layout = getValue(elements.rgbStripeLayout, "horizontal");

      ditherOptions.channelOrder = getChannelOrder(
        elements.rgbStripeChannelOrder,
      );
    }

    return {
      resize: {
        algorithm: getValue(elements.resizeAlgorithm, "nearest"),
        mode: resizeMode,
        scale: resizeMode === "scale" ? getNumber(elements.resizeScale, 1) : 1,
        width:
          resizeMode === "exact"
            ? getPositiveInteger(elements.targetWidth, null)
            : null,
        height:
          resizeMode === "exact"
            ? getPositiveInteger(elements.targetHeight, null)
            : null,
      },

      quantize: {
        algorithm: getValue(elements.quantizationAlgorithm, "nearest"),
        palette: paletteId,
      },

      dither: ditherOptions,
    };
  }

  /**
   * Restores processing options in the UI.
   *
   * Supports older configurations without an explicit resize mode.
   *
   * @param {Object} [options={}] - Processing options to restore.
   * @throws {TypeError} If options is not an object.
   */
  function setOptions(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Options must be an object.");
    }

    if (options.resize) {
      const resize = options.resize;

      setValue(elements.resizeAlgorithm, resize.algorithm);

      const mode =
        resize.mode === "exact" || resize.mode === "scale"
          ? resize.mode
          : resize.width != null || resize.height != null
            ? "exact"
            : "scale";

      setValue(elements.resizeMode, mode);
      setValue(elements.resizeScale, resize.scale);
      setValue(elements.targetWidth, resize.width);
      setValue(elements.targetHeight, resize.height);

      updateResizeMode();
    }

    if (options.quantize) {
      setValue(elements.quantizationAlgorithm, options.quantize.algorithm);
    }

    if (options.dither) {
      const dither = options.dither;

      setValue(elements.ditherAlgorithm, dither.algorithm);
      setValue(elements.ditherStrength, dither.strength);
      setValue(elements.bayerMatrixSize, dither.matrixSize);
      setValue(elements.rgbStripeLayout, dither.layout);

      if (dither.channelOrder != null) {
        setValue(
          elements.rgbStripeChannelOrder,
          normalizeChannelOrder(dither.channelOrder).join(","),
        );
      }
    }

    const paletteId = options.quantize?.palette ?? options.dither?.palette;

    if (paletteId != null) {
      setValue(elements.palette, paletteId);
    }

    if (options.realtimePreview !== undefined) {
      setRealtimePreview(options.realtimePreview);
    }

    updateDitherControls();
    updateEditorMode();
  }

  /**
   * Updates visibility and enabled state of resize controls.
   */
  function updateResizeMode() {
    const exact = elements.resizeMode?.value === "exact";

    if (elements.resizeScaleGroup) {
      elements.resizeScaleGroup.hidden = exact;
    }

    if (elements.resizeExactGroup) {
      elements.resizeExactGroup.hidden = !exact;
    }

    if (elements.targetWidth) {
      elements.targetWidth.disabled = !exact;
    }

    if (elements.targetHeight) {
      elements.targetHeight.disabled = !exact;
    }

    if (elements.resizeScale) {
      elements.resizeScale.disabled = exact;
    }
  }

  /**
   * Updates controls that depend on the selected dithering algorithm.
   *
   * RGBK and RGB Stripe do not require an external palette.
   * Matrix size is only used by Bayer and Pair Dither.
   * Strength is disabled for algorithms that do not consume it.
   */
  function updateDitherControls() {
    const algorithm = getValue(elements.ditherAlgorithm, "none");

    const isRGBStripe = algorithm === "rgb-stripe";
    const isPaletteFree = algorithm === "rgbk" || isRGBStripe;

    const usesMatrix = ["bayer", "pair-dither"].includes(algorithm);

    const usesStrength = [
      "bayer",
      "floyd-steinberg",
      "atkinson",
      "pair-dither",
    ].includes(algorithm);

    setGroupVisibility(elements.rgbStripeGroup, isRGBStripe);
    setGroupVisibility(elements.paletteGroup, !isPaletteFree);
    setGroupVisibility(elements.matrixGroup, usesMatrix);
    setGroupVisibility(elements.strengthGroup, usesStrength);

    if (elements.rgbStripeLayout) {
      elements.rgbStripeLayout.disabled = !isRGBStripe;
    }

    if (elements.rgbStripeChannelOrder) {
      elements.rgbStripeChannelOrder.disabled = !isRGBStripe;
    }

    if (elements.bayerMatrixSize) {
      elements.bayerMatrixSize.disabled = !usesMatrix;
    }

    if (elements.ditherStrength) {
      elements.ditherStrength.disabled = !usesStrength;
    }
  }

  /**
   * Updates visibility and enabled state of a control group.
   *
   * @param {HTMLElement|null} group
   * @param {boolean} visible
   */
  function setGroupVisibility(group, visible) {
    if (!group) {
      return;
    }

    group.hidden = !visible;

    for (const control of group.querySelectorAll(
      "input, select, button, textarea",
    )) {
      control.disabled = !visible;
    }
  }

  /**
   * Changes between image and video editor modes.
   *
   * Image-only controls are hidden in video mode.
   * Video-only controls are hidden in image mode.
   *
   * @param {"image"|"video"} mode
   * @throws {TypeError} If mode is invalid.
   */
  function setEditorMode(mode) {
    if (mode !== "image" && mode !== "video") {
      throw new TypeError('Editor mode must be "image" or "video".');
    }

    editorMode = mode;
    updateEditorMode();
  }

  /**
   * Updates visibility of controls according to the current editor mode.
   */
  function updateEditorMode() {
    const isImageMode = editorMode === "image";

    for (const group of imageOnlyGroups) {
      setGroupVisibility(group, isImageMode);
    }

    for (const group of videoOnlyGroups) {
      setGroupVisibility(group, !isImageMode);
    }
  }

  /**
   * Returns the selected RGB Stripe channel order.
   *
   * @param {HTMLSelectElement|null} element
   * @returns {string[]}
   */
  function getChannelOrder(element) {
    const value = getValue(element, "R,G,B");

    return normalizeChannelOrder(value);
  }

  /**
   * Normalizes a channel order represented as a string or array.
   *
   * @param {string|string[]} value
   * @returns {string[]}
   */
  function normalizeChannelOrder(value) {
    if (Array.isArray(value)) {
      return value.map((channel) => String(channel).trim());
    }

    if (typeof value === "string") {
      return value.split(",").map((channel) => channel.trim());
    }

    return ["R", "G", "B"];
  }

  /**
   * Returns whether real-time preview is enabled.
   *
   * @returns {boolean}
   */
  function getRealtimePreview() {
    return editorMode === "image" && elements.realtimePreview
      ? elements.realtimePreview.checked
      : false;
  }

  /**
   * Enables or disables real-time preview.
   *
   * @param {boolean} enabled
   */
  function setRealtimePreview(enabled) {
    if (!elements.realtimePreview) {
      return;
    }

    elements.realtimePreview.checked = Boolean(enabled);
  }

  /**
   * Registers a listener for changes to available controls.
   *
   * @param {Function} listener
   * @returns {Function} Cleanup function.
   * @throws {TypeError} If listener is not a function.
   */
  function onChange(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Listener must be a function.");
    }

    const cleanups = [];

    for (const element of Object.values(elements)) {
      if (!element || typeof element.addEventListener !== "function") {
        continue;
      }

      element.addEventListener("change", listener);

      cleanups.push(() => {
        element.removeEventListener("change", listener);
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }
}

/**
 * Populates a palette selector and groups palettes by category.
 *
 * @param {HTMLSelectElement|null} select
 * @param {Array<Object>} palettes
 */
function populatePaletteSelect(select, palettes) {
  if (!select) {
    return;
  }

  if (!Array.isArray(palettes)) {
    throw new TypeError("Palettes must be an array.");
  }

  select.replaceChildren();

  const grouped = groupPalettesByCategory(palettes);

  for (const [category, definitions] of grouped) {
    const group = document.createElement("optgroup");
    group.label = formatCategoryName(category);

    for (const palette of definitions) {
      const option = document.createElement("option");

      option.value = palette.id;
      option.textContent = createPaletteLabel(palette);

      if (palette.description) {
        option.title = palette.description;
      }

      group.appendChild(option);
    }

    select.appendChild(group);
  }

  if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

/**
 * Groups palette definitions by category.
 *
 * @param {Array<Object>} palettes
 * @returns {Map<string, Array<Object>>}
 */
function groupPalettesByCategory(palettes) {
  const groups = new Map();

  for (const palette of palettes) {
    if (!palette || typeof palette !== "object") {
      continue;
    }

    const category = palette.category ?? "other";

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(palette);
  }

  return groups;
}

/**
 * Creates the visible label for a palette option.
 *
 * @param {Object} palette
 * @returns {string}
 */
function createPaletteLabel(palette) {
  const colorCount =
    Number.isInteger(palette.colorCount) && palette.colorCount > 0
      ? ` · ${palette.colorCount} colors`
      : "";

  return `${palette.name}${colorCount}`;
}

/**
 * Converts a palette category identifier into a display label.
 *
 * @param {string} category
 * @returns {string}
 */
function formatCategoryName(category) {
  const labels = {
    console: "Consoles",
    computer: "Computers",
    "fantasy-console": "Fantasy consoles",
    artist: "Pixel art",
    other: "Other",
  };

  if (labels[category]) {
    return labels[category];
  }

  return String(category)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Returns an element's value or a fallback when missing or empty.
 *
 * @param {HTMLInputElement|HTMLSelectElement|null} element
 * @param {*} fallback
 * @returns {*}
 */
function getValue(element, fallback) {
  if (!element || element.value === "") {
    return fallback;
  }

  return element.value;
}

/**
 * Reads a positive safe integer from an input.
 *
 * @param {HTMLInputElement|null} element
 * @param {number|null} fallback
 * @returns {number|null}
 */
function getPositiveInteger(element, fallback) {
  if (!element || element.value === "") {
    return fallback;
  }

  const value = Number(element.value);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

/**
 * Reads a finite number from an input.
 *
 * @param {HTMLInputElement|null} element
 * @param {number} fallback
 * @returns {number}
 */
function getNumber(element, fallback) {
  if (!element || element.value.trim() === "") {
    return fallback;
  }

  const value = Number(element.value);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

/**
 * Updates a form control when both element and value are available.
 *
 * @param {HTMLInputElement|HTMLSelectElement|null} element
 * @param {*} value
 */
function setValue(element, value) {
  if (!element || value === undefined || value === null) {
    return;
  }

  element.value = String(value);
}
