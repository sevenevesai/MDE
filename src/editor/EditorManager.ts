import { EditorState, EditorSelection, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  highlightWhitespace,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches, gotoLine } from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { showMinimap } from "@replit/codemirror-minimap";
import { mdeEditorTheme, mdeHighlightStyle } from "./theme";
import {
  MARKDOWN_LANGUAGE,
  isMarkdownLanguage,
  loadLanguageExtension,
  markdownLanguageExtension,
} from "./language";
import { extractOutline, type OutlineItem } from "../outline";
import { DEFAULTS, type EditorSettings } from "../settings";
import { perf } from "../perf";

export { rawLanguage } from "./language";

export interface CursorInfo {
  line: number;
  column: number;
  wordCount: number;
  charCount: number;
  /** Number of selection ranges (1 unless multi-cursor). */
  selectionCount: number;
  /** Characters selected, summed over all ranges. */
  selectionLength: number;
}

type ChangeCallback = (tabId: string, doc: string) => void;
type CursorCallback = (info: CursorInfo) => void;
type OutlineCallback = (items: OutlineItem[]) => void;
type LanguageErrorCallback = (tabId: string, languageId: string, error: unknown) => void;

/** Per-tab reconfigurable slices of the editor configuration. */
interface TabCompartments {
  readonly wrap: Compartment;
  readonly font: Compartment;
  readonly minimap: Compartment;
  readonly language: Compartment;
  readonly indent: Compartment;
  readonly whitespace: Compartment;
}

function newTabCompartments(): TabCompartments {
  return {
    wrap: new Compartment(),
    font: new Compartment(),
    minimap: new Compartment(),
    language: new Compartment(),
    indent: new Compartment(),
    whitespace: new Compartment(),
  };
}

function wrapExtension(settings: EditorSettings): Extension {
  return settings.wordWrap ? EditorView.lineWrapping : [];
}

function fontExtension(settings: EditorSettings): Extension {
  return EditorView.theme({ ".cm-content": { fontSize: `${settings.fontSize}px` } });
}

function indentExtension(settings: EditorSettings): Extension {
  return [
    indentUnit.of(settings.indentWithTabs ? "\t" : " ".repeat(settings.indentSize)),
    EditorState.tabSize.of(settings.indentSize),
  ];
}

function whitespaceExtension(settings: EditorSettings): Extension {
  return settings.showWhitespace ? highlightWhitespace() : [];
}

function createMinimapDom(): { dom: HTMLElement } {
  return { dom: document.createElement("div") };
}

/**
 * The minimap's LinesState recomputes the whole-document line model on every
 * keystroke, so its per-key cost grows linearly with document size. Measured
 * overhead (state-level, excludes canvas draw so it's a lower bound):
 *   10k lines ≈ +0.6ms/key · 20k ≈ +1.8ms/key · 50k ≈ +5.7ms/key.
 * Above this threshold the minimap is dropped from the editor via a compartment
 * so typing stays snappy; normal markdown files are far below it and keep it.
 */
const MINIMAP_MAX_LINES = 10000;

function countLines(doc: string): number {
  let lines = 1;
  for (let i = 0; i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10 /* \n */) lines++;
  }
  return lines;
}

function minimapExtension() {
  return showMinimap.compute([], () => ({
    create: createMinimapDom,
    displayText: "blocks" as const,
    showOverlay: "always" as const,
  }));
}

/** The minimap extension for a document, or nothing if it's too large. */
function minimapFor(doc: string) {
  return countLines(doc) <= MINIMAP_MAX_LINES ? minimapExtension() : [];
}

/**
 * Manages a pool of CodeMirror EditorView instances, one per tab. Settings and
 * each tab's language are applied through per-tab Compartments.
 */
export class EditorManager {
  private editors = new Map<string, EditorView>();
  private compartments = new Map<string, TabCompartments>();
  /** The language most recently requested per tab; a parser load that resolves for any other id is stale. */
  private languageIds = new Map<string, string>();
  private container: HTMLElement | null = null;
  private activeId: string | null = null;
  private onChangeRef: { current: ChangeCallback | null } = { current: null };
  private onCursorRef: { current: CursorCallback | null } = { current: null };
  private onOutlineRef: { current: OutlineCallback | null } = { current: null };
  private onLanguageErrorRef: { current: LanguageErrorCallback | null } = { current: null };
  private settings: EditorSettings = { ...DEFAULTS };
  private wordCountTimer: ReturnType<typeof setTimeout> | null = null;
  private contentSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWordCount = 0;
  private lastCharCount = 0;

  attach(container: HTMLElement) {
    this.container = container;
  }

  detach() {
    this.editors.forEach((view) => view.destroy());
    this.editors.clear();
    this.compartments.clear();
    this.languageIds.clear();
    this.container = null;
    this.activeId = null;
  }

  setOnChange(cb: ChangeCallback) {
    this.onChangeRef.current = cb;
  }

  setOnCursorChange(cb: CursorCallback) {
    this.onCursorRef.current = cb;
  }

  /**
   * Called when a language's parser fails to load; the tab keeps its previous
   * language. Without a listener the failure is logged to the console.
   */
  setOnLanguageError(cb: LanguageErrorCallback | null) {
    this.onLanguageErrorRef.current = cb;
  }

  /** Selection stats are O(ranges); word/char counts come from the debounced pipeline. */
  private cursorInfo(state: EditorState): CursorInfo {
    const { selection } = state;
    const pos = selection.main.head;
    const line = state.doc.lineAt(pos);
    let selectionLength = 0;
    for (const range of selection.ranges) selectionLength += range.to - range.from;
    return {
      line: line.number,
      column: pos - line.from + 1,
      wordCount: this.lastWordCount,
      charCount: this.lastCharCount,
      selectionCount: selection.ranges.length,
      selectionLength,
    };
  }

  /**
   * Subscribe to heading-outline updates, or pass null to unsubscribe. With no
   * listener attached the outline is never computed. Subscribing emits the
   * active document's outline immediately.
   */
  setOnOutlineChange(cb: OutlineCallback | null) {
    this.onOutlineRef.current = cb;
    if (!cb) return;
    const view = this.getActiveView();
    if (view) cb(extractOutline(view.state.doc.toString()));
  }

  private emitOutline(doc: string) {
    const cb = this.onOutlineRef.current;
    if (!cb) return;
    cb(extractOutline(doc));
  }

  /** Move the cursor to `pos`, scroll it to the top of the viewport and focus. */
  jumpTo(pos: number) {
    const view = this.getActiveView();
    if (!view) return;
    const target = Math.max(0, Math.min(pos, view.state.doc.length));
    view.dispatch({
      selection: EditorSelection.cursor(target),
      effects: EditorView.scrollIntoView(target, { y: "start", yMargin: 24 }),
    });
    view.focus();
  }

  setSettings(settings: EditorSettings) {
    this.settings = settings;
  }

  private buildExtensions(
    tabId: string,
    compartments: TabCompartments,
    initialDoc: string,
    languageId: string,
  ): Extension {
    return [
      EditorState.allowMultipleSelections.of(true),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      lineNumbers(),
      foldGutter(),
      // Markdown formatting chords live in the markdown language extension, so
      // they exist only in markdown tabs.
      keymap.of([
        // Replaces searchKeymap's Mod-g findNext in the editor (F3 still finds next).
        { key: "Mod-g", run: gotoLine },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      // Non-markdown languages start as plain text until their parser loads.
      compartments.language.of(isMarkdownLanguage(languageId) ? markdownLanguageExtension : []),
      mdeEditorTheme,
      mdeHighlightStyle,
      // Minimap, disabled above MINIMAP_MAX_LINES for typing performance.
      compartments.minimap.of(minimapFor(initialDoc)),
      // Settings-driven compartments
      compartments.wrap.of(wrapExtension(this.settings)),
      compartments.font.of(fontExtension(this.settings)),
      compartments.indent.of(indentExtension(this.settings)),
      compartments.whitespace.of(whitespaceExtension(this.settings)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Debounce content sync to React for large file performance
          if (this.contentSyncTimer) clearTimeout(this.contentSyncTimer);
          this.contentSyncTimer = setTimeout(() => {
            this.onChangeRef.current?.(tabId, update.state.doc.toString());
          }, 100);
        }
        if (update.selectionSet || update.docChanged) {
          // Cursor position and selection stats are instant; word/char counts are debounced
          this.onCursorRef.current?.(this.cursorInfo(update.state));

          if (update.docChanged) {
            if (this.wordCountTimer) clearTimeout(this.wordCountTimer);
            this.wordCountTimer = setTimeout(() => {
              // Read the view's current state: the cursor may have moved since this edit.
              const state = update.view.state;
              const text = state.doc.toString();
              this.lastWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
              this.lastCharCount = text.length;
              this.onCursorRef.current?.(this.cursorInfo(state));
              // The outline rides the same debounce — never per keystroke.
              this.emitOutline(text);
            }, 250);
          }
        }
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ];
  }

  /**
   * The tab's editor, created on first call. `languageId` applies only at
   * creation; change an existing tab's language with `setLanguage`.
   */
  ensureEditor(tabId: string, initialDoc: string, languageId: string = MARKDOWN_LANGUAGE): EditorView {
    let view = this.editors.get(tabId);
    if (view) return view;

    if (!this.container) throw new Error("EditorManager not attached");

    const wrapper = document.createElement("div");
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    wrapper.style.display = "none";
    wrapper.dataset.tabId = tabId;
    this.container.appendChild(wrapper);

    const compartments = newTabCompartments();
    this.compartments.set(tabId, compartments);
    this.languageIds.set(tabId, languageId);

    const state = EditorState.create({
      doc: initialDoc,
      extensions: this.buildExtensions(tabId, compartments, initialDoc, languageId),
    });

    view = new EditorView({ state, parent: wrapper });
    this.editors.set(tabId, view);
    if (!isMarkdownLanguage(languageId)) void this.applyLanguage(tabId, languageId);
    return view;
  }

  /**
   * Switch a tab's language. Resolves true once applied; false when the tab is
   * gone, another language was requested before the parser loaded, or the
   * load failed (reported through `setOnLanguageError`).
   */
  setLanguage(tabId: string, languageId: string): Promise<boolean> {
    if (!this.editors.has(tabId)) return Promise.resolve(false);
    this.languageIds.set(tabId, languageId);
    return this.applyLanguage(tabId, languageId);
  }

  private async applyLanguage(tabId: string, languageId: string): Promise<boolean> {
    let extension: Extension;
    try {
      extension = await loadLanguageExtension(languageId);
    } catch (error) {
      if (this.languageIds.get(tabId) === languageId) this.reportLanguageError(tabId, languageId, error);
      return false;
    }
    const view = this.editors.get(tabId);
    const compartments = this.compartments.get(tabId);
    if (!view || !compartments || this.languageIds.get(tabId) !== languageId) return false;
    view.dispatch({ effects: compartments.language.reconfigure(extension) });
    return true;
  }

  private reportLanguageError(tabId: string, languageId: string, error: unknown) {
    const cb = this.onLanguageErrorRef.current;
    if (cb) cb(tabId, languageId, error);
    else console.error(`Failed to load the ${languageId} language for tab ${tabId}`, error);
  }

  /** Show a tab's editor, creating it if needed (`languageId` applies only at creation). */
  activate(tabId: string, initialDoc: string, languageId: string = MARKDOWN_LANGUAGE) {
    const doneSwitch = perf.tabSwitch(tabId);
    this.ensureEditor(tabId, initialDoc, languageId);

    if (this.container) {
      for (const child of Array.from(this.container.children) as HTMLElement[]) {
        child.style.display = child.dataset.tabId === tabId ? "block" : "none";
      }
    }

    this.activeId = tabId;

    const view = this.editors.get(tabId);
    if (view) {
      // Force CodeMirror to remeasure after the wrapper becomes visible.
      // Without this, editors created in display:none containers have 0px height.
      requestAnimationFrame(() => {
        view.requestMeasure();
        view.focus();
        perf.editorReady();
        doneSwitch();
      });

      const text = view.state.doc.toString();
      this.lastWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      this.lastCharCount = text.length;
      this.onCursorRef.current?.(this.cursorInfo(view.state));
      this.emitOutline(text);
    }
  }

  setContent(tabId: string, content: string) {
    const view = this.editors.get(tabId);
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      // Preserve cursor position (clamped to new doc length)
      const prevPos = view.state.selection.main.head;
      const newPos = Math.min(prevPos, content.length);
      // Loading a new document may cross the minimap size threshold — reconfigure
      // in the same transaction so large files never mount the minimap at all.
      const compartments = this.compartments.get(tabId);
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        selection: EditorSelection.single(newPos),
        effects: compartments ? compartments.minimap.reconfigure(minimapFor(content)) : [],
      });
    }
  }

  removeEditor(tabId: string) {
    const view = this.editors.get(tabId);
    if (view) {
      const wrapper = view.dom.parentElement;
      view.destroy();
      wrapper?.remove();
      this.editors.delete(tabId);
      this.compartments.delete(tabId);
      this.languageIds.delete(tabId);
    }
  }

  getContent(tabId: string): string | undefined {
    return this.editors.get(tabId)?.state.doc.toString();
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getActiveView(): EditorView | null {
    if (!this.activeId) return null;
    return this.editors.get(this.activeId) ?? null;
  }

  /** Reconfigure wrap, font size, indentation and whitespace markers across all editors. */
  updateSettings(settings: EditorSettings) {
    this.settings = settings;
    this.editors.forEach((view, tabId) => {
      const compartments = this.compartments.get(tabId);
      if (!compartments) return;
      view.dispatch({
        effects: [
          compartments.wrap.reconfigure(wrapExtension(settings)),
          compartments.font.reconfigure(fontExtension(settings)),
          compartments.indent.reconfigure(indentExtension(settings)),
          compartments.whitespace.reconfigure(whitespaceExtension(settings)),
        ],
      });
    });
  }
}
