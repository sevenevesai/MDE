import { open, save, message } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  basename,
  errorMessage,
  looksBinary,
  MARKDOWN_EXTENSIONS,
  NotTextError,
  skipReason,
  TEXT_EXTENSIONS,
  type FileResult,
  type OpenedFiles,
  type SkippedFile,
  type UnsavedChoice,
} from "./fileOps.types";

const FILTERS = [
  { name: "Markdown and text", extensions: [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS] },
  { name: "All Files", extensions: ["*"] },
];

/** readTextFile decodes with a default TextDecoder, which drops a leading UTF-8 BOM. */
async function readText(path: string): Promise<string> {
  const content = await readTextFile(path);
  if (looksBinary(content)) throw new NotTextError();
  return content;
}

export async function openFiles(): Promise<OpenedFiles> {
  const selected = await open({ multiple: true, filters: FILTERS });
  if (!selected) return { files: [], skipped: [] };

  const files: FileResult[] = [];
  const skipped: SkippedFile[] = [];
  for (const path of selected) {
    const name = basename(path);
    try {
      files.push({ path, name, content: await readText(path) });
    } catch (err) {
      skipped.push({ name, reason: skipReason(err) });
    }
  }
  return { files, skipped };
}

export async function readFile(path: string): Promise<FileResult> {
  const name = basename(path);
  try {
    return { path, name, content: await readText(path) };
  } catch (err) {
    throw new Error(`Cannot open "${name}": ${skipReason(err)}`);
  }
}

export async function readIfPermitted(path: string): Promise<string | null> {
  try {
    return await readText(path);
  } catch {
    return null; // missing, unreadable or binary: "unavailable" is the documented null
  }
}

export async function saveFile(path: string, content: string): Promise<boolean> {
  try {
    await writeTextFile(path, content);
    return true;
  } catch (err) {
    console.error(`Failed to save ${path}: ${errorMessage(err)}`);
    return false;
  }
}

export async function saveFileAs(content: string, defaultName?: string): Promise<string | null> {
  const path = await save({ filters: FILTERS, defaultPath: defaultName });
  if (!path) return null;
  await writeTextFile(path, content);
  return path;
}

/** Ask user about unsaved changes. Esc / the window X resolve to "cancel", never "discard". */
export async function confirmUnsaved(filename: string): Promise<UnsavedChoice> {
  const result = await message(
    `"${filename}" has unsaved changes. Do you want to save before closing?`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
    }
  );

  if (result === "Save" || result === "Yes") return "save";
  if (result === "Don't Save" || result === "No") return "discard";
  return "cancel";
}

/** Tauri delivers OS drops as paths through its own drag-drop event, not DataTransfer. */
export async function filesFromDrop(_data: DataTransfer): Promise<OpenedFiles> {
  return { files: [], skipped: [] };
}

/** Desktop launches arrive through the single-instance "open-files" event instead. */
export function onLaunchFiles(_cb: (batch: OpenedFiles) => void): void {}

export async function canSaveInPlace(_path: string): Promise<boolean> {
  return true;
}
