/** Clamp a menu's top-left so a menu of the given size stays fully inside the viewport. */
export function clampToViewport(
  x: number, y: number, width: number, height: number, viewW: number, viewH: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(x, viewW - width)),
    top: Math.max(0, Math.min(y, viewH - height)),
  };
}
