import { Crepe, CrepeFeature } from "@milkdown/crepe";
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
  private creating = new Set<string>();

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

  private async createEditor(tabId: string, wrapper: HTMLElement, doc: string): Promise<Crepe> {
    if (this.creating.has(tabId)) {
      // Wait for the in-progress creation to finish
      while (this.creating.has(tabId)) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const existing = this.editors.get(tabId);
      if (existing) return existing;
    }

    this.creating.add(tabId);

    try {
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

      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) {
            this.onChangeRef.current?.(tabId, markdown);
          }
        });
      });

      await crepe.create();
      this.editors.set(tabId, crepe);
      return crepe;
    } finally {
      this.creating.delete(tabId);
    }
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
      this.onCursorRef.current?.({ line: 1, column: 1, wordCount: words });
    } catch {
      // getMarkdown can throw if editor isn't fully ready
    }
  }

  /** Replace content for a tab — destroys and recreates the editor */
  async setContent(tabId: string, markdown: string) {
    const existing = this.editors.get(tabId);
    const wrapper = this.wrappers.get(tabId);
    if (!wrapper) return;

    // Destroy existing editor if any
    if (existing) {
      try {
        await existing.destroy();
      } catch {
        // ignore
      }
      this.editors.delete(tabId);
      // Clear the wrapper's children
      wrapper.innerHTML = "";
    }

    // Make visible before creating
    wrapper.style.display = this.activeId === tabId ? "block" : "none";

    // Recreate with new content
    await this.createEditor(tabId, wrapper, markdown);
  }

  getMarkdown(tabId: string): string | undefined {
    try {
      return this.editors.get(tabId)?.getMarkdown();
    } catch {
      return undefined;
    }
  }

  removeEditor(tabId: string) {
    const crepe = this.editors.get(tabId);
    if (crepe) {
      try { crepe.destroy(); } catch { /* ignore */ }
      this.editors.delete(tabId);
    }
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
