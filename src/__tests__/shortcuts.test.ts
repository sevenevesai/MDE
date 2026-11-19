import { describe, it, expect, vi } from "vitest";
import { handleShortcuts, type Shortcut } from "../shortcuts";

const press = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent("keydown", { cancelable: true, ...init });

describe("handleShortcuts", () => {
  it("runs the first shortcut whose key and modifiers match exactly", () => {
    const save = vi.fn();
    const saveAs = vi.fn();
    const shortcuts: Shortcut[] = [
      { key: "S", ctrl: true, shift: true, action: saveAs },
      { key: "s", ctrl: true, action: save },
    ];
    const e = press({ key: "s", ctrlKey: true });
    handleShortcuts(shortcuts, e);
    expect(save).toHaveBeenCalledOnce();
    expect(saveAs).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores a chord with extra modifiers", () => {
    const action = vi.fn();
    const e = press({ key: "n", ctrlKey: true, altKey: true });
    handleShortcuts([{ key: "n", ctrl: true, action }], e);
    expect(action).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("matches physical keys by code, whatever character Alt produced", () => {
    const action = vi.fn();
    handleShortcuts([{ key: "KeyN", physical: true, alt: true, action }], press({ key: "Dead", code: "KeyN", altKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });
});
