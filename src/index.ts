import { Plugin } from "@opencode/plugin"
import type { SessionMessage } from "@opencode/schema/session-message"
import { sessionHook } from "./compat.js"
import { apply, createState, renderState, type State } from "./global.js"
import {
  add,
  addRoot,
  get,
  historyMessages,
  path,
  set,
  type Info,
} from "./tree.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const read = (metadata: Record<string, unknown> | null | undefined) => get(metadata)

const write = <M extends Record<string, unknown>>(metadata: M | null | undefined, tree: Info) =>
  set(metadata, tree) as M

const compactNode = (message: SessionMessage.Info) => {
  if (message.type !== "compaction" || message.status !== "completed") return
  const tree = message.metadata?.contextTree
  if (!isRecord(tree) || typeof tree.nodeID !== "string") return
  return tree.nodeID
}

const messageText = (message: SessionMessage.Info) => {
  switch (message.type) {
    case "user":
      return [
        ...(message.skills ?? []).flatMap((skill) => (skill.text === undefined ? [] : [`[Skill: ${skill.name}]\n${skill.text}`])),
        `[User]: ${message.text}`,
      ].join("\n")
    case "assistant":
      return message.content
        .flatMap((part) => {
          if (part.type === "text") return [`[Assistant]: ${part.text}`]
          if (part.type === "reasoning") return []
          const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
          const call = `[Assistant tool call]: ${part.name}(${input})`
          if (part.state.status === "completed") return [call, `[Tool result]: ${JSON.stringify(part.state.content)}`]
          if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error.message}`]
          return [call]
        })
        .join("\n")
    case "synthetic":
      return `[Synthetic]: ${message.text}`
    case "skill":
      return `[Skill: ${message.name}]\n${message.text}`
    case "shell":
      return `[Shell]: ${message.command}\n${message.output?.output ?? ""}`
    case "location-switched":
      return `[User]: The working directory has been changed to ${message.location.directory}.`
    default:
      return ""
  }
}

const treeHistory = (tree: Info, messages: ReadonlyArray<SessionMessage.Info>) => {
  const allowed = historyMessages(tree, messages)
  const activePath = path(tree, tree.active)
  let selected: { readonly message: SessionMessage.Info; readonly index: number } | undefined
  for (const nodeID of activePath.toReversed()) {
    const index = allowed.findLastIndex((message) => compactNode(message) === nodeID)
    if (index !== -1) {
      selected = { message: allowed[index]!, index }
      break
    }
  }
  if (!selected) return allowed.filter((message) => message.type !== "compaction")
  if (selected.message.type !== "compaction") return allowed.filter((message) => message.type !== "compaction")
  const keepID = selected.message.metadata?.keepID
  const keepIndex = typeof keepID === "string" ? allowed.findIndex((message) => message.id === keepID) : -1
  const recent =
    keepIndex === -1
      ? ""
      : allowed
          .slice(keepIndex, selected.index)
          .filter((message) => message.type !== "compaction")
          .map(messageText)
          .filter(Boolean)
          .join("\n\n")
  const checkpoint: SessionMessage.Info = {
    ...selected.message,
    metadata: { ...selected.message.metadata, ...(recent ? { recent } : {}) },
  }
  return [
    checkpoint,
    ...allowed.slice(selected.index + 1).filter((message) => message.type !== "compaction"),
  ]
}

export default Plugin.define({
  id: "opencode.context-tree",
  async setup(ctx) {
    const queues = new Map<string, Promise<void>>()
    const mutate = (sessionID: string, change: (tree: Info) => Info | undefined) => {
      const previous = queues.get(sessionID) ?? Promise.resolve()
      const next = previous
        .catch(() => {})
        .then(async () => {
          const session = await ctx.session.get({ sessionID })
          const tree = read(session.metadata)
          if (!tree) return
          const result = change(tree)
          if (!result || result === tree) return
          await ctx.session.update({ sessionID, metadata: write(session.metadata, result) })
        })
      queues.set(sessionID, next)
      return next
    }

    await ctx.session.hook("prompt", async (event) => {
      await mutate(event.sessionID, (tree) =>
        tree.pendingRoot ? addRoot(tree, event.messageID, event.prompt.text) : add(tree, event.messageID, event.prompt.text),
      )
    })

    const hook = sessionHook(ctx.session)

    await hook("history", async (event) => {
      const tree = read(event.session.metadata)
      if (!tree) return
      event.result = treeHistory(tree, event.messages)
    })

    await hook("compaction", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      const tree = read(session.metadata)
      if (!tree?.active || !tree.nodes[tree.active]) return
      event.metadata = { ...event.metadata, contextTree: { nodeID: tree.active } }
    })

    const states = new Map<string, State>()
    const seeded = new Set<string>()
    const refreshing = new Set<string>()

    const refreshStatus = async (sessionID: string, state: State) => {
      if (refreshing.has(sessionID)) return
      refreshing.add(sessionID)
      try {
        const status = await ctx.vcs
          .status(undefined, { signal: AbortSignal.timeout(2_000) })
          .catch(() => undefined)
        if (status) apply(state, "edit", {}, { metadata: { files: status.data } })
      } finally {
        refreshing.delete(sessionID)
      }
    }

    const ensure = async (sessionID: string) => {
      const state = states.get(sessionID) ?? createState()
      states.set(sessionID, state)
      if (seeded.has(sessionID)) return state
      seeded.add(sessionID)
      const messages = await ctx.session
        .context({ sessionID }, { signal: AbortSignal.timeout(5_000) })
        .catch(() => [])
      for (const message of messages) {
        if (message.type !== "assistant") continue
        for (const part of message.content) {
          if (part.type !== "tool" || part.state.status !== "completed") continue
          apply(state, part.name, part.state.input, { metadata: part.state.metadata })
        }
      }
      await refreshStatus(sessionID, state)
      return state
    }

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return
      try {
        const state = await ensure(event.sessionID)
        apply(state, event.tool, event.input, { output: event.result.output, metadata: event.result.metadata })
        if (event.tool === "shell") await refreshStatus(event.sessionID, state)
      } catch {}
    })

    await ctx.session.hook("context", async (event) => {
      try {
        const state = await ensure(event.sessionID)
        const text = renderState(state, ctx.location.directory)
        if (text) event.system.push({ type: "text", text })
      } catch {}
    })

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ types: ["session.deleted"] })) {
          states.delete(event.data.sessionID)
          seeded.delete(event.data.sessionID)
          refreshing.delete(event.data.sessionID)
          queues.delete(event.data.sessionID)
        }
      } catch {}
    })()
  },
})