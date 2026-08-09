import { describe, it, expect, vi, beforeEach } from "vitest";
import { MilkdownManager } from "../MilkdownManager";

/**
 * Fake Crepe that mimics the one behavior under test: Milkdown re-serializes
 * markdown in its own style ("+ " bullets become "* ", "1)" becomes "1."), and
 * fires markdownUpdated for programmatic replaces exactly like for user edits.
 */
const h = vi.hoisted(() => {
  const normalize = (md: string): string =>
    md.replace(/^\+ /gm, "* ").replace(/^(\d+)\) /gm, "$1. ");

  type Listener = (ctx: unknown, markdown: string, prev: string) => void;

  class FakeCrepe {
    markdown: string;
    private listeners: Listener[] = [];
    editor = { action: (fn: (crepe: FakeCrepe) => void) => fn(this) };

    constructor(opts: { defaultValue: string }) {
      this.markdown = normalize(opts.defaultValue);
      instances.push(this);
    }
    on(cb: (l: { markdownUpdated: (fn: Listener) => void }) => void) {
      cb({ markdownUpdated: (fn) => this.listeners.push(fn) });
    }
    async create() {}
    getMarkdown() { return this.markdown; }
    destroy() {}
    /** Simulate a doc transaction settling on `newMarkdown`. */
    fire(newMarkdown: string) {
      const prev = this.markdown;
      this.markdown = newMarkdown;
      for (const l of this.listeners) l({}, newMarkdown, prev);
    }
  }

  const instances: FakeCrepe[] = [];
  return { normalize, FakeCrepe, instances };
});

vi.mock("@milkdown/crepe", () => ({
  Crepe: h.FakeCrepe,
  CrepeFeature: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock("@milkdown/utils", () => ({
  replaceAll: (md: string) => (crepe: InstanceType<typeof h.FakeCrepe>) =>
    crepe.fire(h.normalize(md)),
}));
vi.mock("@milkdown/crepe/theme/common/style.css", () => ({}));
vi.mock("@milkdown/crepe/theme/frame-dark.css", () => ({}));
vi.mock("../../milkdown-dark.css", () => ({}));

const DOC = "# Doc\n\n+ plus bullet\n\n1) first\n";

async function makeManager(): Promise<{ mgr: MilkdownManager; onChange: ReturnType<typeof vi.fn> }> {
  const mgr = new MilkdownManager();
  mgr.attach(document.createElement("div"));
  const onChange = vi.fn();
  mgr.setOnChange(onChange);
  return { mgr, onChange };
}

beforeEach(() => {
  h.instances.length = 0;
  // Deterministic suppression release: run rAF callbacks synchronously.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
});

describe("MilkdownManager normalization vs user edits", () => {
  it("creating an editor never reports a change or rewrites content", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", DOC);

    expect(onChange).not.toHaveBeenCalled();
    expect(mgr.getContentForRawSync("t1")).toBe(DOC);
  });

  it("replacing content programmatically (file opened into existing editor) is not a user edit", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", "");
    await mgr.setContent("t1", DOC);

    expect(onChange).not.toHaveBeenCalled();
    // Raw sync must return the document verbatim, not Milkdown's serialization.
    expect(mgr.getContentForRawSync("t1")).toBe(DOC);
  });

  it("a late normalization pass after creation does not mark the document edited", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", DOC);

    // Fires after the suppression window closed (rAF already ran).
    h.instances[0].fire(h.normalize(DOC));

    expect(mgr.getContentForRawSync("t1")).toBe(DOC);
    // Any propagated change must carry the pristine content, never the normalized form.
    for (const call of onChange.mock.calls) expect(call).toEqual(["t1", DOC]);
  });

  it("real user edits propagate and sync back to raw", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", DOC);

    const edited = h.normalize(DOC) + "\nnew line\n";
    h.instances[0].fire(edited);

    expect(onChange).toHaveBeenLastCalledWith("t1", edited);
    expect(mgr.getContentForRawSync("t1")).toBe(edited);
  });

  it("undoing back to the original restores pristine content", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", DOC);

    h.instances[0].fire(h.normalize(DOC) + "\nnew line\n");
    h.instances[0].fire(h.normalize(DOC)); // undo → doc matches as-loaded state

    expect(onChange).toHaveBeenLastCalledWith("t1", DOC);
    expect(mgr.getContentForRawSync("t1")).toBe(DOC);
  });
});

/**
 * Clicking a task checkbox in visual mode is a ProseMirror transaction like any
 * other: it reaches MilkdownManager as a markdownUpdated event whose only delta
 * is `[ ]` → `[x]`. The normalizedOriginal baseline must NOT absorb it, or the
 * tab would stay clean and raw mode would never see the toggle.
 */
describe("MilkdownManager checkbox toggles", () => {
  const TASKS = "# Todo\n\n* [ ] first\n* [x] second\n";

  it("checking a box propagates as a user edit and syncs back to raw", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", TASKS);
    expect(onChange).not.toHaveBeenCalled();

    const checked = TASKS.replace("* [ ] first", "* [x] first");
    h.instances[0].fire(checked);

    expect(onChange).toHaveBeenLastCalledWith("t1", checked);
    expect(mgr.getContentForRawSync("t1")).toBe(checked);
  });

  it("unchecking a box that was checked on load is also a user edit", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", TASKS);

    const unchecked = TASKS.replace("* [x] second", "* [ ] second");
    h.instances[0].fire(unchecked);

    expect(onChange).toHaveBeenLastCalledWith("t1", unchecked);
    expect(mgr.getContentForRawSync("t1")).toBe(unchecked);
  });

  it("toggling a box back restores the pristine document, not a dirty tab", async () => {
    const { mgr, onChange } = await makeManager();
    await mgr.activate("t1", TASKS);

    h.instances[0].fire(TASKS.replace("* [ ] first", "* [x] first"));
    h.instances[0].fire(TASKS); // clicked it again

    expect(onChange).toHaveBeenLastCalledWith("t1", TASKS);
    expect(mgr.getContentForRawSync("t1")).toBe(TASKS);
  });
});
