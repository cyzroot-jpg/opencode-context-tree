/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createMemo } from "solid-js"
import { messageFilters } from "./compat.js"
import {
  armRoot,
  get,
  initialize,
  link,
  order,
  remove,
  set,
  switchTo,
  unlink,
  visible,
  type Info,
} from "./tree.js"

const tree = (metadata: Record<string, unknown> | null | undefined) => get(metadata)
const isRoot = (current: Info, id: string) => {
  const node = current.nodes[id]
  return !node?.parent || !current.nodes[node.parent]
}

export default Plugin.define({
  id: "opencode.context-tree.tui",
  setup(context) {
    const pending = new Map<string, Promise<void>>()

    const update = (sessionID: string, change: (tree: Info | undefined) => Info | undefined) => {
      const previous = pending.get(sessionID) ?? Promise.resolve()
      const next = previous
        .catch(() => {})
        .then(async () => {
          context.data.session.invalidate(sessionID)
          await context.data.session.sync(sessionID)
          const session = context.data.session.get(sessionID)
          if (!session) return
          const current = tree(session.metadata)
          const result = change(current)
          if (!result || result === current) return
          await context.client.session.update({ sessionID, metadata: set(session.metadata, result) })
          context.data.session.invalidate(sessionID)
          await context.data.session.sync(sessionID)
        })
      pending.set(sessionID, next)
      return next
    }

    const ensure = async (sessionID: string) => {
      const current = tree(context.data.session.get(sessionID)?.metadata)
      if (current) return current
      await context.data.session.message.sync(sessionID)
      const built = initialize(
        context.data.session.message
          .list(sessionID)
          .filter((message) => message.type === "user")
          .map((message) => ({ id: message.id, text: message.text })),
      )
      if (!built) return
      await update(sessionID, (value) => value ?? built)
      return tree(context.data.session.get(sessionID)?.metadata) ?? built
    }

    const select = async (sessionID: string, current: Info, title: string) => {
      const active = current.active
      const links = active ? (current.nodes[active]?.links ?? []) : []
      return context.ui.dialog.select<string>({
        title,
        current: active,
        options: order(current).map(({ id, node, depth }) => ({
          title: `${"  ".repeat(depth)}${node.label}`,
          value: id,
          footer: id === active ? "active" : links.includes(id) ? "linked" : undefined,
        })),
      })
    }

    const open = async (argument?: string) => {
      const route = context.ui.router.current()
      if (route.type !== "session") {
        context.ui.toast.show({ message: "Open a session first", variant: "warning" })
        return
      }
      const sessionID = route.sessionID
      const current = await ensure(sessionID)
      if (!current) {
        context.ui.toast.show({ message: "No user messages to build a context tree", variant: "warning" })
        return
      }
      const command = argument?.trim().toLowerCase()

      if (command === "new" || command === "root") {
        await update(sessionID, (value) => (value ? armRoot(value) : value))
        context.ui.toast.show({ message: "Next prompt starts a new root", variant: "success" })
        return
      }

      if (command === "link") {
        while (true) {
          const value = tree(context.data.session.get(sessionID)?.metadata)
          if (!value) return
          const id = await select(sessionID, value, "Link context node")
          if (!id) return
          await update(sessionID, (latest) => {
            if (!latest?.active || id === latest.active) return latest
            const links = latest.nodes[latest.active]?.links ?? []
            return links.includes(id) ? unlink(latest, id) : link(latest, id)
          })
        }
      }

      if (command === "delete" || command === "remove") {
        const value = tree(context.data.session.get(sessionID)?.metadata)
        if (!value) return
        const id = await select(sessionID, value, "Delete context node")
        if (!id) return
        if (isRoot(value, id)) {
          const confirmed = await context.ui.dialog.confirm({
            title: "Delete root node?",
            message: `Delete "${value.nodes[id]?.label ?? id}" and its branches? If it is the last root, the session starts fresh.`,
          })
          if (!confirmed) return
        }
        await update(sessionID, (latest) => (latest ? remove(latest, id) : latest))
        context.ui.toast.show({ message: `Deleted ${value.nodes[id]?.label ?? id}`, variant: "success" })
        return
      }

      if (command === "compact") {
        const value = tree(context.data.session.get(sessionID)?.metadata)
        if (!value) return
        const id = await select(sessionID, value, "Compact context node")
        if (!id) return
        await update(sessionID, (latest) => (latest ? switchTo(latest, id) : latest))
        await context.client.session.compact({ sessionID })
        context.ui.toast.show({ message: `Compacting ${value.nodes[id]?.label ?? id}`, variant: "success" })
        return
      }

      const value = tree(context.data.session.get(sessionID)?.metadata)
      if (!value) return
      const id = await select(sessionID, value, "Context tree")
      if (!id) return
      await update(sessionID, (latest) => (latest ? switchTo(latest, id) : latest))
      context.ui.toast.show({ message: `Context switched to ${value.nodes[id]?.label ?? id}`, variant: "success" })
    }

    context.keymap.layer(() => ({
      commands: [
        {
          id: "context-tree.open",
          title: "Context tree",
          group: "Session",
          slash: { name: "tree", arguments: true },
          run: (input?: string) => open(input),
        },
      ],
    }))

    messageFilters(context.ui).filter((input) => {
      if (!input) return []
      const current = tree(context.data.session.get(input.sessionID)?.metadata)
      return current ? visible(current, input.messages) : input.messages
    })

    context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        if (!props?.sessionID) return null
        const session = createMemo(() => context.data.session.get(props.sessionID))
        const links = createMemo(() => {
          const current = tree(session()?.metadata)
          const active = current?.active
          if (!current || !active) return []
          return (current.nodes[active]?.links ?? []).flatMap((id) => {
            const node = current.nodes[id]
            return node ? [{ id, label: node.label, root: isRoot(current, id) }] : []
          })
        })
        return (
          <Show when={links().length > 0}>
            <box>
              <text fg={context.theme.text.base}>
                <b>Linked context</b>
              </text>
              <For each={links()}>
                {(item) => (
                  <text fg={context.theme.text.muted}>
                    • {item.label}
                    {item.root ? " (root)" : ""}
                  </text>
                )}
              </For>
            </box>
          </Show>
        )
      },
    })
  },
})