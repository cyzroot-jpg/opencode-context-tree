# OpenCode Context Tree

[中文](README.md) | English

Turn an OpenCode session into a **context tree**: every prompt is a node. Switch back to an old node, continue from it as a new branch, link content across branches, delete a branch, or compact a single node. The TUI transcript and the model history switch together.

## Features

- **Node switching**: select any previous prompt; both the visible transcript and the model context return to that node and its ancestors.
- **Natural branching**: continue from an old node and the new prompt becomes a sibling branch without overwriting the original conversation.
- **Multiple roots**: start a new branch without inheriting the current context.
- **Cross-branch links**: include another node's path in the current node's model context without showing it in the TUI. Useful for referencing conclusions from another branch.
- **Node deletion**: delete a node and all descendants. Deleting the last root makes the next prompt start a fresh tree.
- **Node compaction**: compact only the selected node. The compaction checkpoint is bound to that node and reused when you switch back.
- **Shared workspace state**: every branch sees the latest changed files, todos, and shell commands, so an old branch does not assume the workspace is unchanged.
- **Sidebar hints**: show which branches the active node links to.

Tree data lives in session metadata under `opencode.contextTree`. It is not written into conversation messages.

## Usage

Inside a session:

```text
/tree                  Select and switch to a context node
/tree new              Start the next prompt as a new root
/tree link             Link another node to the active node (select again to unlink)
/tree delete           Delete a node and its descendants
/tree compact          Switch to a node and compact it
```

The first `/tree` builds a tree from the existing user messages. Later prompts append nodes automatically.

## Install

> **Important**: full functionality requires core OpenCode support for the `history` session hook, compaction metadata, TUI message filtering, and manual compaction preview. These extensions currently live on the `context-tree` branch of the fork and are not in the public release. Installing only this plugin into official OpenCode will not make switching or node compaction work.

Use the extended build:

```sh
git clone --branch context-tree https://github.com/cyzroot-jpg/opencode.git
cd opencode
bun install
bun run dev
```

Then install the plugin:

```sh
opencode plugin add 'git+https://github.com/cyzroot-jpg/opencode-context-tree.git'
```

Or add it to `opencode.jsonc` manually:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["git+https://github.com/cyzroot-jpg/opencode-context-tree.git"]
}
```

For development, point at a local checkout:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/opencode-context-tree"]
}
```

The package provides both a server and a TUI entry. Restart OpenCode or reload plugins after changing the configuration.

## Compatibility

- Requires OpenCode 2.x.
- Requires a build with the context tree core extensions (fork branch `context-tree`).
- Tested with OpenCode 2.1.4 and Bun 1.4.4.
- Exports TypeScript source directly; there is no build step.

## Development

```sh
bun install
bun test
bun run typecheck
```

## How it works

- The server plugin appends nodes on `prompt` and builds model history from the active path plus links on `history`.
- Manual compaction previews the active node through `SessionContext.preview()`. The compaction hook stores the active node in compaction metadata.
- The TUI plugin provides `/tree`, selection dialogs, the sidebar, and uses `ui.messages.filter` to show only the active path.
- Workspace state is injected as a `<global-state>` system block before each request. It never appears in the transcript.

## Limitations

- The tree covers user prompt nodes. Tool calls and assistant replies belong to the prompt interval that contains them.
- Links affect the model context only; linked conversations stay hidden in the TUI.
- Workspace state is tracked per session. VCS status refreshes at most every two seconds.
- Delete and compact modify session data. Confirm the target node before running them.

## License

MIT