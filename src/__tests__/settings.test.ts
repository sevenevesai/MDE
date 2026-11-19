import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings, DEFAULTS } from "../settings";

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
    saveSettings({ ...DEFAULTS, autoSave: true });
    expect(loadSettings().autoSave).toBe(true);
  });
});

describe("indent and whitespace settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 2-space indentation without whitespace markers", () => {
    const settings = loadSettings();
    expect(settings.indentSize).toBe(2);
    expect(settings.indentWithTabs).toBe(false);
    expect(settings.showWhitespace).toBe(false);
  });

  it("fills the new fields with defaults for settings that predate them", () => {
    localStorage.setItem("mde-settings", JSON.stringify({ wordWrap: false, fontSize: 18, showOutline: false, autoSave: true }));
    expect(loadSettings()).toEqual({ ...DEFAULTS, wordWrap: false, fontSize: 18, autoSave: true });
  });

  it("round-trips valid values", () => {
    saveSettings({ ...DEFAULTS, indentSize: 8, indentWithTabs: true, showWhitespace: true });
    const settings = loadSettings();
    expect(settings.indentSize).toBe(8);
    expect(settings.indentWithTabs).toBe(true);
    expect(settings.showWhitespace).toBe(true);
  });
});

describe("loadSettings sanitising", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function loadStored(value: unknown) {
    localStorage.setItem("mde-settings", JSON.stringify(value));
    return loadSettings();
  }

  it("rejects an indent size outside 2/4/8", () => {
    expect(loadStored({ indentSize: 3 }).indentSize).toBe(2);
    expect(loadStored({ indentSize: 0 }).indentSize).toBe(2);
    expect(loadStored({ indentSize: "4" }).indentSize).toBe(2);
    expect(loadStored({ indentSize: 4 }).indentSize).toBe(4);
  });

  it("rejects wrongly typed booleans", () => {
    const settings = loadStored({ wordWrap: "no", showOutline: 1, autoSave: null, indentWithTabs: "true", showWhitespace: {} });
    expect(settings.wordWrap).toBe(DEFAULTS.wordWrap);
    expect(settings.showOutline).toBe(DEFAULTS.showOutline);
    expect(settings.autoSave).toBe(DEFAULTS.autoSave);
    expect(settings.indentWithTabs).toBe(DEFAULTS.indentWithTabs);
    expect(settings.showWhitespace).toBe(DEFAULTS.showWhitespace);
  });

  it("rejects a font size that is out of range or not a number", () => {
    expect(loadStored({ fontSize: 400 }).fontSize).toBe(DEFAULTS.fontSize);
    expect(loadStored({ fontSize: 2 }).fontSize).toBe(DEFAULTS.fontSize);
    expect(loadStored({ fontSize: "16" }).fontSize).toBe(DEFAULTS.fontSize);
    expect(loadStored({ fontSize: 20 }).fontSize).toBe(20);
  });

  it("falls back to defaults for non-object JSON", () => {
    expect(loadStored(null)).toEqual(DEFAULTS);
    expect(loadStored([1, 2])).toEqual(DEFAULTS);
    expect(loadStored("settings")).toEqual(DEFAULTS);
  });

  it("falls back to defaults for corrupt JSON", () => {
    localStorage.setItem("mde-settings", "{not json");
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it("drops unknown stored keys", () => {
    expect(loadStored({ ...DEFAULTS, legacy: true })).toEqual(DEFAULTS);
  });

  it("returns a copy, never the shared defaults object", () => {
    expect(loadSettings()).not.toBe(DEFAULTS);
  });
});
