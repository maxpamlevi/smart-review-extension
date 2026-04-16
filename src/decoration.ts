import * as vscode from "vscode";
import { mapRightLine } from "./diffParser";

/**
 * Apply multiline bubble decorations to the RIGHT editor.
 * Bubble format (A2):
 *
 * 💬 Comment
 * 💡 Suggestion
 * 🛠 Before → After
 */
export const reviewDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    margin: "0 0 0 12px",
    color: "#ffffff",
    backgroundColor: "#007acc",
    border: "1px solid #005FCC",
  },
});

export function applyReviewDecorations(
  editor: vscode.TextEditor,
  comments: any[],
  diff: string,
) {

  const ranges: vscode.DecorationOptions[] = [];

  for (const c of comments) {
    const mappedLine = mapRightLine(diff, c.line);
    const pos = new vscode.Position(mappedLine, Number.MAX_SAFE_INTEGER);

    // Compact inline bubble: clean summary only (no \n, no escape)
    const summary = c.comment.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    const inlineText =
      "💬 " + summary.slice(0, 40) + (summary.length > 40 ? "…" : "");

    // Markdown tooltip (multi‑line, FIXED & CLEAN)
    const fullMd = new vscode.MarkdownString();

    fullMd.appendMarkdown(`**💬 Comment**\n${c.comment}\n\n`);
    fullMd.appendMarkdown(`**💡 Suggestion**\n${c.suggestion}\n\n`);
    fullMd.appendMarkdown(`**🛠 Fix**\n\n`);

    // SAFE code blocks — no indentation, no broken fences
    fullMd.appendMarkdown(`**Before:**\n\`\`\`\n${c.fix.before}\n\`\`\`\n\n`);
    fullMd.appendMarkdown(`**After:**\n\`\`\`\n${c.fix.after}\n\`\`\`\n\n`);
    fullMd.supportHtml = false;
    const encodedArgs = encodeURIComponent(
      JSON.stringify([
        editor.document.uri.toString(),
        c
      ])
    );
    const cmd = `[👉 Apply Fix](command:srv.applyFix?${encodedArgs})`;

    fullMd.appendMarkdown("\n\n" + cmd);
    fullMd.isTrusted = true;

    ranges.push({
      range: new vscode.Range(pos, pos),
      renderOptions: {
        after: { contentText: inlineText },
      },
      hoverMessage: fullMd,
    });
  }

  editor.setDecorations(reviewDecoration, ranges);
}
