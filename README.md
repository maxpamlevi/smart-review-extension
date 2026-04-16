# SRV — AI Code Review for VS Code

SRV is a lightweight AI-powered code review extension for Visual Studio Code. It analyzes Git diffs, generates actionable review comments, shows them inline and in a sidebar, and lets you apply or remove comments with a single click.

The extension is designed to fit naturally into your Git workflow without interrupting your editor experience.

## Highlights

- **AI review for changed files** using your configured Azure OpenAI endpoint.
- **Inline review comments** rendered directly on the diff editor.
- **Sidebar comment list** for quick navigation between findings.
- **One-click fix application** with anchor-based patching.
- **Delete comments manually** from the sidebar or CodeLens actions.
- **Faster review flow** with reduced diff context and lighter request settings.
- **Custom extension icon** using `media/logo_ai.png`.

## How It Works

1. Open a file inside a Git repository.
2. Run **AI: Review Code Diff**.
3. SRV collects the Git diff, sends it to the AI backend, and receives structured JSON comments.
4. Comments are shown in the editor and in the **AI Review Comments** sidebar.
5. You can jump to a comment, apply the suggested fix, or delete the comment.

## Requirements

- Visual Studio Code
- A Git repository
- Azure OpenAI endpoint URL
- Azure OpenAI API key
- Azure OpenAI deployment name

## Configuration

Open **Settings** and configure the following values:

| Setting | Description |
| --- | --- |
| `srv.aiReview.azureUrl` | Azure OpenAI endpoint URL |
| `srv.aiReview.azureKey` | Azure OpenAI API key |
| `srv.aiReview.deploymentName` | Azure OpenAI model deployment name |

## Commands

| Command | Description |
| --- | --- |
| `srv.reviewCode` | Run AI review on the current file |
| `srv.applyFix` | Apply the suggested fix for a comment |
| `srv.deleteComment` | Remove a comment from the sidebar or CodeLens |
| `srv.openDiff` | Open the Git diff for a file |
| `srv.jumpToComment` | Jump to the selected comment in the file |
| `srv.refreshChangedFiles` | Refresh the changed files list |
| `srv.openSettings` | Open SRV settings |

## Typical Workflow

### Review a file

- Open a modified file.
- Run **AI: Review Code Diff** from the command palette.
- Review the generated comments in the diff editor.

### Apply a fix

- Click **Apply Fix** on a comment.
- SRV uses the `before` anchor text to locate the code safely.
- The fix is applied and the comment is removed automatically.

### Delete a comment

- Open the **AI Review Comments** sidebar.
- Right-click a comment and choose **Delete Comment**.
- The sidebar and decorations update immediately.

## Notes

- SRV uses anchor-based replacement so fixes remain resilient even when line ranges are imperfect.
- The extension keeps review comments synchronized across the diff editor, CodeLens actions, and the sidebar.
- Review speed can be improved by sending smaller diffs and using lower-temperature AI responses.

## Project Status

This project is actively evolving. Recent improvements include:

- Sidebar comment deletion
- CodeLens actions for apply/delete
- Faster review requests
- Custom extension icon

## License

This project does not currently include a license file. Add one if you plan to publish or share the extension publicly.
