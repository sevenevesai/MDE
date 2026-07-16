/**
 * Auto-update pipeline (desktop only).
 *
 * All Tauri plugin imports are dynamic so the web build never pulls them in and
 * `isTauri` short-circuits every path in the browser. The startup check runs
 * silently — it must never block launch nor surface errors when offline.
 */

import { isTauri } from "./platform";

type ToastKind = "error" | "info";
type ToastAction = { label: string; onClick: () => void };
type ShowToast = (text: string, kind?: ToastKind, action?: ToastAction) => void;

interface CheckOptions {
  /** Silent checks swallow "up to date" and all failures (startup/offline). */
  silent: boolean;
}

/**
 * Check for an update and, if one is available, surface a persistent toast whose
 * action downloads, installs, and relaunches the app.
 *
 * On a manual check (`silent: false`) the user also gets "up to date" and error
 * feedback. Never throws — every failure is either toasted or swallowed.
 */
export async function checkForUpdates(showToast: ShowToast, { silent }: CheckOptions): Promise<void> {
  if (!isTauri) {
    if (!silent) showToast("Updates are only available in the desktop app.", "info");
    return;
  }

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();

    if (!update) {
      if (!silent) showToast("MDE is up to date.", "info");
      return;
    }

    showToast(`Update available: v${update.version}`, "info", {
      label: "Restart to update",
      onClick: () => {
        void installAndRelaunch(update, showToast);
      },
    });
  } catch (err) {
    // Silent checks stay silent (offline, no release yet, etc.); manual checks report.
    if (!silent) showToast(`Update check failed: ${errText(err)}`, "error");
  }
}

async function installAndRelaunch(
  update: { downloadAndInstall: () => Promise<void> },
  showToast: ShowToast
): Promise<void> {
  try {
    showToast("Downloading update…", "info");
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    showToast(`Update failed: ${errText(err)}`, "error");
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
