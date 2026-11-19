/** Entries of the language picker (status bar language label, View → Change Language…). */
import { detectLanguage, languageLabel, listLanguages } from "./editor/language";
import type { DocTab } from "./store/documentStore";

export interface LanguageChoice {
  readonly key: string;
  readonly title: string;
  readonly current: boolean;
  /** The override to set; null follows the file name again. */
  readonly override: string | null;
}

/** "Auto-detect (<detected>)" first, then every language; `current` marks the tab's override, or Auto-detect without one. */
export function languageChoices(tab: Pick<DocTab, "languageOverride" | "filePath" | "title">): LanguageChoice[] {
  const detected = detectLanguage(tab.filePath ?? tab.title);
  return [
    { key: "auto", title: `Auto-detect (${languageLabel(detected)})`, current: tab.languageOverride === null, override: null },
    ...listLanguages().map((lang) => ({
      key: lang.id,
      title: lang.label,
      current: tab.languageOverride === lang.id,
      override: lang.id,
    })),
  ];
}
