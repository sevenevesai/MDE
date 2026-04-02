import type { FileResult } from "./fileOps.types";

export { type FileResult } from "./fileOps.types";
export { basename } from "./fileOps.types";

const MD_ACCEPT: Record<string, string[]> = {
  "text/markdown": [".md", ".markdown", ".mdx"],
  "text/plain": [".txt"],
};

// Store file handles so Save can write back to the same file
const handleMap = new Map<string, FileSystemFileHandle>();

/** Open a file via File System Access API or <input> fallback */
export async function openFile(): Promise<FileResult | null> {
  // Try modern File System Access API (Chrome/Edge)
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: "Markdown", accept: MD_ACCEPT }],
        multiple: false,
      });
      const file: File = await handle.getFile();
      const content = await file.text();
      const path = file.name;
      handleMap.set(path, handle);
      return { path, content, name: file.name };
    } catch {
      return null; // User cancelled
    }
  }

  // Fallback: <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdx,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const content = await file.text();
      resolve({ path: file.name, content, name: file.name });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Save content to a known file handle */
export async function saveFile(path: string, content: string): Promise<boolean> {
  const handle = handleMap.get(path);
  if (handle) {
    try {
      const writable = await (handle as any).createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }
  // No handle — trigger download as fallback
  downloadFile(path, content);
  return true;
}

/** Show a save-as dialog or download */
export async function saveFileAs(content: string, defaultName?: string): Promise<string | null> {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: defaultName ?? "untitled.md",
        types: [{ description: "Markdown", accept: MD_ACCEPT }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      const name = handle.name;
      handleMap.set(name, handle);
      return name;
    } catch {
      return null; // User cancelled
    }
  }

  // Fallback: download
  const name = defaultName ?? "untitled.md";
  downloadFile(name, content);
  return name;
}

/** Ask user about unsaved changes via confirm() */
export async function confirmUnsaved(filename: string): Promise<"save" | "discard"> {
  const result = window.confirm(
    `"${filename}" has unsaved changes. Click OK to save, or Cancel to discard.`
  );
  return result ? "save" : "discard";
}

/** Helper: trigger a file download */
function downloadFile(name: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
