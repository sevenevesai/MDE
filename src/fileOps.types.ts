/** Shared types and utilities for file operations. */

export interface FileResult {
  readonly path: string;
  readonly content: string;
  readonly name: string;
}

/** A file a batch operation did not load. `reason` is user-presentable without the name, e.g. "not a text file". */
export interface SkippedFile {
  readonly name: string;
  readonly reason: string;
}

/**
 * Result of the multi-file operations (openFiles, filesFromDrop, onLaunchFiles). A binary or
 * unreadable file never aborts the batch: it lands in `skipped` for the caller to report.
 * A cancelled picker yields both lists empty.
 */
export interface OpenedFiles {
  readonly files: readonly FileResult[];
  readonly skipped: readonly SkippedFile[];
}

export type UnsavedChoice = "save" | "discard" | "cancel";

/**
 * The platform seam. src/fileOps.ts (Tauri) and src/fileOps.browser.ts implement it;
 * src/fileOps.platform.ts loads one of them lazily and is what the app imports.
 *
 * Paths: Tauri uses real filesystem paths. The browser uses the bare file name, or
 * `(n)/name` when a different file with that name is already known; basename() of
 * either form is the real file name.
 */
export interface FileOps {
  /** Multi-select picker; Markdown and text types listed first, any file selectable. */
  openFiles(): Promise<OpenedFiles>;
  /**
   * Re-reads a known path. Browser: may show a permission prompt, so call it from a user
   * gesture. Throws an Error with a user-presentable message when the file is gone, access is
   * denied, the browser holds no handle for the path, or the file is not text.
   */
  readFile(path: string): Promise<FileResult>;
  /** Disk content without any prompt; null when unavailable for any reason. Never throws. */
  readIfPermitted(path: string): Promise<string | null>;
  /**
   * false when the write failed or write permission was denied (the cause goes to the console).
   * Browser: a path with no file handle is downloaded instead and resolves true.
   */
  saveFile(path: string, content: string): Promise<boolean>;
  /** The chosen path, or null when cancelled. Browser without a save picker: downloads and returns the name. Throws when the write fails. */
  saveFileAs(content: string, defaultName?: string): Promise<string | null>;
  /** Esc / closing the dialog resolve to "cancel", never "discard". */
  confirmUnsaved(filename: string): Promise<UnsavedChoice>;
  /**
   * Files from a drop event. Call it synchronously inside the drop handler: browser drop data
   * is only readable while the event is dispatching. Tauri resolves empty (its own drag-drop
   * event carries paths).
   */
  filesFromDrop(data: DataTransfer): Promise<OpenedFiles>;
  /** Browser: files the OS launched the installed app with (manifest file_handlers), once per launch. Tauri: no-op. */
  onLaunchFiles(cb: (batch: OpenedFiles) => void): void;
  /**
   * Async on both platforms. true when saveFile writes the real file rather than downloading
   * (Tauri: always). A browser handle can still be refused write permission at save time.
   */
  canSaveInPlace(path: string): Promise<boolean>;
}

export const MARKDOWN_EXTENSIONS: readonly string[] = ["md", "markdown", "mdx"];
export const TEXT_EXTENSIONS: readonly string[] = [
  "txt", "text", "log", "json", "yaml", "yml", "toml", "xml", "csv", "ini", "cfg", "conf",
];

/** How much of a file's head the binary check inspects. */
export const SNIFF_LENGTH = 8192;

/**
 * True when the head of decoded file text contains a NUL. A NUL byte decodes to U+0000 and
 * each byte yields at most one UTF-16 unit, so the first SNIFF_LENGTH units cover at least the
 * first SNIFF_LENGTH bytes. UTF-16 files count as binary: they are not readable as UTF-8 anyway.
 */
export function looksBinary(text: string): boolean {
  return text.slice(0, SNIFF_LENGTH).includes("\0");
}

/** Thrown by the per-file loaders for binary content; its message doubles as a SkippedFile reason. */
export class NotTextError extends Error {
  constructor() {
    super("not a text file");
    this.name = "NotTextError";
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** SkippedFile.reason for a failed load. */
export function skipReason(err: unknown): string {
  return err instanceof NotTextError ? err.message : `could not be read (${errorMessage(err)})`;
}

/** Extract filename from a full path */
export function basename(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}
