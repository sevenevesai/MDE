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
  toggleBlockquote, insertCodeBlock, setHeading,
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

export interface CursorInfo {
  line: number;
  column: number;
  wordCount: number;
}

type ChangeCallback = (tabId: string, doc: string) => void;
type CursorCallback = (info: CursorInfo) => void;

function createMinimapDom(): { dom: HTMLElement } {
  return { dom: document.createElement("div") };
}

/**
 * Manages a pool of CodeMirror EditorView instances, one per tab.
 * Supports dynamic word wrap and font size via Compartments.
 */
export class EditorManager {
  private editors = new Map<string, EditorView>();
  private wrapCompartments = new Map<string, Compartment>();
  private fontCompartments = new Map<string, Compartment>();
  private container: HTMLElement | null = null;
  private activeId: string | null = null;
  private onChangeRef: { current: ChangeCallback | null } = { current: null };
  private onCursorRef: { current: CursorCallback | null } = { current: null };
  private settings: EditorSettings = { wordWrap: true, fontSize: 14 };
  private wordCountTimer: ReturnType<typeof setTimeout> | null = null;
  private contentSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWordCount = 0;

  attach(container: HTMLElement) {
    this.container = container;
  }

  detach() {
    this.editors.forEach((view) => view.destroy());
    this.editors.clear();
    this.wrapCompartments.clear();
    this.fontCompartments.clear();
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

  private buildExtensions(tabId: string, wrapComp: Compartment, fontComp: Compartment) {
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
      showMinimap.compute([], () => ({
        create: createMinimapDom,
        displayText: "blocks",
        showOverlay: "always",
      })),
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

          // Cursor position is instant; word count is debounced
          this.onCursorRef.current?.({
            line: line.number,
            column: pos - line.from + 1,
            wordCount: this.lastWordCount,
          });

          if (update.docChanged) {
            if (this.wordCountTimer) clearTimeout(this.wordCountTimer);
            this.wordCountTimer = setTimeout(() => {
              const text = update.state.doc.toString();
              this.lastWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
              this.onCursorRef.current?.({
                line: line.number,
                column: pos - line.from + 1,
                wordCount: this.lastWordCount,
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
    this.wrapCompartments.set(tabId, wrapComp);
    this.fontCompartments.set(tabId, fontComp);

    const state = EditorState.create({
      doc: initialDoc,
      extensions: this.buildExtensions(tabId, wrapComp, fontComp),
    });

    view = new EditorView({ state, parent: wrapper });
    this.editors.set(tabId, view);
    return view;
  }

  activate(tabId: string, initialDoc: string) {
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
      });

      const state = view.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const text = state.doc.toString();
      this.lastWordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      this.onCursorRef.current?.({
        line: line.number,
        column: pos - line.from + 1,
        wordCount: this.lastWordCount,
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
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        selection: EditorSelection.single(newPos),
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
