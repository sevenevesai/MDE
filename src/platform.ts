/** Runtime platform detection. */

export const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
export const isBrowser = !isTauri;
