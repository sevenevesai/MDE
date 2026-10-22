import { describe, it, expect } from "vitest";
import { clampToViewport } from "../menuPosition";

describe("clampToViewport", () => {
  it("leaves a menu that already fits untouched", () => {
    expect(clampToViewport(100, 50, 160, 80, 800, 600)).toEqual({ left: 100, top: 50 });
  });
  it("shifts a menu left/up when it would overflow the right/bottom edge", () => {
    expect(clampToViewport(790, 590, 160, 80, 800, 600)).toEqual({ left: 640, top: 520 });
  });
  it("never goes negative when the viewport is smaller than the menu", () => {
    expect(clampToViewport(10, 10, 160, 80, 100, 50)).toEqual({ left: 0, top: 0 });
  });
});
