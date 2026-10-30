import { beforeEach, describe, expect, test, vi } from "vitest";

import { createControls } from "../../src/ui/controls.js";

class MockHTMLElement {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.value = "";
    this.checked = false;
    this.type = "";
    this.hidden = false;
    this.disabled = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);

    if (name === "type") this.type = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  append(...elements) {
    this.children.push(...elements);
  }

  querySelector(selector) {
    const controlMatch = selector.match(/^\[data-control="(.+)"\]$/);

    if (controlMatch) {
      return (
        this.children.find(
          (element) => element.getAttribute("data-control") === controlMatch[1],
        ) ?? null
      );
    }

    const groupMatch = selector.match(/^\[data-resize-(scale|exact)-group\]$/);

    if (groupMatch) {
      return (
        this.children.find(
          (element) =>
            element.getAttribute(`data-resize-${groupMatch[1]}-group`) !== null,
        ) ?? null
      );
    }

    return null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
  }
}

class MockControlElement extends MockHTMLElement {}

beforeEach(() => {
  globalThis.HTMLElement = MockHTMLElement;
});

function createElement(attributes = {}) {
  const element = new MockControlElement();

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  return element;
}

function createControlsRoot() {
  const root = new MockHTMLElement();

  const resizeAlgorithm = createElement({ "data-control": "resize-algorithm" });

  const resizeMode = createElement({ "data-control": "resize-mode" });
  resizeMode.value = "scale";

  const resizeScale = createElement({ "data-control": "resize-scale" });
  resizeScale.value = "1";

  const resizeScaleGroup = createElement({ "data-resize-scale-group": "" });

  const resizeExactGroup = createElement({ "data-resize-exact-group": "" });

  const targetWidth = createElement({ "data-control": "target-width" });

  const targetHeight = createElement({ "data-control": "target-height" });

  const quantizationAlgorithm = createElement({
    "data-control": "quantization-algorithm",
  });

  const ditherAlgorithm = createElement({ "data-control": "dither-algorithm" });

  const ditherStrength = createElement({ "data-control": "dither-strength" });

  const realtimePreview = createElement({
    "data-control": "realtime-preview",
    type: "checkbox",
  });

  root.append(
    resizeAlgorithm,
    resizeMode,
    resizeScale,
    resizeScaleGroup,
    resizeExactGroup,
    targetWidth,
    targetHeight,
    quantizationAlgorithm,
    ditherAlgorithm,
    ditherStrength,
    realtimePreview,
  );

  return {
    root,
    resizeAlgorithm,
    resizeMode,
    resizeScale,
    resizeScaleGroup,
    resizeExactGroup,
    targetWidth,
    targetHeight,
    quantizationAlgorithm,
    ditherAlgorithm,
    ditherStrength,
    realtimePreview,
  };
}

describe("controls", () => {
  let elements;
  let controls;

  beforeEach(() => {
    elements = createControlsRoot();
    controls = createControls(elements.root);
  });

  test("creates controls for a valid root element", () => {
    expect(controls).toHaveProperty("getOptions");
    expect(controls).toHaveProperty("setOptions");
    expect(controls).toHaveProperty("setRealtimePreview");
    expect(controls).toHaveProperty("onChange");
  });

  test("reads default options when controls are empty", () => {
    expect(controls.getOptions()).toEqual({
      resize: {
        algorithm: "nearest",
        mode: "scale",
        scale: 1,
        width: null,
        height: null,
      },
      quantize: { algorithm: "nearest", palette: null },
      dither: { algorithm: "none", strength: 1, matrixSize: 4, palette: null },
    });
  });

  test("reads values from scale controls", () => {
    elements.resizeAlgorithm.value = "nearest";
    elements.resizeMode.value = "scale";
    elements.resizeScale.value = "2";
    elements.quantizationAlgorithm.value = "nearest";
    elements.ditherAlgorithm.value = "bayer";
    elements.ditherStrength.value = "0.5";

    expect(controls.getOptions()).toEqual({
      resize: {
        algorithm: "nearest",
        mode: "scale",
        scale: 2,
        width: null,
        height: null,
      },
      quantize: { algorithm: "nearest", palette: null },
      dither: {
        algorithm: "bayer",
        strength: 0.5,
        matrixSize: 4,
        palette: null,
      },
    });
  });

  test("reads values from exact dimensions controls", () => {
    elements.resizeMode.value = "exact";
    elements.targetWidth.value = "64";
    elements.targetHeight.value = "32";

    expect(controls.getOptions().resize).toEqual({
      algorithm: "nearest",
      mode: "exact",
      scale: 1,
      width: 64,
      height: 32,
    });
  });

  test("sets processing options on the controls", () => {
    controls.setOptions({
      resize: { algorithm: "nearest", mode: "exact", width: 128, height: 96 },
      quantize: { algorithm: "nearest" },
      dither: { algorithm: "floyd-steinberg", strength: 0.75 },
    });

    expect(elements.resizeAlgorithm.value).toBe("nearest");
    expect(elements.resizeMode.value).toBe("exact");
    expect(elements.targetWidth.value).toBe("128");
    expect(elements.targetHeight.value).toBe("96");
    expect(elements.quantizationAlgorithm.value).toBe("nearest");
    expect(elements.ditherAlgorithm.value).toBe("floyd-steinberg");
    expect(elements.ditherStrength.value).toBe("0.75");
  });

  test("restores scale mode and scale value", () => {
    controls.setOptions({ resize: { mode: "scale", scale: 0.5 } });

    expect(elements.resizeMode.value).toBe("scale");
    expect(elements.resizeScale.value).toBe("0.5");
    expect(elements.resizeScale.disabled).toBe(false);
    expect(elements.targetWidth.disabled).toBe(true);
    expect(elements.targetHeight.disabled).toBe(true);
  });

  test("infers exact mode from legacy dimensions", () => {
    controls.setOptions({ resize: { width: 64, height: 32 } });

    expect(elements.resizeMode.value).toBe("exact");
    expect(elements.targetWidth.value).toBe("64");
    expect(elements.targetHeight.value).toBe("32");
  });

  test("updates visibility and disabled controls when resize mode changes", () => {
    expect(elements.resizeScaleGroup.hidden).toBe(false);
    expect(elements.resizeExactGroup.hidden).toBe(true);

    elements.resizeMode.value = "exact";
    elements.resizeMode.dispatchEvent({ type: "change" });

    expect(elements.resizeScaleGroup.hidden).toBe(true);
    expect(elements.resizeExactGroup.hidden).toBe(false);
    expect(elements.resizeScale.disabled).toBe(true);
    expect(elements.targetWidth.disabled).toBe(false);
    expect(elements.targetHeight.disabled).toBe(false);

    elements.resizeMode.value = "scale";
    elements.resizeMode.dispatchEvent({ type: "change" });

    expect(elements.resizeScaleGroup.hidden).toBe(false);
    expect(elements.resizeExactGroup.hidden).toBe(true);
    expect(elements.resizeScale.disabled).toBe(false);
    expect(elements.targetWidth.disabled).toBe(true);
    expect(elements.targetHeight.disabled).toBe(true);
  });

  test("updates only the options provided", () => {
    elements.targetWidth.value = "32";
    elements.targetHeight.value = "32";
    elements.ditherStrength.value = "0.5";

    controls.setOptions({ dither: { algorithm: "bayer" } });

    expect(elements.targetWidth.value).toBe("32");
    expect(elements.targetHeight.value).toBe("32");
    expect(elements.ditherStrength.value).toBe("0.5");
    expect(elements.ditherAlgorithm.value).toBe("bayer");
  });

  test("sets realtime preview", () => {
    controls.setRealtimePreview(false);
    expect(elements.realtimePreview.checked).toBe(false);

    controls.setRealtimePreview(true);
    expect(elements.realtimePreview.checked).toBe(true);
  });

  test("notifies when a control changes", () => {
    const listener = vi.fn();
    const unsubscribe = controls.onChange(listener);

    elements.targetWidth.dispatchEvent({ type: "change" });

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    elements.targetWidth.dispatchEvent({ type: "change" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("returns null for empty target dimensions in exact mode", () => {
    elements.resizeMode.value = "exact";
    elements.targetWidth.value = "";
    elements.targetHeight.value = "";

    const options = controls.getOptions();

    expect(options.resize.width).toBeNull();
    expect(options.resize.height).toBeNull();
  });

  test("rejects invalid dimensions by using null", () => {
    elements.resizeMode.value = "exact";
    elements.targetWidth.value = "-10";
    elements.targetHeight.value = "abc";

    const options = controls.getOptions();

    expect(options.resize.width).toBeNull();
    expect(options.resize.height).toBeNull();
  });

  test("uses the default strength for an empty value", () => {
    elements.ditherStrength.value = "";

    expect(controls.getOptions().dither.strength).toBe(1);
  });

  test("rejects a non-element root", () => {
    expect(() => createControls({})).toThrow(TypeError);
  });

  test("rejects a non-function change listener", () => {
    expect(() => controls.onChange(null)).toThrow(TypeError);
  });

  test("rejects invalid options", () => {
    expect(() => controls.setOptions(null)).toThrow(TypeError);
  });
});
