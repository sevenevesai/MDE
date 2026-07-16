import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/utils";
import type { CursorInfo } from "./EditorManager";

type ChangeCallback = (tabId: string, doc: string) => void;
type CursorCallback = (info: CursorInfo) => void;

/**
 * Manages Milkdown Crepe editor instances for WYSIWYG mode.
 * Mirrors the EditorManager pattern: one instance per tab, show/hide on switch.
 *
 * Key: ProseMirror must be created inside a VISIBLE container so it can
 * measure layout. We show the wrapper first, then create the editor.
 */
export class MilkdownManager {
  private editors = new Map<string, Crepe>();
  private wrappers = new Map<string, HTMLElement>();
  private container: HTMLElement | null = null;
  private activeId: string | null = null;
  private onChangeRef: { current: ChangeCallback | null } = { current: null };
  private onCursorRef: { current: CursorCallback | null } = { current: null };
  private creating = new Map<string, Promise<Crepe>>();
  /** Tabs where onChange is suppressed (initial normalization pass). */
  private suppressChange = new Set<string>();
  /** Tracks whether the user actually edited content in visual mode. */
  private userEdited = new Set<string>();
  /** The original content passed to Milkdown for each tab. */
  private originalContent = new Map<string, string>();

  attach(container: HTMLElement) {
    this.container = container;
  }

  detach() {
    this.editors.forEach((crepe) => crepe.destroy());
    this.editors.clear();
    this.wrappers.forEach((w) => w.remove());
    this.wrappers.clear();
    this.container = null;
    this.activeId = null;
    this.creating.clear();
  }

  setOnChange(cb: ChangeCallback) {
    this.onChangeRef.current = cb;
  }

  setOnCursorChange(cb: CursorCallback) {
    this.onCursorRef.current = cb;
  }

  private getOrCreateWrapper(tabId: string): HTMLElement {
    let wrapper = this.wrappers.get(tabId);
    if (wrapper) return wrapper;

    if (!this.container) throw new Error("MilkdownManager not attached");

    wrapper = document.createElement("div");
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    wrapper.style.display = "none";
    wrapper.style.overflow = "auto";
    wrapper.dataset.milkdownTabId = tabId;
    this.container.appendChild(wrapper);
    this.wrappers.set(tabId, wrapper);
    return wrapper;
  }

  private createEditor(tabId: string, wrapper: HTMLElement, doc: string): Promise<Crepe> {
    // If already creating this tab's editor, return the existing promise
    const inFlight = this.creating.get(tabId);
    if (inFlight) return inFlight;

    const promise = this.buildEditor(tabId, wrapper, doc).finally(() => {
      this.creating.delete(tabId);
    });

    this.creating.set(tabId, promise);
    return promise;
  }

  private async buildEditor(tabId: string, wrapper: HTMLElement, doc: string): Promise<Crepe> {
    const crepe = new Crepe({
      root: wrapper,
      defaultValue: doc,
      features: {
        [CrepeFeature.Toolbar]: true,
        [CrepeFeature.LinkTooltip]: true,
        [CrepeFeature.ListItem]: true,
        [CrepeFeature.Placeholder]: true,
        [CrepeFeature.BlockEdit]: true,
        [CrepeFeature.ImageBlock]: true,
        [CrepeFeature.Table]: true,
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.Cursor]: true,
        [CrepeFeature.Latex]: false,
      },
    });

    // Suppress onChange during creation to ignore Milkdown's normalization pass
    this.suppressChange.add(tabId);
    this.userEdited.delete(tabId);
    this.originalContent.set(tabId, doc);

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
        if (markdown !== prevMarkdown && !this.suppressChange.has(tabId)) {
          this.userEdited.add(tabId);
          this.onChangeRef.current?.(tabId, markdown);
        }
      });
    });

    await crepe.create();
    this.editors.set(tabId, crepe);

    // Allow onChange after a tick (normalization is done by now)
    requestAnimationFrame(() => this.suppressChange.delete(tabId));

    return crepe;
  }

  /**
   * Activate a tab's Milkdown editor.
   * Shows the wrapper FIRST so ProseMirror can measure layout,
   * then creates the editor if needed.
   */
  async activate(tabId: string, initialDoc: string) {
    const wrapper = this.getOrCreateWrapper(tabId);

    // Show this wrapper, hide all others — BEFORE creating editor
    this.wrappers.forEach((w, id) => {
      w.style.display = id === tabId ? "block" : "none";
    });

    this.activeId = tabId;

    // Now create the editor if it doesn't exist (wrapper is visible)
    let crepe = this.editors.get(tabId);
    if (!crepe) {
      crepe = await this.createEditor(tabId, wrapper, initialDoc);
    }

    // Fire cursor info
    try {
      const text = crepe.getMarkdown();
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      this.onCursorRef.current?.({ line: 1, column: 1, wordCount: words, charCount: text.length });
    } catch {
      // getMarkdown can throw if editor isn't fully ready
    }
  }

  /** Replace content for a tab in-place, falling back to recreate if needed */
  async setContent(tabId: string, markdown: string) {
    const existing = this.editors.get(tabId);

    if (existing) {
      try {
        existing.editor.action(replaceAll(markdown));
        return;
      } catch {
        // replaceAll failed — fall back to destroy/recreate
      }
    }

    const wrapper = this.wrappers.get(tabId);
    if (!wrapper) return;

    if (existing) {
      try { await existing.destroy(); } catch { /* ignore */ }
      this.editors.delete(tabId);
      wrapper.innerHTML = "";
    }

    wrapper.style.display = this.activeId === tabId ? "block" : "none";
    await this.createEditor(tabId, wrapper, markdown);
  }

  getMarkdown(tabId: string): string | undefined {
    try {
      return this.editors.get(tabId)?.getMarkdown();
    } catch {
      return undefined;
    }
  }

  /**
   * Get content to sync back to raw mode.
   * Returns the original content if the user didn't edit in visual mode,
   * avoiding false "modified" state from Milkdown's markdown normalization.
   */
  getContentForRawSync(tabId: string): string | undefined {
    if (!this.userEdited.has(tabId)) {
      return this.originalContent.get(tabId);
    }
    return this.getMarkdown(tabId);
  }

  removeEditor(tabId: string) {
    const crepe = this.editors.get(tabId);
    if (crepe) {
      try { crepe.destroy(); } catch { /* ignore */ }
      this.editors.delete(tabId);
    }
    this.userEdited.delete(tabId);
    this.originalContent.delete(tabId);
    this.suppressChange.delete(tabId);
    const wrapper = this.wrappers.get(tabId);
    if (wrapper) {
      wrapper.remove();
      this.wrappers.delete(tabId);
    }
  }

  getActiveId(): string | null {
    return this.activeId;
  }
}
