import { describe, expect, it } from "vitest";
import {
  claimNudge, LAUNCH_COUNT_KEY, NUDGE_SEEN_KEY, shouldShowNudge,
  DISCORD_APP_URL, DISCORD_NUDGE_URL,
} from "../discordNudge";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe("shouldShowNudge", () => {
  it("is eligible from the 3rd launch only, once, with working storage", () => {
    const ok = { seen: false, storageAvailable: true };
    expect(shouldShowNudge({ ...ok, launchCount: 2 })).toBe(false);
    expect(shouldShowNudge({ ...ok, launchCount: 3 })).toBe(true);
    expect(shouldShowNudge({ ...ok, launchCount: 3, seen: true })).toBe(false);
    expect(shouldShowNudge({ ...ok, launchCount: 9, storageAvailable: false })).toBe(false);
  });
});

describe("claimNudge", () => {
  it("is hidden on launches 1 and 2 and shown on launch 3", () => {
    const s = memoryStorage();
    expect([claimNudge(s), claimNudge(s), claimNudge(s)]).toEqual([false, false, true]);
  });

  it("never returns after being shown, including from reloaded persisted state", () => {
    const s = memoryStorage();
    for (let i = 0; i < 3; i++) claimNudge(s);
    expect(s.data.has(NUDGE_SEEN_KEY)).toBe(true);
    const reloaded = memoryStorage();
    s.data.forEach((v, k) => reloaded.data.set(k, v));
    for (let i = 0; i < 10; i++) expect(claimNudge(reloaded)).toBe(false);
  });

  it("recovers from a corrupt launch count", () => {
    const s = memoryStorage();
    s.data.set(LAUNCH_COUNT_KEY, "garbage");
    expect(claimNudge(s)).toBe(false);
    expect(s.data.get(LAUNCH_COUNT_KEY)).toBe("1");
  });

  it("fails closed when storage throws on read", () => {
    const s = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
    expect(claimNudge(s)).toBe(false);
  });

  it("fails closed when storage throws on write, even once eligible", () => {
    const s = memoryStorage();
    s.data.set(LAUNCH_COUNT_KEY, "5");
    const failing = { getItem: s.getItem, setItem: () => { throw new Error("quota"); } };
    expect(claimNudge(failing)).toBe(false);
    const flagOnly = {
      getItem: s.getItem,
      setItem: (k: string, v: string) => { if (k === NUDGE_SEEN_KEY) throw new Error("quota"); s.setItem(k, v); },
    };
    expect(claimNudge(flagOnly)).toBe(false);
  });
});

describe("urls", () => {
  it("use the seveneves.ai redirect with a from source", () => {
    expect(DISCORD_APP_URL).toBe("https://seveneves.ai/discord/?from=mde-app");
    expect(DISCORD_NUDGE_URL).toBe("https://seveneves.ai/discord/?from=mde-nudge");
  });
});
