import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
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
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  toggleBold, toggleItalic, toggleStrikethrough, toggleInlineCode,
  insertLink, insertImage, toggleBulletList, toggleOrderedList,
  toggleBlockquote, insertCodeBlock, setHeading, toggleCheckbox,
} from "./commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  bracketMatching,
  indentOnInput,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { showMinimap } from "@replit/codemirror-minimap";
import { mdeEditorTheme, mdeHighlightStyle } from "./theme";
import type { EditorSettings } from "../settings";
import { perf } from "../perf";

export interface CursorInfo {
  line: number;
  column: number;
  wordCount: number;
  charCount: number;
}

type ChangeCallback = (tabId: string, doc: string) => void;
type CursorCallback = (info: CursorInfo) => void;

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
 * Manages a pool of CodeMirror EditorView instances, one per tab.
 * Supports dynamic word wrap and font size via Compartments.
 */
export class EditorManager {
  private editors = new Map<string, EditorView>();
  private wrapCompartments = new Map<string, Compartment>();
  private fontCompartments = new Map<string, Compartment>();
  private minimapCompartments = new Map<string, Compartment>();
  private container: HTMLElement | null = null;
  private activeId: string | null = null;
  private onChangeRef: { current: ChangeCallback | null } = { current: null };
  private onCursorRef: { current: CursorCallback | null } = { current: null };
  private settings: EditorSettings = { wordWrap: true, fontSize: 14 };
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
    this.wrapCompartments.clear();
    this.fontCompartments.clear();
    this.minimapCompartments.clear();
    this.container = null;
    this.activeId = null;
  }

  setOnChange(cb: ChangeCallback) {
    this.onChangeRef.current = cb;
  }

  setOnCursorChange(cb: CursorCallback) {
    this.onCursorRef.current = cb;
  }

  setSettings(settings: EditorSettings) {
    this.settings = settings;
  }

  private buildExtensions(
    tabId: string,
    wrapComp: Compartment,
    fontComp: Compartment,
    minimapComp: Compartment,
    initialDoc: string,
  ) {
    return [
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
      keymap.of([
        { key: "Mod-b", run: toggleBold },
        { key: "Mod-i", run: toggleItalic },
        { key: "Mod-Shift-x", run: toggleStrikethrough },
        { key: "Mod-`", run: toggleInlineCode },
        { key: "Mod-k", run: insertLink },
        { key: "Mod-Shift-k", run: insertImage },
        { key: "Mod-Shift-8", run: toggleBulletList },
        { key: "Mod-Shift-7", run: toggleOrderedList },
        { key: "Mod-Shift-9", run: toggleCheckbox },
        { key: "Mod-Shift-.", run: toggleBlockquote },
        { key: "Mod-Shift-`", run: insertCodeBlock },
        { key: "Mod-1", run: (v) => setHeading(v, 1) },
        { key: "Mod-2", run: (v) => setHeading(v, 2) },
        { key: "Mod-3", run: (v) => setHeading(v, 3) },
        { key: "Mod-4", run: (v) => setHeading(v, 4) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      mdeEditorTheme,
      mdeHighlightStyle,
      // Minimap, disabled above MINIMAP_MAX_LINES for typing performance.
      minimapComp.of(minimapFor(initialDoc)),
      // Dynamic compartments
      wrapComp.of(this.settings.wordWrap ? EditorView.lineWrapping : []),
      fontComp.of(EditorView.theme({ ".cm-content": { fontSize: `${this.settings.fontSize}px` } })),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Debounce content sync to React for large file performance
          if (this.contentSyncTimer) clearTimeout(this.contentSyncTimer);
          this.contentSyncTimer = setTimeout(() => {
            this.onChangeRef.current?.(tabId, update.state.doc.toString());
          }, 100);
        }
        if (update.selectionSet || update.docChanged) {
          const state = update.state;
          const pos = state.selection.main.head;
          const line = state.doc.lineAt(pos);

          // Cursor position is instant; word/char counts are debounced
          this.onCursorRef.current?.({
            line: line.number,
            column: pos - line.from + 1,
            wordCount: this.lastWordCount,
            charCount: this.lastCharCount,
          });

          if (update.docChanged) {
            if (this.wordCountTimer) clearTimeout(this.wordCountTimer);
            this.wordCountTimer = setTimeout(() => {
              const text = update.state.doc.toString();
              this.lastWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
              this.lastCharCount = text.length;
              this.onCursorRef.current?.({
                line: line.number,
                column: pos - line.from + 1,
                wordCount: this.lastWordCount,
                charCount: this.lastCharCount,
              });
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

  ensureEditor(tabId: string, initialDoc: string): EditorView {
    let view = this.editors.get(tabId);
    if (view) return view;

    if (!this.container) throw new Error("EditorManager not attached");

    const wrapper = document.createElement("div");
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    wrapper.style.display = "none";
    wrapper.dataset.tabId = tabId;
    this.container.appendChild(wrapper);

    const wrapComp = new Compartment();
    const fontComp = new Compartment();
    const minimapComp = new Compartment();
    this.wrapCompartments.set(tabId, wrapComp);
    this.fontCompartments.set(tabId, fontComp);
    this.minimapCompartments.set(tabId, minimapComp);

    const state = EditorState.create({
      doc: initialDoc,
      extensions: this.buildExtensions(tabId, wrapComp, fontComp, minimapComp, initialDoc),
    });

    view = new EditorView({ state, parent: wrapper });
    this.editors.set(tabId, view);
    return view;
  }

  activate(tabId: string, initialDoc: string) {
    const doneSwitch = perf.tabSwitch(tabId);
    this.ensureEditor(tabId, initialDoc);

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

      const state = view.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const text = state.doc.toString();
      this.lastWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      this.lastCharCount = text.length;
      this.onCursorRef.current?.({
        line: line.number,
        column: pos - line.from + 1,
        wordCount: this.lastWordCount,
        charCount: this.lastCharCount,
      });
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
      const minimapComp = this.minimapCompartments.get(tabId);
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        selection: EditorSelection.single(newPos),
        effects: minimapComp ? minimapComp.reconfigure(minimapFor(content)) : [],
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
      this.wrapCompartments.delete(tabId);
      this.fontCompartments.delete(tabId);
      this.minimapCompartments.delete(tabId);
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

  /** Reconfigure word wrap and font size across all editors. */
  updateSettings(settings: EditorSettings) {
    this.settings = settings;
    this.editors.forEach((view, tabId) => {
      const wrapComp = this.wrapCompartments.get(tabId);
      const fontComp = this.fontCompartments.get(tabId);
      if (wrapComp && fontComp) {
        view.dispatch({
          effects: [
            wrapComp.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
            fontComp.reconfigure(
              EditorView.theme({ ".cm-content": { fontSize: `${settings.fontSize}px` } })
            ),
          ],
        });
      }
    });
  }
}
