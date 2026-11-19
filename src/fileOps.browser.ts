import { handleFor, rememberHandle, rememberUnlinked } from "./browserHandles";
import {
  basename,
  errorMessage,
  looksBinary,
  MARKDOWN_EXTENSIONS,
  NotTextError,
  skipReason,
  SNIFF_LENGTH,
  TEXT_EXTENSIONS,
  type FileResult,
  type OpenedFiles,
  type SkippedFile,
  type UnsavedChoice,
} from "./fileOps.types";

// Minimal declarations for the parts of the File System Access, permission and
// File Handling APIs that lib.dom does not ship (Chromium-only today).
interface FilePickerType {
  readonly description: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}
interface LaunchParams {
  readonly files: readonly FileSystemHandle[];
}
interface FsAccessWindow {
  showOpenFilePicker?(options: { multiple?: boolean; types?: readonly FilePickerType[] }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options: { suggestedName?: string; types?: readonly FilePickerType[] }): Promise<FileSystemFileHandle>;
  launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
}
type AccessMode = "read" | "readwrite";
interface PermissionHandle {
  queryPermission?(descriptor: { mode: AccessMode }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: AccessMode }): Promise<PermissionState>;
}
interface HandleDataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

const fsWindow: Window & FsAccessWindow = window;

/**
 * Chromium's File System Access API. Without it (Firefox, Safari) files are plain copies:
 * bare-name paths, no re-reading, saves download.
 */
const hasHandles = typeof fsWindow.showOpenFilePicker === "function";

const dotted = (exts: readonly string[]): string[] => exts.map((e) => `.${e}`);
const PICKER_TYPES: readonly FilePickerType[] = [
  {
    description: "Markdown and text",
    accept: { "text/markdown": dotted(MARKDOWN_EXTENSIONS), "text/plain": dotted(TEXT_EXTENSIONS) },
  },
];

const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle => handle.kind === "file";

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function reasonFor(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotFoundError") return "it no longer exists on disk";
  return skipReason(err);
}

/** File.text() decodes UTF-8 and drops a leading BOM. The head is sniffed first so a large binary is never read whole. */
async function readText(file: File): Promise<string> {
  if (looksBinary(await file.slice(0, SNIFF_LENGTH).text())) throw new NotTextError();
  return file.text();
}

/** Permission state for `mode`, prompting only when `prompt` (prompts need a user gesture). */
async function permission(handle: FileSystemFileHandle, mode: AccessMode, prompt: boolean): Promise<PermissionState> {
  const h: FileSystemFileHandle & PermissionHandle = handle;
  // Engines without the permission methods gate each operation instead; those errors surface there.
  if (!h.queryPermission) return "granted";
  const state = await h.queryPermission({ mode });
  if (state === "granted" || !prompt || !h.requestPermission) return state;
  return h.requestPermission({ mode });
}

async function writeHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const stream = await handle.createWritable();
  try {
    await stream.write(content);
    await stream.close();
  } catch (err) {
    // Aborting discards the swap file so the original stays intact; the write error is what matters.
    await stream.abort().catch(() => undefined);
    throw err;
  }
}

async function loadHandles(handles: readonly FileSystemHandle[]): Promise<OpenedFiles> {
  const files: FileResult[] = [];
  const skipped: SkippedFile[] = [];
  for (const handle of handles) {
    if (!isFileHandle(handle)) {
      skipped.push({ name: handle.name, reason: "folders cannot be opened" });
      continue;
    }
    try {
      const content = await readText(await handle.getFile());
      files.push({ path: await rememberHandle(handle), name: handle.name, content });
    } catch (err) {
      skipped.push({ name: handle.name, reason: reasonFor(err) });
    }
  }
  return { files, skipped };
}

/** Files without a handle; where handles exist they still get a reserved path so no handle-backed file claims it later. */
async function loadCopies(copies: readonly File[]): Promise<OpenedFiles> {
  const files: FileResult[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of copies) {
    try {
      const content = await readText(file);
      const path = hasHandles ? await rememberUnlinked(file.name) : file.name;
      files.push({ path, name: file.name, content });
    } catch (err) {
      skipped.push({ name: file.name, reason: reasonFor(err) });
    }
  }
  return { files, skipped };
}

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function openFiles(): Promise<OpenedFiles> {
  if (!fsWindow.showOpenFilePicker) return loadCopies(await pickWithInput());
  let handles: FileSystemFileHandle[];
  try {
    handles = await fsWindow.showOpenFilePicker({ multiple: true, types: PICKER_TYPES });
  } catch (err) {
    if (isAbort(err)) return { files: [], skipped: [] };
    throw err;
  }
  return loadHandles(handles);
}

export async function readFile(path: string): Promise<FileResult> {
  const name = basename(path);
  if (!hasHandles) throw new Error(`This browser cannot re-read "${name}" from disk. Open it again.`);
  const handle = await handleFor(path);
  if (!handle) throw new Error(`"${name}" is no longer linked to a file on disk. Open it again.`);

  let state: PermissionState;
  try {
    state = await permission(handle, "read", true);
  } catch (err) {
    throw new Error(`Cannot ask for permission to read "${name}": ${errorMessage(err)}`);
  }
  if (state !== "granted") throw new Error(`Permission to read "${name}" was denied.`);

  try {
    return { path, name, content: await readText(await handle.getFile()) };
  } catch (err) {
    throw new Error(`Cannot open "${name}": ${reasonFor(err)}`);
  }
}

export async function readIfPermitted(path: string): Promise<string | null> {
  if (!hasHandles) return null;
  try {
    const handle = await handleFor(path);
    if (!handle || (await permission(handle, "read", false)) !== "granted") return null;
    return await readText(await handle.getFile());
  } catch {
    return null; // gone, unreadable or binary: "unavailable" is the documented null
  }
}

export async function saveFile(path: string, content: string): Promise<boolean> {
  try {
    const handle = hasHandles ? await handleFor(path) : null;
    if (!handle) {
      downloadFile(basename(path), content);
      return true;
    }
    if ((await permission(handle, "readwrite", true)) !== "granted") {
      console.warn(`Write permission for "${path}" was denied`);
      return false;
    }
    await writeHandle(handle, content);
    return true;
  } catch (err) {
    console.error(`Failed to save "${path}": ${errorMessage(err)}`);
    return false;
  }
}

export async function saveFileAs(content: string, defaultName?: string): Promise<string | null> {
  const suggestedName = defaultName ?? "untitled.md";
  if (!fsWindow.showSaveFilePicker) {
    downloadFile(suggestedName, content);
    return suggestedName;
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await fsWindow.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
  await writeHandle(handle, content);
  return rememberHandle(handle);
}

/**
 * Ask user about unsaved changes via confirm(). The browser has no three-button
 * dialog, so two prompts: Cancel on the first is a real cancel, not a discard.
 */
export async function confirmUnsaved(filename: string): Promise<UnsavedChoice> {
  if (window.confirm(`"${filename}" has unsaved changes. Click OK to save, or Cancel for more options.`)) {
    return "save";
  }
  return window.confirm(`Discard unsaved changes to "${filename}"? Click Cancel to keep the tab open.`)
    ? "discard"
    : "cancel";
}

export async function filesFromDrop(data: DataTransfer): Promise<OpenedFiles> {
  // Drop data is readable only while the event dispatches: take every handle and File before the first await.
  const items = Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => ({
      file: item.getAsFile(),
      handle: (hasHandles && (item as DataTransferItem & HandleDataTransferItem).getAsFileSystemHandle?.()) || Promise.resolve(null),
    }));

  const handles: FileSystemHandle[] = [];
  const copies: File[] = [];
  for (const { file, handle } of items) {
    // A failed handle lookup falls back to the File copy below, which still opens and saves by download.
    const h = await handle.catch(() => null);
    if (h) handles.push(h);
    else if (file) copies.push(file);
  }
  const [linked, unlinked] = await Promise.all([loadHandles(handles), loadCopies(copies)]);
  return { files: [...linked.files, ...unlinked.files], skipped: [...linked.skipped, ...unlinked.skipped] };
}

export function onLaunchFiles(cb: (batch: OpenedFiles) => void): void {
  fsWindow.launchQueue?.setConsumer((params) => {
    if (params.files.length === 0) return;
    loadHandles(params.files).then(cb, (err: unknown) => {
      console.error(`Could not open launched files: ${errorMessage(err)}`);
    });
  });
}

export async function canSaveInPlace(path: string): Promise<boolean> {
  return hasHandles && (await handleFor(path)) !== null;
}

/** Helper: trigger a file download */
function downloadFile(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
