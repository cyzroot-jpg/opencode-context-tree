# OpenCode Context Tree

中文 | [English](README.en.md)

把 OpenCode 会话变成一棵**上下文树**：每次提问是一个节点，可以随时切回旧节点、从旧节点继续分叉、跨分支引用内容、删除分支或只压缩某个节点。TUI 中看到的对话和模型实际收到的历史会一起切换。

## 功能

- **节点切换**：选择任意历史提问，界面和模型上下文都回到该节点及其祖先。
- **自然分叉**：切回旧节点后继续提问，新消息会成为该节点的新子节点，不覆盖原来的后续对话。
- **多根节点**：在不继承当前上下文的情况下开始一条全新分支。
- **跨分支链接**：把另一个节点的路径加入当前节点的模型上下文，但不在界面中显示，适合引用另一条分支的结论。
- **删除节点**：递归删除节点及其后代；删除最后一个根节点后，下一次提问会开启新树。
- **节点压缩**：只压缩指定节点，压缩结果会绑定到该节点；切换分支时自动使用对应节点的压缩检查点。
- **共享工作区状态**：每个分支都能看到最新的文件变更、todo 和 shell 命令，避免旧分支误以为工作区没有变化。
- **侧边栏提示**：显示当前节点链接了哪些分支。

树数据保存在 session metadata 的 `opencode.contextTree` 键下，不会写入对话消息。

## 使用

在会话中执行：

```text
/tree                  选择并切换到某个上下文节点
/tree new              下一次提问开启新的根节点
/tree link             把另一个节点链接到当前节点（再次选择可取消链接）
/tree delete           删除一个节点及其后代
/tree compact          切换到某个节点并压缩它
```

第一次执行 `/tree` 时，插件会根据已有的用户消息自动建立树；之后的新提问会自动追加节点。

## 安装

> **重要**：完整功能需要 OpenCode 核心提供 `history` 会话钩子、压缩 metadata、TUI 消息过滤和手动压缩预览。这些扩展目前位于 fork 的 `context-tree` 分支，尚未进入公开版本。仅安装插件到官方版本时，节点切换和压缩不会生效。

推荐使用带扩展的构建：

```sh
git clone --branch context-tree https://github.com/cyzroot-jpg/opencode.git
cd opencode
bun install
bun run dev
```

然后安装插件：

```sh
opencode plugin add 'git+https://github.com/cyzroot-jpg/opencode-context-tree.git'
```

也可以手动写入 `opencode.jsonc`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["git+https://github.com/cyzroot-jpg/opencode-context-tree.git"]
}
```

开发时可以直接指向本地目录：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/opencode-context-tree"]
}
```

插件同时提供 server 和 TUI 入口，必须先重启 OpenCode 或重新加载插件。

## 兼容性

- 需要 OpenCode 2.x。
- 需要包含 context tree 核心扩展的构建（fork 分支 `context-tree`）。
- 测试环境：OpenCode 2.1.4 + Bun 1.4.4。
- 直接导出 TypeScript 源码，无构建步骤。

## 开发

```sh
bun install
bun test
bun run typecheck
```

## 原理

- server 插件在 `prompt` 时追加节点，在 `history` 时按活动路径和链接生成模型历史。
- 手动压缩使用 `SessionContext.preview()` 预览当前节点的历史；压缩钩子把活动节点写入 compaction metadata。
- TUI 插件提供 `/tree` 命令、选择对话框、侧边栏，并通过 `ui.messages.filter` 只显示活动路径。
- 全局状态在每次请求前作为 `<global-state>` 系统块注入，不显示在对话中。

## 限制

- 树只覆盖用户提问节点；工具调用和助手回复归属于其所在提问区间。
- 链接只影响模型上下文，不会把被链接分支的对话显示在当前界面。
- 全局状态按 session 跟踪，VCS 状态最多每 2 秒刷新一次。
- 删除和压缩会修改 session 数据，操作前请确认目标节点。

## License

MIT