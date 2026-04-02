/** Shared types and utilities for file operations. */

export interface FileResult {
  path: string;
  content: string;
  name: string;
}

/** Extract filename from a full path */
export function basename(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}
