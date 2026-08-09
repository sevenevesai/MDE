import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hasMermaidFence,
  buildErrorCard,
  dropSuperseded,
  renderMermaidPreview,
} from "../mermaidRenderer";

const m = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, code: string) => {
    if (code.includes("BOOM")) throw new Error("Parse error on line <1>");
    return { svg: `<svg data-code="${code.trim()}"></svg>` };
  }),
}));

vi.mock("mermaid", () => ({ default: m }));

beforeEach(() => {
  m.initialize.mockClear();
  m.render.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Drain the render debounce and the yield between diagrams. */
const settle = () => vi.advanceTimersByTimeAsync(1000);

describe("hasMermaidFence", () => {
  it("detects backtick and tilde fences anywhere in the document", () => {
    expect(hasMermaidFence("# Title\n\n```mermaid\ngraph TD\n```\n")).toBe(true);
    expect(hasMermaidFence("~~~mermaid\ngraph TD\n~~~")).toBe(true);
    expect(hasMermaidFence("  ```mermaid\ngraph TD\n```")).toBe(true);
    expect(hasMermaidFence("````mermaid\ngraph TD\n````")).toBe(true);
    // Fresh checkouts materialize CRLF; the info string still ends the line.
    expect(hasMermaidFence("```mermaid\r\ngraph TD\r\n```\r\n")).toBe(true);
  });

  it("ignores documents with no mermaid block", () => {
    expect(hasMermaidFence("# Title\n\nplain text about mermaid diagrams\n")).toBe(false);
    expect(hasMermaidFence("```js\nconst a = 1;\n```\n")).toBe(false);
    expect(hasMermaidFence("`mermaid`\n")).toBe(false);
    expect(hasMermaidFence("```mermaidjs\nx\n```")).toBe(false);
    expect(hasMermaidFence("")).toBe(false);
  });
});

describe("buildErrorCard", () => {
  it("shows the hint and the fence source, HTML-escaped", () => {
    const card = buildErrorCard("graph TD\n  A --> <B>", 'bad "token"');
    expect(card).toContain("Diagram error: bad &quot;token&quot;");
    expect(card).toContain("graph TD\n  A --&gt; &lt;B&gt;");
    expect(card).not.toContain("<B>");
  });
});

describe("dropSuperseded", () => {
  it("keeps only the newest of a prefix run (a burst of typing)", () => {
    const entries: [string, number][] = [["gra", 1], ["grap", 2], ["graph TD", 3]];
    expect(dropSuperseded(entries)).toEqual([["graph TD", 3]]);
  });

  it("keeps the newest when the source is being deleted back down", () => {
    const entries: [string, number][] = [["graph TD", 1], ["graph", 2]];
    expect(dropSuperseded(entries)).toEqual([["graph", 2]]);
  });

  it("keeps unrelated sources — separate diagrams in one document", () => {
    const entries: [string, number][] = [["graph TD", 1], ["sequenceDiagram", 2]];
    expect(dropSuperseded(entries)).toEqual(entries);
  });
});

describe("renderMermaidPreview", () => {
  it("declines every non-mermaid language and never loads mermaid", async () => {
    const apply = vi.fn();
    expect(renderMermaidPreview("javascript", "const a = 1;", apply)).toBeNull();
    expect(renderMermaidPreview("", "plain", apply)).toBeNull();
    expect(renderMermaidPreview("mermaid", "   ", apply)).toBeNull();

    await settle();
    expect(m.render).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("renders a mermaid block asynchronously", async () => {
    const apply = vi.fn();
    expect(renderMermaidPreview("mermaid", "graph TD\n A-->B", apply)).toBeUndefined();
    expect(apply).not.toHaveBeenCalled(); // debounced, never synchronous

    await settle();
    expect(apply).toHaveBeenCalledWith('<svg data-code="graph TD\n A-->B"></svg>');
  });

  it("coalesces a burst of edits into a single render of the final source", async () => {
    const apply = vi.fn();
    for (const code of ["seq", "sequence", "sequenceDiagram\n A->>B: hi"]) {
      renderMermaidPreview("mermaid", code, apply);
    }

    await settle();
    expect(m.render).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('<svg data-code="sequenceDiagram\n A->>B: hi"></svg>');
  });

  it("serves an already-rendered diagram from cache without a loading flash", async () => {
    const first = vi.fn();
    renderMermaidPreview("mermaid", "graph LR\n C-->D", first);
    await settle();
    m.render.mockClear();

    const second = vi.fn();
    expect(renderMermaidPreview("mermaid", "graph LR\n C-->D", second)).toBeUndefined();
    expect(second).toHaveBeenCalledWith('<svg data-code="graph LR\n C-->D"></svg>');
    expect(m.render).not.toHaveBeenCalled();
  });

  it("shows the source plus a hint when the diagram will not parse", async () => {
    const apply = vi.fn();
    renderMermaidPreview("mermaid", "BOOM not a diagram", apply);
    await settle();

    const html = apply.mock.calls[0][0] as string;
    expect(html).toContain("mde-mermaid-error");
    expect(html).toContain("Parse error on line &lt;1&gt;");
    expect(html).toContain("BOOM not a diagram");
  });

  it("draws every distinct diagram in a document, applying to each block", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const shared = vi.fn();
    renderMermaidPreview("mermaid", "pie\n title A", a);
    renderMermaidPreview("mermaid", "gantt\n title B", b);
    // Two blocks whose source is identical still both get the diagram.
    renderMermaidPreview("mermaid", "pie\n title A", shared);

    await settle();
    expect(a).toHaveBeenCalledWith('<svg data-code="pie\n title A"></svg>');
    expect(shared).toHaveBeenCalledWith('<svg data-code="pie\n title A"></svg>');
    expect(b).toHaveBeenCalledWith('<svg data-code="gantt\n title B"></svg>');
  });
});
