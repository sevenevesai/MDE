/**
 * Platform-aware re-export of file operations.
 * Dynamically loads Tauri or browser implementations at runtime.
 */
import { isTauri } from "./platform";
import type { FileResult } from "./fileOps.types";
export type { FileResult } from "./fileOps.types";
export { basename } from "./fileOps.types";

type FileOps = {
  openFile: () => Promise<FileResult | null>;
  saveFile: (path: string, content: string) => Promise<boolean>;
  saveFileAs: (content: string, defaultName?: string) => Promise<string | null>;
  confirmUnsaved: (filename: string) => Promise<"save" | "discard">;
};

let _ops: FileOps | null = null;

async function getOps(): Promise<FileOps> {
  if (_ops) return _ops;
  if (isTauri) {
    _ops = await import("./fileOps");
  } else {
    _ops = await import("./fileOps.browser");
  }
  return _ops;
}

export async function openFile(): Promise<FileResult | null> {
  return (await getOps()).openFile();
}

export async function saveFile(path: string, content: string): Promise<boolean> {
  return (await getOps()).saveFile(path, content);
}

export async function saveFileAs(content: string, defaultName?: string): Promise<string | null> {
  return (await getOps()).saveFileAs(content, defaultName);
}

export async function confirmUnsaved(filename: string): Promise<"save" | "discard"> {
  return (await getOps()).confirmUnsaved(filename);
}
