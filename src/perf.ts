/**
 * Tiny perf instrumentation behind a localStorage debug flag.
 *
 * Enable in the devtools console:  localStorage.setItem('mde-perf', '1')  then reload.
 * Disable:                         localStorage.removeItem('mde-perf')
 *
 * When the flag is off every export is a single boolean check that returns
 * immediately, so it is safe to leave the calls in production code.
 */

const ENABLED = (() => {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("mde-perf") !== null;
  } catch {
    return false;
  }
})();

// Cold-start origin: the moment this (deliberately first-imported) module evaluates.
const ORIGIN = ENABLED ? performance.now() : 0;
let firstPaintLogged = false;
let editorReadyLogged = false;

function log(label: string, ms: number): void {
  // eslint-disable-next-line no-console
  console.log(`[mde-perf] ${label}: ${ms.toFixed(1)}ms`);
}

export const perf = {
  enabled: ENABLED,

  /** Log module-eval → first animation frame after the initial React render. */
  firstPaint(): void {
    if (!ENABLED || firstPaintLogged) return;
    firstPaintLogged = true;
    requestAnimationFrame(() => log("cold start → first paint", performance.now() - ORIGIN));
  },

  /** Log module-eval → first editor becoming ready (fires once). */
  editorReady(): void {
    if (!ENABLED || editorReadyLogged) return;
    editorReadyLogged = true;
    log("cold start → editor ready", performance.now() - ORIGIN);
  },

  /**
   * Time a tab/mode switch. Returns a done() to call once the switch has
   * visually settled (e.g. inside the post-activate requestAnimationFrame).
   */
  tabSwitch(label: string): () => void {
    if (!ENABLED) return () => {};
    const t0 = performance.now();
    return () => log(`tab switch (${label})`, performance.now() - t0);
  },
};
