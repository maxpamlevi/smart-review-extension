import * as vscode from "vscode";

/**
 * Sidebar Provider (simple list - Model A)
 * Shows ONLY the comments from the most recent AI review.
 */

export class CommentSidebarProvider implements vscode.TreeDataProvider<CommentNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CommentNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  public comments: any[] = [];

  refresh(comments: any[]) {
    if (comments && comments.length > 0) {
      this.comments = [...this.comments, ...comments];
    }
    this._onDidChangeTreeData.fire();
  }

  // Replace mode (used when deleting comments after applyFix)
  refreshReplace(comments: any[]) {
    this.comments = comments ?? [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CommentNode): vscode.TreeItem {
    return element;
  }

  getChildren(): CommentNode[] {
    return this.comments.map((c) => {
      const label = `Line ${c.line}: ${c.comment}`;
      return new CommentNode(label, c);
    });
  }
}

export class CommentNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly comment: any
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "srvComment";
    this.command = {
      command: "srv.jumpToComment",
      title: "Jump to comment",
      arguments: [comment]
    };
    this.tooltip = `${comment.comment}\nSuggestion: ${comment.suggestion}`;
  }
}