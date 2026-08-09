import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings } from "../settings";

describe("settings autoSave default/merge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults autoSave to false when nothing is stored", () => {
    expect(loadSettings().autoSave).toBe(false);
  });

  it("defaults autoSave to false when stored settings predate the field", () => {
    localStorage.setItem("mde-settings", JSON.stringify({ wordWrap: true, fontSize: 16, showOutline: true }));
    const settings = loadSettings();
    expect(settings.autoSave).toBe(false);
    expect(settings.wordWrap).toBe(true);
    expect(settings.showOutline).toBe(true);
  });

  it("round-trips a stored autoSave: true", () => {
    saveSettings({ wordWrap: true, fontSize: 14, showOutline: false, autoSave: true });
    expect(loadSettings().autoSave).toBe(true);
  });
});
