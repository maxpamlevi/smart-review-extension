import * as vscode from "vscode";

export class AiFixCodeLensProvider implements vscode.CodeLensProvider {
  private comments: any[] = [];

  public updateComments(comments: any[]) {
    this.comments = comments;
  }

  onDidChangeCodeLenses?: vscode.Event<void> | undefined;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.comments || this.comments.length === 0) return [];

    const fileComments = this.comments.filter(
      (c) => !c.file || c.file === document.fileName,
    );

    if (fileComments.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    for (const c of fileComments) {
      const line = c.line - 1;
      if (line < 0 || line >= document.lineCount) continue;

      const range = new vscode.Range(line, 0, line, 0);

      lenses.push(
        new vscode.CodeLens(range, {
          title: "Apply Fix",
          command: "srv.applyFix",
          arguments: [document.uri, c]
        }),
        new vscode.CodeLens(range, {
          title: "Delete Comment",
          command: "srv.deleteComment",
          arguments: [document.uri, c],
        })
      );
    }

    return lenses;
  }
}