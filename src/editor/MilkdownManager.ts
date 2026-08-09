import type { Crepe } from "@milkdown/crepe";
import type { CursorInfo } from "./EditorManager";

type ChangeCallback = (tabId: string, doc: string) => void;
type CursorCallback = (info: CursorInfo) => void;

/**
 * The Milkdown/Crepe graph (ProseMirror + CodeMirror + the Crepe theme CSS) is
 * heavy and only needed in visual mode. It is loaded via dynamic import() the
 * first time an editor is built, so raw-mode-only sessions never pay for it and
 * the whole stack lands in a separate build chunk instead of the startup bundle.
 */
type MilkdownModule = {
  Crepe: typeof import("@milkdown/crepe").Crepe;
  CrepeFeature: typeof import("@milkdown/crepe").CrepeFeature;
  replaceAll: typeof import("@milkdown/utils").replaceAll;
};

let milkdownModule: Promise<MilkdownModule> | null = null;

function loadMilkdown(): Promise<MilkdownModule> {
  if (milkdownModule) return milkdownModule;
  milkdownModule = (async () => {
    const [crepe, utils] = await Promise.all([
      import("@milkdown/crepe"),
      import("@milkdown/utils"),
      // CSS is pulled into the same lazy chunk instead of the startup bundle.
      import("@milkdown/crepe/theme/common/style.css"),
      import("@milkdown/crepe/theme/frame-dark.css"),
      import("./milkdown-dark.css"),
    ]);
    return { Crepe: crepe.Crepe, CrepeFeature: crepe.CrepeFeature, replaceAll: utils.replaceAll };
  })();
  return milkdownModule;
}

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
  /** Tabs where onChange is suppressed (programmatic create/replace pass). */
  private suppressChange = new Set<string>();
  /** Tracks whether the user actually edited content in visual mode. */
  private userEdited = new Set<string>();
  /** The original content passed to Milkdown for each tab. */
  private originalContent = new Map<string, string>();
  /**
   * Milkdown's own serialization of the original content. Normalization passes
   * can fire markdownUpdated at any time after creation, so telling user edits
   * apart needs a content compare, not a timing window: an event whose markdown
   * equals this baseline is the unchanged document, not an edit.
   */
  private normalizedOriginal = new Map<string, string>();

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
    // mermaidRenderer is only ever reachable from visual mode, so it rides the
    // same lazy boundary as Milkdown rather than sitting in the startup chunk.
    const [{ Crepe, CrepeFeature }, mermaid] = await Promise.all([
      loadMilkdown(),
      import("./mermaidRenderer"),
    ]);

    // Start fetching the mermaid chunk now so a document full of diagrams does
    // not wait for a second serial round trip. No fence, no request.
    if (mermaid.hasMermaidFence(doc)) {
      void mermaid.loadMermaid().catch(() => { /* the render path reports failures */ });
    }

    const crepe = new Crepe({
      root: wrapper,
      defaultValue: doc,
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          // Draws ```mermaid fences as diagrams in the code block's preview
          // panel. Every other language returns null and stays a code block.
          renderPreview: mermaid.renderMermaidPreview,
          previewLabel: "Diagram",
          // Only blocks that produced a preview (i.e. mermaid) are affected —
          // they open as the rendered diagram, with a toggle back to source.
          previewOnlyByDefault: true,
        },
      },
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
        if (markdown === prevMarkdown) return;
        if (this.suppressChange.has(tabId)) {
          // Programmatic pass (create/replaceAll) — record it as the baseline.
          this.normalizedOriginal.set(tabId, markdown);
          return;
        }
        if (markdown === this.normalizedOriginal.get(tabId)) {
          // Document matches the as-loaded state: a late normalization pass,
          // or the user undid their edits. Restore the pristine original so
          // the tab never goes "modified" from serialization differences.
          this.userEdited.delete(tabId);
          const original = this.originalContent.get(tabId);
          if (original !== undefined) this.onChangeRef.current?.(tabId, original);
          return;
        }
        this.userEdited.add(tabId);
        this.onChangeRef.current?.(tabId, markdown);
      });
    });

    await crepe.create();
    this.editors.set(tabId, crepe);

    try {
      this.normalizedOriginal.set(tabId, crepe.getMarkdown());
    } catch {
      // Editor not measurable yet — the suppressed pass above captured it.
    }

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
        // Milkdown is already loaded if an editor exists, so this resolves synchronously.
        const { replaceAll } = await loadMilkdown();
        // A programmatic replace is not a user edit: suppress the resulting
        // markdownUpdated event and re-baseline, same as on creation.
        this.suppressChange.add(tabId);
        this.userEdited.delete(tabId);
        this.originalContent.set(tabId, markdown);
        existing.editor.action(replaceAll(markdown));
        try {
          this.normalizedOriginal.set(tabId, existing.getMarkdown());
        } catch {
          // The suppressed pass above captured the baseline.
        }
        requestAnimationFrame(() => this.suppressChange.delete(tabId));
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
    this.normalizedOriginal.delete(tabId);
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
