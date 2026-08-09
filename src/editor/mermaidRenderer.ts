/**
 * Mermaid diagram rendering for visual (Milkdown) mode.
 *
 * mermaid.js is large and only useful when a document actually contains a
 * ```mermaid fence, so it sits behind a memoized dynamic import() exactly like
 * the Milkdown graph in MilkdownManager: Vite emits it as its own chunk and the
 * chunk is fetched the first time a mermaid fence needs drawing. Never add a
 * static `import ... from "mermaid"` anywhere — it would land in the startup
 * bundle.
 *
 * Rendering is display-only. It feeds Crepe's code-block *preview* panel and
 * never dispatches a ProseMirror transaction, so it cannot fire markdownUpdated
 * and can never mark a tab dirty.
 */

/** Crepe's code-block preview callback: `null` means "no preview for this block". */
type ApplyPreview = (value: null | string | HTMLElement) => void;

/** Fenced block opened with ``` or ~~~ whose info string starts with `mermaid`. */
const MERMAID_FENCE = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*mermaid\b/im;

/**
 * Does this document contain a mermaid fence? Used to decide whether the
 * mermaid chunk is worth prefetching when an editor is built — the render path
 * itself gates on the code block's language, so a document without a fence
 * never touches mermaid.
 */
export function hasMermaidFence(content: string): boolean {
  return MERMAID_FENCE.test(content);
}

/** Re-render no more often than this while the user is typing in a diagram. */
export const RENDER_DEBOUNCE_MS = 250;

const DARK_THEME_VARIABLES = {
  background: "#0d1117",
  primaryColor: "#161b22",
  primaryTextColor: "#e6edf3",
  primaryBorderColor: "#30363d",
  secondaryColor: "#1c2128",
  tertiaryColor: "#21262d",
  mainBkg: "#161b22",
  lineColor: "#8b949e",
  textColor: "#e6edf3",
  nodeBorder: "#30363d",
  clusterBkg: "#0d1117",
  clusterBorder: "#30363d",
  titleColor: "#e6edf3",
  edgeLabelBackground: "#161b22",
  actorBkg: "#161b22",
  actorBorder: "#30363d",
  actorTextColor: "#e6edf3",
  signalColor: "#8b949e",
  signalTextColor: "#e6edf3",
  labelBoxBkgColor: "#161b22",
  labelBoxBorderColor: "#30363d",
  labelTextColor: "#e6edf3",
  noteBkgColor: "#1c2128",
  noteBorderColor: "#30363d",
  noteTextColor: "#e6edf3",
};

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidModule: Promise<MermaidApi> | null = null;

/** Memoized lazy load + one-time dark-theme configuration. */
export function loadMermaid(): Promise<MermaidApi> {
  if (mermaidModule) return mermaidModule;
  mermaidModule = import("mermaid").then((mod) => {
    const mermaid = mod.default as unknown as MermaidApi;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      // Crepe sanitizes the preview HTML with DOMPurify, which drops
      // <foreignObject>. HTML labels live in one, so they must be off or every
      // diagram would render without its text.
      htmlLabels: false,
      fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
      themeVariables: DARK_THEME_VARIABLES,
    });
    return mermaid;
  });
  return mermaidModule;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A diagram that will not parse still has to show something useful: the source
 * the user wrote plus a one-line hint. Never throws, never touches the document.
 */
export function buildErrorCard(code: string, message: string): string {
  return (
    `<div class="mde-mermaid-error">` +
    `<div class="mde-mermaid-error-hint">Diagram error: ${escapeHtml(message)}</div>` +
    `<pre class="mde-mermaid-error-source">${escapeHtml(code)}</pre>` +
    `</div>`
  );
}

const MAX_CACHED_RENDERS = 32;
const renderCache = new Map<string, string>();

let renderSeq = 0;

/** Render one diagram to preview HTML. Resolves to an error card on bad syntax. */
export async function renderMermaid(code: string): Promise<string> {
  const cached = renderCache.get(code);
  if (cached !== undefined) return cached;

  let html: string;
  const id = `mde-mermaid-${++renderSeq}`;
  try {
    const mermaid = await loadMermaid();
    html = (await mermaid.render(id, code)).svg;
  } catch (err) {
    html = buildErrorCard(code, err instanceof Error ? err.message : String(err));
  }
  // mermaid measures in a throwaway element appended to the body; a failed
  // parse can leave it behind.
  document.getElementById(`d${id}`)?.remove();
  document.getElementById(id)?.remove();

  if (renderCache.size >= MAX_CACHED_RENDERS) {
    const oldest = renderCache.keys().next();
    if (!oldest.done) renderCache.delete(oldest.value);
  }
  renderCache.set(code, html);
  return html;
}

/**
 * Crepe hands every preview call a fresh `applyPreview` closure and no block
 * identity, so pending work is coalesced by source instead. Typing produces a
 * run of sources where each is a prefix of the next (or the previous, when
 * deleting); only the newest of such a run is worth drawing. Sources unrelated
 * that way belong to different diagrams and are all kept.
 */
export function dropSuperseded<T>(entries: [string, T][]): [string, T][] {
  return entries.filter(([code], i) =>
    entries.every(
      ([later], j) =>
        j <= i || (!later.startsWith(code) && !code.startsWith(later))
    )
  );
}

const queue = new Map<string, ApplyPreview[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  flushTimer = null;
  const entries = dropSuperseded([...queue.entries()]);
  queue.clear();
  for (const [code, applies] of entries) {
    const html = await renderMermaid(code);
    for (const apply of applies) apply(html);
    // Yield between diagrams so a document full of them never blocks a frame.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * `renderPreview` implementation for Crepe's code-mirror feature.
 * Returns `null` for every non-mermaid block (Crepe then shows a plain code
 * block and mermaid is never loaded) and `undefined` for mermaid blocks, which
 * tells Crepe the preview arrives asynchronously via `apply`.
 */
export function renderMermaidPreview(
  language: string,
  content: string,
  apply: ApplyPreview
): null | undefined {
  if (language !== "mermaid") return null;
  if (!content.trim()) return null;

  const cached = renderCache.get(content);
  if (cached !== undefined) {
    // Already drawn once (tab switch, undo back to a previous state): applying
    // synchronously avoids a "loading" flash.
    apply(cached);
    return undefined;
  }

  const waiting = queue.get(content);
  if (waiting) waiting.push(apply);
  else queue.set(content, [apply]);

  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, RENDER_DEBOUNCE_MS);
  return undefined;
}
