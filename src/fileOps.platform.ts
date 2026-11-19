/**
 * Platform-aware file operations: the module the app imports. Loads the Tauri or browser
 * implementation of the FileOps seam (see fileOps.types.ts) by dynamic import, so neither
 * build pulls the other platform's code.
 */
import { isTauri } from "./platform";
import type { FileOps, FileResult, OpenedFiles, UnsavedChoice } from "./fileOps.types";
export type { FileResult, OpenedFiles, SkippedFile, UnsavedChoice } from "./fileOps.types";
export { basename } from "./fileOps.types";

let ops: FileOps | null = null;
let loading: Promise<FileOps> | null = null;

function getOps(): Promise<FileOps> {
  loading ??= (isTauri ? import("./fileOps") : import("./fileOps.browser")).then(
    (impl) => (ops = impl),
    (err: unknown) => {
      loading = null; // let the next call retry the chunk load
      throw err;
    },
  );
  return loading;
}

// Loaded eagerly: filesFromDrop must reach the implementation synchronously during the drop event.
getOps().catch((err: unknown) => console.error("File operations failed to load:", err));

export async function openFiles(): Promise<OpenedFiles> {
  return (await getOps()).openFiles();
}

/** Single-file open used by App.tsx; goes away with the App integration of openFiles. */
export async function openFile(): Promise<FileResult | null> {
  const { files, skipped } = await openFiles();
  if (files.length > 0) return files[0];
  if (skipped.length > 0) throw new Error(`Cannot open "${skipped[0].name}": ${skipped[0].reason}`);
  return null;
}

export async function readFile(path: string): Promise<FileResult> {
  return (await getOps()).readFile(path);
}

export async function readIfPermitted(path: string): Promise<string | null> {
  return (await getOps()).readIfPermitted(path);
}

export async function saveFile(path: string, content: string): Promise<boolean> {
  return (await getOps()).saveFile(path, content);
}

export async function saveFileAs(content: string, defaultName?: string): Promise<string | null> {
  return (await getOps()).saveFileAs(content, defaultName);
}

export async function confirmUnsaved(filename: string): Promise<UnsavedChoice> {
  return (await getOps()).confirmUnsaved(filename);
}

/** Call synchronously from the drop handler; rejects if the implementation had not loaded yet. */
export function filesFromDrop(data: DataTransfer): Promise<OpenedFiles> {
  if (ops) return ops.filesFromDrop(data);
  // This drop's data is unreadable by the time a load finishes; (re)start it so the next drop works.
  return getOps().then(() => {
    throw new Error("MDE was still loading. Drop the files again.");
  });
}

export function onLaunchFiles(cb: (batch: OpenedFiles) => void): void {
  getOps().then(
    (impl) => impl.onLaunchFiles(cb),
    (err: unknown) => console.error("Launch file handling unavailable:", err),
  );
}

export async function canSaveInPlace(path: string): Promise<boolean> {
  return (await getOps()).canSaveInPlace(path);
}
