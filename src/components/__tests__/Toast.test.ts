import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useToast, ToastContainer, type ToastMessage } from "../Toast";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/**
 * Minimal render harness: mounts a probe component that calls useToast and
 * exposes the hook's public API. Tests assert only what a caller sees — the
 * `toasts` array and what the container renders.
 */
function renderHarness(render?: (api: ReturnType<typeof useToast>) => ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  let api: ReturnType<typeof useToast> | null = null;
  function Probe() {
    api = useToast();
    return render ? render(api) : null;
  }

  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });

  return {
    get toasts(): ToastMessage[] { return api!.toasts; },
    show: (...args: Parameters<ReturnType<typeof useToast>["showToast"]>) => {
      act(() => { api!.showToast(...args); });
    },
    dismiss: (id: number) => { act(() => { api!.dismissToast(id); }); },
    container,
    unmount() {
      act(() => { root!.unmount(); });
      container.remove();
    },
  };
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { document.body.innerHTML = ""; });

describe("useToast keying", () => {
  it("stacks toasts that have no key (existing behavior)", () => {
    const h = renderHarness();
    h.show("first", "info");
    h.show("second", "info");
    expect(h.toasts.map((t) => t.text)).toEqual(["first", "second"]);
    h.unmount();
  });

  it("replaces the live toast when the key repeats", () => {
    const h = renderHarness();
    h.show("reloaded 1×", "info", undefined, "reload:c:/a.md");
    const firstId = h.toasts[0].id;
    h.show("reloaded 2×", "info", undefined, "reload:c:/a.md");
    h.show("reloaded 3×", "info", undefined, "reload:c:/a.md");

    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0].text).toBe("reloaded 3×");
    // A new id means the container remounts the item, restarting its timer.
    expect(h.toasts[0].id).not.toBe(firstId);
    h.unmount();
  });

  it("keeps toasts with different keys side by side", () => {
    const h = renderHarness();
    h.show("a changed", "info", undefined, "reload:c:/a.md");
    h.show("b changed", "info", undefined, "reload:c:/b.md");
    expect(h.toasts.map((t) => t.text)).toEqual(["a changed", "b changed"]);
    h.unmount();
  });

  it("does not disturb unkeyed toasts when a keyed one replaces itself", () => {
    const h = renderHarness();
    h.show("save failed", "error");
    h.show("reloaded", "info", undefined, "reload:c:/a.md");
    h.show("reloaded again", "info", undefined, "reload:c:/a.md");
    expect(h.toasts.map((t) => t.text)).toEqual(["save failed", "reloaded again"]);
    h.unmount();
  });

  it("dismisses a keyed toast by id like any other", () => {
    const h = renderHarness();
    h.show("reloaded", "info", undefined, "reload:c:/a.md");
    h.dismiss(h.toasts[0].id);
    expect(h.toasts).toHaveLength(0);
    h.unmount();
  });
});

describe("keyed toast auto-dismiss", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("restarts the 5s timer when a replacement arrives", () => {
    const h = renderHarness((api) =>
      createElement(ToastContainer, { toasts: api.toasts, onDismiss: api.dismissToast }),
    );

    h.show("reloaded", "info", undefined, "reload:c:/a.md");
    act(() => { vi.advanceTimersByTime(4000); });
    expect(h.container.textContent).toContain("reloaded");

    h.show("reloaded again", "info", undefined, "reload:c:/a.md");
    // 4s past the first toast's start — it would be gone if the timer had not reset.
    act(() => { vi.advanceTimersByTime(4000); });
    expect(h.container.textContent).toContain("reloaded again");

    act(() => { vi.advanceTimersByTime(1500); });
    expect(h.toasts).toHaveLength(0);
    h.unmount();
  });
});
