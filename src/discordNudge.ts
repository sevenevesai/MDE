/**
 * Discord link + one-time nudge. The nudge is decided once at startup (never in editor paths)
 * and fails closed: any storage problem means it is not shown.
 */

import { isTauri } from "./platform";

const BASE_URL = "https://seveneves.ai/discord/";
export const DISCORD_APP_URL = `${BASE_URL}?from=mde-app`;
export const DISCORD_NUDGE_URL = `${BASE_URL}?from=mde-nudge`;
export const NUDGE_MIN_LAUNCH = 3;
export const NUDGE_TIMEOUT_MS = 12_000;

export const LAUNCH_COUNT_KEY = "mde-launch-count";
export const NUDGE_SEEN_KEY = "mde-discord-nudge-seen";

export interface NudgeInputs {
  launchCount: number;
  seen: boolean;
  storageAvailable: boolean;
}

export function shouldShowNudge({ launchCount, seen, storageAvailable }: NudgeInputs): boolean {
  return storageAvailable && !seen && launchCount >= NUDGE_MIN_LAUNCH;
}

/**
 * Count this launch and decide whether to show the nudge. The seen flag is written before the
 * card is displayed, so quitting while it is visible still means it never returns.
 */
export function claimNudge(storage: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    const previous = Number(storage.getItem(LAUNCH_COUNT_KEY));
    const launchCount = (Number.isFinite(previous) && previous > 0 ? Math.floor(previous) : 0) + 1;
    const seen = storage.getItem(NUDGE_SEEN_KEY) !== null;
    storage.setItem(LAUNCH_COUNT_KEY, String(launchCount));
    if (!shouldShowNudge({ launchCount, seen, storageAvailable: true })) return false;
    storage.setItem(NUDGE_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** System browser on desktop (opener plugin, dynamic so the web build never pulls it in), new tab otherwise. */
export async function openDiscord(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
