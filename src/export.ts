import { marked } from "marked";

/** Convert markdown to HTML string. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

/** Copy HTML to clipboard. */
export async function copyHtml(markdown: string): Promise<void> {
  const html = markdownToHtml(markdown);
  await navigator.clipboard.writeText(html);
}

/** Export HTML as a file download (browser) or save dialog (Tauri). */
export async function exportHtml(markdown: string, filename: string): Promise<void> {
  const html = wrapHtml(markdownToHtml(markdown), filename);
  const htmlFilename = filename.replace(/\.(md|markdown|mdx|txt)$/i, "") + ".html";

  const { isTauri } = await import("./platform");

  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      filters: [{ name: "HTML", extensions: ["html"] }],
      defaultPath: htmlFilename,
    });
    if (path) {
      await writeTextFile(path, html);
    }
  } else {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = htmlFilename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** Wrap HTML content in a minimal standalone document. */
function wrapHtml(body: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1f2328; }
  pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-size: 85%; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #d0d7de; margin: 0; padding: 0 1rem; color: #656d76; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
