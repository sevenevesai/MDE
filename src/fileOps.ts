import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface FileResult {
  path: string;
  content: string;
  name: string;
}

const MD_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
  { name: "All Files", extensions: ["*"] },
];

/** Extract filename from a full path */
export function basename(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

/** Open a file dialog and read the selected file */
export async function openFile(): Promise<FileResult | null> {
  const selected = await open({
    multiple: false,
    filters: MD_FILTERS,
  });

  if (!selected) return null;

  const path = selected as string;
  const content = await readTextFile(path);
  return { path, content, name: basename(path) };
}

/** Save content to a known path */
export async function saveFile(path: string, content: string): Promise<boolean> {
  try {
    await writeTextFile(path, content);
    return true;
  } catch {
    return false;
  }
}

/** Show a save-as dialog and write to the chosen path */
export async function saveFileAs(content: string, defaultName?: string): Promise<string | null> {
  const path = await save({
    filters: MD_FILTERS,
    defaultPath: defaultName,
  });

  if (!path) return null;

  await writeTextFile(path, content);
  return path;
}

/** Ask user about unsaved changes. Returns "save" | "discard" | "cancel" */
export async function confirmUnsaved(filename: string): Promise<"save" | "discard" | "cancel"> {
  const result = await ask(
    `"${filename}" has unsaved changes. Do you want to save before closing?`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      okLabel: "Save",
      cancelLabel: "Don't Save",
    }
  );

  // ask() returns true (OK/Save) or false (Cancel/Don't Save)
  return result ? "save" : "discard";
}
