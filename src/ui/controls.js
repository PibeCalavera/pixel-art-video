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
 *   onChange: Function
 * }}
 */
export function createControls(root, { palettes = [] } = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("Controls require an HTMLElement root.");
  }

  // Cache references to the controls used by the application.
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
    ditherAlgorithm: root.querySelector('[data-control="dither-algorithm"]'),
    ditherStrength: root.querySelector('[data-control="dither-strength"]'),
    bayerMatrixSize: root.querySelector('[data-control="bayer-matrix-size"]'),
    realtimePreview: root.querySelector('[data-control="realtime-preview"]'),
  };

  populatePaletteSelect(elements.palette, palettes);

  // Ensure the resize controls match the initially selected mode.
  updateResizeMode();
  elements.resizeMode?.addEventListener("change", updateResizeMode);

  return {
    getOptions,
    setOptions,
    getRealtimePreview,
    setRealtimePreview,
    onChange,
  };

  /**
   * Reads and validates the current control values.
   *
   * Resize dimensions are returned according to the selected mode:
   * - "scale": use the original dimensions multiplied by a scale factor.
   * - "exact": use the explicitly requested width and height.
   *
   * @returns {Object} Processing options.
   */
  function getOptions() {
    const paletteId = getValue(elements.palette, null);
    const resizeMode = getValue(elements.resizeMode, "scale");

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

      dither: {
        algorithm: getValue(elements.ditherAlgorithm, "none"),
        strength: getNumber(elements.ditherStrength, 1),
        matrixSize: getPositiveInteger(elements.bayerMatrixSize, 4),
        palette: paletteId,
      },
    };
  }

  /**
   * Restores processing options in the UI.
   *
   * Supports older configurations that do not include an explicit
   * resize mode, inferring the mode from the available dimensions.
   *
   * @param {Object} [options={}] - Processing options to restore.
   * @throws {TypeError} If options is not an object.
   */
  function setOptions(options = {}) {
    if (!options || typeof options !== "object") {
      throw new TypeError("Options must be an object.");
    }

    if (options.resize) {
      const resize = options.resize;

      setValue(elements.resizeAlgorithm, resize.algorithm);

      // Infer a mode when restoring a configuration created by an older version.
      const mode =
        resize.mode === "exact" || resize.mode === "scale"
          ? resize.mode
          : resize.width != null || resize.height != null
            ? "exact"
            : "scale";

      setValue(elements.resizeMode, mode);

      if (resize.scale != null) {
        setValue(elements.resizeScale, resize.scale);
      }

      setValue(elements.targetWidth, resize.width);
      setValue(elements.targetHeight, resize.height);

      updateResizeMode();
    }

    if (options.quantize) {
      setValue(elements.quantizationAlgorithm, options.quantize.algorithm);
    }

    if (options.dither) {
      setValue(elements.ditherAlgorithm, options.dither.algorithm);
      setValue(elements.ditherStrength, options.dither.strength);
      setValue(elements.bayerMatrixSize, options.dither.matrixSize);
    }

    // Both quantization and dithering use the selected palette.
    const paletteId = options.quantize?.palette ?? options.dither?.palette;

    if (paletteId != null) {
      setValue(elements.palette, paletteId);
    }

    if (options.realtimePreview !== undefined) {
      setRealtimePreview(options.realtimePreview);
    }
  }

  /**
   * Shows the controls relevant to the selected resize mode.
   *
   * Disabling inactive inputs prevents users from editing values
   * that are not used by the current configuration.
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
   * Returns whether real-time preview is enabled.
   *
   * @returns {boolean}
   */
  function getRealtimePreview() {
    return elements.realtimePreview ? elements.realtimePreview.checked : false;
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
   * Registers a listener for changes to any available control.
   *
   * @param {Function} listener - Callback invoked when a control changes.
   * @returns {Function} Cleanup function that removes the listeners.
   * @throws {TypeError} If listener is not a function.
   */
  function onChange(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Listener must be a function.");
    }

    const cleanups = [];

    for (const element of Object.values(elements)) {
      if (!element) {
        continue;
      }

      element.addEventListener("change", listener);

      cleanups.push(() => element.removeEventListener("change", listener));
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

  // Select the first available palette by default.
  if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

/**
 * Groups palette definitions by their category.
 *
 * Palettes without an explicit category are assigned to "other".
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
 * Returns an element's value or a fallback when it is missing or empty.
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
 * Updates a form control when both the element and value are available.
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
