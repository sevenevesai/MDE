import { isTauri } from "./platform";

/**
 * Registers public/sw.js (offline cache, installable app) for the production browser build.
 * Never in Tauri, which serves its files itself, and never in dev, where a cache would serve stale modules.
 */
export function registerServiceWorker(): void {
  if (isTauri || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  // After load, so precaching does not compete with the first paint's requests.
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((err: unknown) => {
        console.error("Service worker registration failed; MDE will not work offline:", err);
      });
    },
    { once: true },
  );
}
