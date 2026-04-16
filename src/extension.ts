// The module 'vscode' contains the VS Code extensibility API
import * as vscode from "vscode";
import * as path from "path";
import OpenAI from "openai";
import { AiFixCodeLensProvider } from "./codelens";
import { applyReviewDecorations } from "./decoration";
import { CommentSidebarProvider } from "./sidebar";

let isReviewRunning = false;
let refreshTimer: NodeJS.Timeout | null = null;
const openingDiffFiles = new Set<string>();
const DEFAULT_SYSTEM_PROMPT = `You are an AI code reviewer. Return ONLY valid JSON.

Schema:
{ "comments": [ { "line": number, "type": "warning" | "error" | "info", "comment": string, "suggestion": string, "fix": { "operation": "insert" | "replace" | "delete", "range": { "start": { "line": number, "character": number }, "end": { "line": number, "character": number } }, "before": string, "after": string } } ] }

Rules:
- Return only JSON, no markdown or code fences.
- If no issue is found, return exactly {"comments":[]}.
- "before" must be a real snippet from the post-diff file and uniquely identify the replacement.
- Keep fixes atomic and compile-safe; include all affected usages in "before".
- The extension ignores range, but keep it present for schema compatibility.

`;

function findModifiedEditor(filePath: string): vscode.TextEditor | undefined {
  const matches = vscode.window.visibleTextEditors.filter(
    (editor) => editor.document.fileName === filePath,
  );

  return (
    matches.find((editor) => editor.document.uri.scheme === "file") ??
    matches.find((editor) => editor.viewColumn === vscode.ViewColumn.Two) ??
    matches[0]
  );
}

type ChangedFileEntry =
  | { kind: "loading" }
  | { kind: "file"; filePath: string };

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  class ChangedFilesProvider implements vscode.TreeDataProvider<ChangedFileEntry> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
      ChangedFileEntry | undefined | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private files: string[] = [];
    private isLoading = false;
    private loadTask: Promise<void> | null = null;
    private hasLoadedOnce = false;
    private view: vscode.TreeView<ChangedFileEntry> | null = null;

    bindView(view: vscode.TreeView<ChangedFileEntry>): void {
      this.view = view;
    }

    constructor() {
      void this.reload();
    }

    refresh(): void {
      void this.reload();
    }

    private async reload(): Promise<void> {
      if (this.loadTask) {
        return this.loadTask;
      }

      const isFirstLoad = !this.hasLoadedOnce;
      this.isLoading = isFirstLoad;
      if (this.view) {
        this.view.message = isFirstLoad
          ? "Đang tải danh sách file thay đổi..."
          : "Đang cập nhật danh sách file thay đổi...";
      }

      if (isFirstLoad) {
        this._onDidChangeTreeData.fire();
      }

      this.loadTask = (async () => {
        try {
          this.files = await this.fetchChangedFiles();
          this.hasLoadedOnce = true;
        } finally {
          this.isLoading = false;
          this.loadTask = null;
          if (this.view) {
            this.view.message = undefined;
          }
          this._onDidChangeTreeData.fire();
        }
      })();

      return this.loadTask;
    }

    private async fetchChangedFiles(): Promise<string[]> {
      if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders.length === 0
      ) {
        vscode.window.showErrorMessage("Không tìm thấy thư mục workspace nào.");
        return [];
      }

      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const exec = require("child_process").exec;

      const output: string = await new Promise((resolve) => {
        exec(
          "git status --porcelain",
          { cwd: root },
          (_err: any, stdout: string) => {
            resolve(stdout || "");
          },
        );
      });

      if (!output.trim()) return [];

      const lines = output.split("\n").filter((l: string) => l.trim() !== "");

      // Each line format example:
      // " M src/app.ts"
      // "D  src/remove.ts"
      // "?? newfile.ts"
      return lines.map((line: string) => line.substring(3).trim());
    }

    getChildren(): ChangedFileEntry[] {
      const items: ChangedFileEntry[] = this.files.map((filePath) => ({
        kind: "file",
        filePath,
      }));

      // Only show the loading placeholder before the first result arrives.
      // During later refreshes we keep the last list visible and clickable.
      if (this.isLoading && items.length === 0) {
        return [{ kind: "loading" }];
      }

      return items;
    }

    getTreeItem(element: ChangedFileEntry): vscode.TreeItem {
      if (element.kind === "loading") {
        const item = new vscode.TreeItem("Đang tải danh sách file thay đổi...");
        item.iconPath = new vscode.ThemeIcon("loading~spin");
        item.tooltip = "Đang đọc trạng thái Git...";
        item.contextValue = "srvLoading";
        return item;
      }

      const item = new vscode.TreeItem(element.filePath);
      item.command = {
        command: "srv.openDiff",
        title: "Open Diff",
        arguments: [element.filePath],
      };
      item.iconPath = new vscode.ThemeIcon("diff");
      return item;
    }
  }
  try {
    const sidebarProvider = new CommentSidebarProvider();
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("srvComments", sidebarProvider),
    );

    const provider = new ChangedFilesProvider();
    const srvView = vscode.window.createTreeView("srvPanel", {
      treeDataProvider: provider,
    });
    provider.bindView(srvView);
    context.subscriptions.push(srvView);
    context.subscriptions.push(
      vscode.commands.registerCommand("srv.jumpToComment", async (comment) => {
        // Always open the REAL file and restore decorations
        const uri = vscode.Uri.file(comment.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, {
          preview: false,
        });

        // Jump to the comment line
        const pos = new vscode.Position(comment.line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter,
        );

        // Re-apply decorations — chỉ load comment của file đang mở
        try {
          const allComments = sidebarProvider.comments ?? [];
          const fileComments = allComments.filter(
            (c: any) => c.file === comment.file,
          );

          applyReviewDecorations(editor, fileComments, "");
        } catch (e) {
          console.error("Decoration restore error:", e);
        }
      }),
    );

    // ------------------------------
    // Tree Provider: Changed Files
    // ------------------------------

    // Auto-refresh when user opens SRV panel
    context.subscriptions.push(
      srvView.onDidChangeVisibility((e) => {
        if (e.visible) {
          provider.refresh();
        }
      }),
    );

    // Auto-refresh when any file changes (debounced 500ms)
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(() => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          provider.refresh();
        }, 500);
      }),
    );

    // Refresh command
    context.subscriptions.push(
      vscode.commands.registerCommand("srv.refreshChangedFiles", () =>
        provider.refresh(),
      ),
    );

    // Command: Open Settings for this extension
    context.subscriptions.push(
      vscode.commands.registerCommand("srv.openSettings", async () => {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:Khang-Nd.srv",
        );
      }),
    );

    // Command: AI Review current file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "srv.reviewCode",
        async (sourceFilePath?: string) => {
          return vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "SRV",
              cancellable: false,
            },
            async (progress) => {
              progress.report({ message: "Đang chuẩn bị dữ liệu review…" });
              const targetFilePath =
                sourceFilePath ??
                vscode.window.activeTextEditor?.document.fileName;

              if (!targetFilePath) {
                vscode.window.showErrorMessage(
                  "Không có file nào đang được mở.",
                );
                return;
              }

              const document = await vscode.workspace.openTextDocument(
                vscode.Uri.file(targetFilePath),
              );
              const filePath = document.fileName;

              const workspaceFolder =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (!workspaceFolder) {
                vscode.window.showErrorMessage(
                  "Không tìm thấy thư mục workspace.",
                );
                return;
              }

              // compute relative path for git
              const relativePath = path
                .relative(workspaceFolder, filePath)
                .replace(/\\/g, "/");

              const { execFile } = require("child_process");
              const runGit = (args: string[]) =>
                new Promise<{ stdout: string; error: any }>((resolve) => {
                  execFile(
                    "git",
                    args,
                    { cwd: workspaceFolder },
                    (error: any, stdout: string) => {
                      resolve({ error, stdout: stdout || "" });
                    },
                  );
                });

              // Fast path: skip the extra status call and use a smaller diff context.
              const trackedResult = await runGit([
                "ls-files",
                "--error-unmatch",
                relativePath,
              ]);

              const diffArgs = trackedResult.error
                ? [
                    "diff",
                    "--no-ext-diff",
                    "--no-color",
                    "-U5",
                    "--no-index",
                    "NUL",
                    relativePath,
                  ]
                : [
                    "diff",
                    "--no-ext-diff",
                    "--no-color",
                    "-U5",
                    "HEAD",
                    "--",
                    relativePath,
                  ];

              const diffResult = await runGit(diffArgs);
              const diff = diffResult.stdout;

              if (!diff.trim()) {
                vscode.window.showInformationMessage(
                  "Không tìm thấy thay đổi nào trong diff.",
                );
                return;
              }

              const config = vscode.workspace.getConfiguration("srv");
              const AZURE_URL = config.get<string>("aiReview.azureUrl")?.trim();
              const AZURE_KEY = config.get<string>("aiReview.azureKey")?.trim();
              const DEPLOYMENT_NAME = config
                .get<string>("aiReview.deploymentName")
                ?.trim();

              if (!AZURE_URL || !AZURE_KEY || !DEPLOYMENT_NAME) {
                vscode.window.showErrorMessage(
                  "Vui lòng cấu hình Azure AI trong phần Settings (@srv).",
                );
                return;
              }

              const client = new OpenAI({
                baseURL: AZURE_URL,
                apiKey: AZURE_KEY,
              });

              const systemPrompt =
                config.get<string>("aiReview.systemPrompt")?.trim() ||
                DEFAULT_SYSTEM_PROMPT;

              progress.report({ message: "Đang gửi yêu cầu review lên AI…" });
              const response = await client.chat.completions.create({
                model: DEPLOYMENT_NAME,
                messages: [
                  {
                    role: "system",
                    content: `${DEFAULT_SYSTEM_PROMPT} + ${systemPrompt}`,
                  },
                  {
                    role: "user",
                    content: `Review this diff and return JSON comments:\n\n${diff}`,
                  },
                ],
              });

              progress.report({ message: "Đang xử lý phản hồi từ AI…" });

              const comment_string =
                response?.choices?.[0]?.message?.content ?? "";

              let parsedJson: any = null;
              try {
                parsedJson = JSON.parse(comment_string || "{}");
              } catch (err) {
                console.error("JSON parse failed:", err);
                parsedJson = { comments: [] };
              }

              // -------------------------------
              // INLINE DECORATION: AUTO SHOW (NEW)
              try {
                const comments = parsedJson?.comments ?? [];

                // If AI found no issues → show OK message
                if (comments.length === 0) {
                  vscode.window.showInformationMessage(
                    "Đã kiểm tra xong, không phát hiện vấn đề nào.",
                  );
                }

                const rightEditor = findModifiedEditor(filePath);

                if (rightEditor && comments.length > 0) {
                  applyReviewDecorations(rightEditor, comments, diff);

                  // Attach file path so jumpToComment works
                  comments.forEach((c: any) => (c.file = filePath));

                  // Remove all existing comments belonging to this same file BEFORE appending new ones
                  const existing = sidebarProvider.comments ?? [];
                  const filtered = existing.filter(
                    (c: any) => c.file !== filePath,
                  );

                  // Append only new comments for this file
                  const merged = [...filtered, ...comments];

                  sidebarProvider.refreshReplace(merged);
                }
              } catch (err) {
                console.error("Decoration error:", err);
              }

              progress.report({ message: "Hoàn tất, đang hiển thị kết quả…" });

              vscode.window.showInformationMessage(
                "Hoàn tất! Kết quả đang được hiển thị.",
              );
            },
          );
        },
      ),
    );

    // Command: Open Diff between HEAD and working copy

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "srv.openDiff",
        async (relativeFile: string) => {
          const folders = vscode.workspace.workspaceFolders;
          if (!folders?.length) {
            vscode.window.showErrorMessage("Không tìm thấy thư mục workspace.");
            return;
          }

          // đảm bảo git extension active
          const gitExt = vscode.extensions.getExtension("vscode.git");
          if (gitExt && !gitExt.isActive) {
            await gitExt.activate();
          }

          const root = folders[0].uri.fsPath;
          const workingFile = vscode.Uri.file(path.join(root, relativeFile));
          const fileKey = workingFile.fsPath;

          // Prevent duplicate clicks from opening/reviewing the same file twice.
          if (openingDiffFiles.has(fileKey)) {
            return;
          }

          openingDiffFiles.add(fileKey);

          try {
            // ✅ OFFICIAL + BUG-FREE
            await vscode.commands.executeCommand("git.openChange", workingFile);

            // 🚫 If this file already has comments → DO NOT auto-review
            const existing = sidebarProvider.comments ?? [];
            const hasOld = existing.some((c: any) => c.file === fileKey);

            if (!hasOld) {
              // 🔥 AUTO-REVIEW ONLY IF NO OLD COMMENTS OF THIS FILE
              if (!isReviewRunning) {
                isReviewRunning = true;
                Promise.resolve(
                  vscode.commands.executeCommand("srv.reviewCode", fileKey),
                ).finally(() => {
                  isReviewRunning = false;
                });
              }
            } else {
              // 🟦 Re-render decorations using existing comments
              const comments = existing.filter((c: any) => c.file === fileKey);

              const rightEditor = findModifiedEditor(fileKey);

              if (rightEditor) {
                applyReviewDecorations(rightEditor, comments, "");
              }
            }
          } finally {
            openingDiffFiles.delete(fileKey);
          }
        },
      ),
    );

    // ------------------------------
    // CodeLens: Apply Fix integration
    // ------------------------------

    const aiFixProvider = new AiFixCodeLensProvider();
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider("*", aiFixProvider),
    );

    const syncCommentState = (comments: any[]) => {
      const nextComments = comments ?? [];
      sidebarProvider.refreshReplace(nextComments);
      aiFixProvider.updateComments(nextComments);
    };

    context.subscriptions.push(
      vscode.commands.registerCommand("srv.applyFix", async (uri, comment) => {
        if (typeof uri === "string") uri = vscode.Uri.parse(uri);

        // Read file WITHOUT opening editor → prevents diff view from closing
        const doc = await vscode.workspace.openTextDocument(uri);
        const { before, after, operation } = comment.fix;
        const fullText = doc.getText();

        // ── Normalize line endings ──────────────────────────────────────────
        const fileEol = fullText.includes("\r\n") ? "\r\n" : "\n";
        const normLf = (s: string) =>
          s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const toFileEol = (s: string) => normLf(s).replace(/\n/g, fileEol);
        // ───────────────────────────────────────────────────────────────────

        const rawBefore = before ?? "";
        const rawAfter = after ?? "";

        if (!rawBefore.trim()) {
          vscode.window.showErrorMessage("Mẫu neo (before) đang trống.");
          return;
        }

        // ── Helper: normalize a single line for fuzzy comparison ────────────
        const normLine = (l: string) => l.trim();

        // ── Helper: expand endIdx to cover the full statement ────────────────
        // When AI gives only a partial line as `before` (e.g. just the function
        // name without its argument block), the match ends mid-line and we must
        // expand to include the rest of the complete statement so we don't leave
        // orphaned code (like a dangling `({...});`) after the replacement.
        const expandToStatement = (
          text: string,
          startIdx: number,
          endIdx: number,
        ): number => {
          // Count unmatched opening delimiters inside the already-matched portion
          let depth = 0;
          for (let i = startIdx; i < endIdx; i++) {
            if ("({[".includes(text[i])) depth++;
            if (")}]".includes(text[i])) depth--;
          }

          const charAfter = text[endIdx];
          const atLineEnd =
            !charAfter || charAfter === "\n" || charAfter === "\r";

          // Only skip expansion when BOTH conditions are true:
          //   1. The matched portion is already balanced (depth === 0)
          //   2. The match ends at a line boundary (nothing more on this line)
          // This handles two tricky cases:
          //   - before="findFirst"   → depth=0, charAfter="(" → NOT atLineEnd → expand
          //   - before="findFirst({" → depth=2, charAfter="\n" → depth>0      → expand
          if (depth <= 0 && atLineEnd) return endIdx;

          // Scan forward until all delimiters are closed
          let pos = endIdx;
          while (pos < text.length) {
            const ch = text[pos];
            if ("({[".includes(ch)) depth++;
            if (")}]".includes(ch)) depth--;
            pos++;
            if (depth <= 0) {
              // Consume trailing `;` if present
              while (pos < text.length && text[pos] === ";") pos++;
              break;
            }
          }
          return pos;
        };

        // ── Find anchor position using fuzzy line-by-line matching ───────────
        // Strategy:
        //   1. Try exact EOL-normalised match first.
        //   2. Fuzzy sliding-window: each line compared after trimming whitespace.
        //   3. In both cases, if the matched range ends mid-line, expand it to
        //      cover the full statement (brace-depth tracking).
        const findAnchorRange = (): {
          startIdx: number;
          endIdx: number;
        } | null => {
          const fileTextLf = normLf(fullText);
          const fileLines = fileTextLf.split("\n");
          const beforeLines = normLf(rawBefore)
            .split("\n")
            .filter((l, i, a) => {
              if (i === 0 && l.trim() === "") return false;
              if (i === a.length - 1 && l.trim() === "") return false;
              return true;
            });

          if (beforeLines.length === 0) return null;

          // -- Pass 1: exact EOL-normalised match --
          const normalizedBefore = toFileEol(rawBefore);
          const exactIdx = fullText.indexOf(normalizedBefore);
          if (exactIdx !== -1) {
            const baseEnd = exactIdx + normalizedBefore.length;
            // Expand if match ends mid-line (partial-line anchor)
            const expandedEnd = expandToStatement(fullText, exactIdx, baseEnd);
            return { startIdx: exactIdx, endIdx: expandedEnd };
          }

          // -- Pass 2: fuzzy sliding window (ignores leading/trailing whitespace) --
          const windowSize = beforeLines.length;

          // Helper: check if a file line "contains" the before line as prefix
          // (handles case where AI gave only the start of a longer line)
          const lineMatches = (
            fileLine: string,
            beforeLine: string,
          ): boolean => {
            const f = normLine(fileLine);
            const b = normLine(beforeLine);
            return f === b || f.startsWith(b);
          };

          for (let i = 0; i <= fileLines.length - windowSize; i++) {
            const windowLines = fileLines.slice(i, i + windowSize);
            const matches = windowLines.every((wl, j) => {
              if (j === windowSize - 1) {
                // Last before-line can be a prefix of the file line
                return lineMatches(wl, beforeLines[j]);
              }
              return normLine(wl) === normLine(beforeLines[j]);
            });

            if (matches) {
              const linesLf = fileTextLf.split("\n");

              // Compute start offset (LF-based)
              let startOffset = 0;
              for (let k = 0; k < i; k++) startOffset += linesLf[k].length + 1;

              // For a single-line before, match only up to the length of `before`
              // trimmed content inside the file line
              let endOffset: number;
              if (windowSize === 1) {
                const fileLine = linesLf[i];
                const beforeTrimmed = normLine(beforeLines[0]);
                // Find where the before content ends inside the file line
                const fileLineTrimmed = fileLine.trimStart();
                const leadLen = fileLine.length - fileLineTrimmed.length;
                endOffset = startOffset + leadLen + beforeTrimmed.length;
              } else {
                endOffset = startOffset;
                for (let k = i; k < i + windowSize; k++)
                  endOffset += linesLf[k].length + 1;
                endOffset -= 1; // remove trailing newline
              }

              // Convert LF offsets → CRLF offsets if needed
              const toRealOffset = (lfOffset: number): number => {
                if (fileEol === "\n") return lfOffset;
                let extra = 0;
                for (let p = 0; p < lfOffset; p++) {
                  if (fileTextLf[p] === "\n") extra++;
                }
                return lfOffset + extra;
              };

              const realStart = toRealOffset(startOffset);
              const realEnd = toRealOffset(endOffset);

              // Expand to cover the full statement if partial line matched
              const expandedEnd = expandToStatement(
                fullText,
                realStart,
                realEnd,
              );
              return { startIdx: realStart, endIdx: expandedEnd };
            }
          }

          return null;
        };

        const anchored = findAnchorRange();

        if (!anchored) {
          vscode.window.showErrorMessage(
            `Không tìm thấy đoạn neo trong file.\n\nNội dung mong đợi:\n${rawBefore}`,
          );
          return;
        }

        const { startIdx, endIdx } = anchored;
        const start = doc.positionAt(startIdx);
        const end = doc.positionAt(endIdx);

        // Preserve the indentation of the FIRST matched line
        const firstMatchedLine = doc.lineAt(start.line).text;
        const leadingIndent = firstMatchedLine.match(/^(\s*)/)?.[1] ?? "";

        // Re-indent each line of `after` to match the anchor's leading indent
        const reindentAfter = (raw: string): string => {
          const linesLf = normLf(raw).split("\n");
          const afterLines = linesLf.filter((l, i, a) => {
            if (i === 0 && l.trim() === "") return false;
            if (i === a.length - 1 && l.trim() === "") return false;
            return true;
          });

          const minIndent = afterLines.reduce((min, l) => {
            if (l.trim() === "") return min;
            const m = l.match(/^(\s*)/);
            const len = m ? m[1].length : 0;
            return Math.min(min, len);
          }, Infinity);
          const safeMinIndent = isFinite(minIndent) ? minIndent : 0;

          const reindented = afterLines.map((l, i) => {
            if (l.trim() === "") return "";
            const extraIndent = l.slice(safeMinIndent);
            return i === 0
              ? leadingIndent + extraIndent.trimStart()
              : leadingIndent + extraIndent;
          });

          return toFileEol(reindented.join("\n"));
        };

        const normalizedAfter = reindentAfter(rawAfter);
        const wsEdit = new vscode.WorkspaceEdit();

        if (operation === "insert") {
          wsEdit.insert(uri, end, fileEol + normalizedAfter);
        } else if (operation === "delete") {
          wsEdit.delete(uri, new vscode.Range(start, end));
        } else {
          wsEdit.replace(uri, new vscode.Range(start, end), normalizedAfter);
        }

        const editApplied = await vscode.workspace.applyEdit(wsEdit);
        if (!editApplied) {
          vscode.window.showErrorMessage("Không thể áp dụng bản sửa vào file.");
          return;
        }

        // Save so the file reflects changes immediately
        await doc.save();

        // ---- Remove ONLY this comment from sidebar after applying fix ----
        try {
          const list = sidebarProvider.comments ?? [];
          const targetFile = uri.fsPath;
          const updated = list.filter(
            (c: any) =>
              !(
                c.file === targetFile &&
                c.line === comment.line &&
                c.comment === comment.comment
              ),
          );
          syncCommentState(updated);

          // ---- Re-render decorations to clear the tooltip ----
          // Match editors by fileName (handles diff-view editors whose URI scheme
          // may differ from 'file:' but document.fileName still equals fsPath)
          try {
            const fileComments = updated.filter(
              (c: any) => c.file === targetFile,
            );
            const targetEditor = findModifiedEditor(targetFile);
            if (targetEditor) {
              applyReviewDecorations(targetEditor, fileComments, "");
            }
          } catch (err) {
            console.error("Decoration re-render failed:", err);
          }
        } catch (e) {
          console.error("Failed to remove comment after applyFix:", e);
        }
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "srv.deleteComment",
        async (arg1, arg2) => {
          // Support both invocation styles:
          // 1) CodeLens / direct call: (uri, comment)
          // 2) Sidebar context menu: (CommentNode)
          const targetComment = arg2 ?? arg1?.comment ?? arg1;

          const targetFile =
            (typeof arg1 === "string"
              ? vscode.Uri.parse(arg1).fsPath
              : (arg1?.fsPath ??
                arg1?.resourceUri?.fsPath ??
                arg1?.uri?.fsPath ??
                targetComment?.file)) ?? "";

          if (!targetFile || !targetComment) {
            vscode.window.showErrorMessage(
              "Không thể xác định comment/file cần xóa.",
            );
            return;
          }

          const list = sidebarProvider.comments ?? [];
          const updated = list.filter(
            (c: any) =>
              !(
                c.file === targetFile &&
                c.line === targetComment.line &&
                c.comment === targetComment.comment
              ),
          );

          syncCommentState(updated);

          try {
            const targetEditor = findModifiedEditor(targetFile);
            if (targetEditor) {
              const fileComments = updated.filter(
                (c: any) => c.file === targetFile,
              );
              applyReviewDecorations(targetEditor, fileComments, "");
            }
          } catch (err) {
            console.error(
              "Decoration refresh failed after deleteComment:",
              err,
            );
          }

          vscode.window.showInformationMessage(
            "Đã xóa comment khỏi danh sách.",
          );
        },
      ),
    );
  } catch (err) {
    console.error("❌ SRV activate failed:", err);
    vscode.window.showErrorMessage(
      "Không thể khởi động extension SRV. Vui lòng kiểm tra Developer Console.",
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
