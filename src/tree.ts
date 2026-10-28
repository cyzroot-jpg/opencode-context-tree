export * as ContextTree from "./tree.js"

export const Key = "opencode.contextTree"

type Metadata = { readonly [key: string]: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface Node {
  readonly parent?: string
  readonly label: string
  readonly links?: readonly string[]
}

export interface Info {
  readonly version: 1
  readonly root?: string
  readonly active?: string
  readonly pendingRoot?: boolean
  readonly nodes: Readonly<Record<string, Node>>
}

export const get = (metadata: Metadata | null | undefined) => {
  const value = metadata?.[Key]
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.nodes)) return
  for (const node of Object.values(value.nodes)) {
    if (!isRecord(node) || typeof node.label !== "string") return
    if (node.parent !== undefined && typeof node.parent !== "string") return
    if (node.links !== undefined && (!Array.isArray(node.links) || node.links.some((link) => typeof link !== "string")))
      return
  }
  return value as unknown as Info
}

export const set = <M extends Metadata>(metadata: M | null | undefined, tree: Info) =>
  ({ ...(metadata ?? {}), [Key]: tree }) as unknown as M

export const detach = <M extends Metadata>(metadata: M | null | undefined) => {
  if (!metadata || metadata[Key] === undefined) return metadata
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== Key)) as M
}

export const label = (text: string) => {
  const value = text.replace(/\s+/g, " ").trim()
  return value.length > 80 ? `${value.slice(0, 79)}…` : value || "(empty prompt)"
}

export const initialize = (messages: readonly { readonly id: string; readonly text: string }[]) => {
  if (messages.length === 0) return
  const nodes: Record<string, Node> = {}
  let parent: string | undefined
  for (const message of messages) {
    if (nodes[message.id]) continue
    nodes[message.id] = { ...(parent ? { parent } : {}), label: label(message.text) }
    parent = message.id
  }
  if (!parent) return
  return { version: 1 as const, root: messages[0]!.id, active: parent, nodes }
}

export const path = (tree: Info, id: string | undefined) => {
  const result: string[] = []
  const seen = new Set<string>()
  let current = id
  while (current && tree.nodes[current] && !seen.has(current)) {
    seen.add(current)
    result.push(current)
    current = tree.nodes[current]!.parent
  }
  return result.reverse()
}

const last = (tree: Info) => (tree.active && tree.nodes[tree.active] ? tree.active : Object.keys(tree.nodes).at(-1))

export const add = (tree: Info, id: string, text: string) => {
  if (tree.nodes[id]) return tree
  const parent = last(tree)
  const links = parent ? tree.nodes[parent]?.links : undefined
  return {
    ...tree,
    root: tree.root ?? id,
    active: id,
    pendingRoot: false,
    nodes: {
      ...tree.nodes,
      [id]: {
        ...(parent ? { parent } : {}),
        label: label(text),
        ...(links?.length ? { links } : {}),
      },
    },
  }
}

export const addRoot = (tree: Info, id: string, text: string) => {
  if (tree.nodes[id]) return tree
  return {
    ...tree,
    root: tree.root ?? id,
    active: id,
    pendingRoot: false,
    nodes: { ...tree.nodes, [id]: { label: label(text) } },
  }
}

export const armRoot = (tree: Info) => ({ ...tree, pendingRoot: true })

export const switchTo = (tree: Info, id: string) =>
  tree.nodes[id] ? { ...tree, active: id, pendingRoot: false } : tree

export const link = (tree: Info, id: string) => {
  const active = tree.active
  if (!active || !tree.nodes[active] || !tree.nodes[id] || id === active) return tree
  const current = tree.nodes[active]
  if (current.links?.includes(id)) return tree
  return {
    ...tree,
    nodes: { ...tree.nodes, [active]: { ...current, links: [...(current.links ?? []), id] } },
  }
}

export const unlink = (tree: Info, id: string) => {
  const active = tree.active
  if (!active || !tree.nodes[active]) return tree
  const current = tree.nodes[active]
  if (!current.links?.includes(id)) return tree
  const links = current.links.filter((item) => item !== id)
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [active]: {
        label: current.label,
        ...(current.parent ? { parent: current.parent } : {}),
        ...(links.length ? { links } : {}),
      },
    },
  }
}

export const remove = (tree: Info, id: string) => {
  if (!tree.nodes[id]) return tree
  const removed = new Set<string>()
  const pending = [id]
  while (pending.length) {
    const current = pending.pop()!
    if (removed.has(current)) continue
    removed.add(current)
    for (const [child, node] of Object.entries(tree.nodes)) {
      if (node.parent === current) pending.push(child)
    }
  }
  const nodes: Record<string, Node> = {}
  for (const [nodeID, node] of Object.entries(tree.nodes)) {
    if (removed.has(nodeID)) continue
    const links = node.links?.filter((link) => !removed.has(link))
    nodes[nodeID] = {
      label: node.label,
      ...(node.parent && !removed.has(node.parent) ? { parent: node.parent } : {}),
      ...(links?.length ? { links } : {}),
    }
  }
  const remaining = Object.keys(nodes)
  if (remaining.length === 0) return { version: 1 as const, pendingRoot: true, nodes: {} }
  const roots = remaining.filter((nodeID) => !nodes[nodeID]!.parent)
  const parent = tree.nodes[id]?.parent
  return {
    version: 1 as const,
    root: tree.root && nodes[tree.root] ? tree.root : roots[0],
    active:
      tree.active && !removed.has(tree.active)
        ? tree.active
        : parent && nodes[parent]
          ? parent
          : roots[0],
    pendingRoot: false,
    nodes,
  }
}

export const order = (tree: Info) => {
  const result: { readonly id: string; readonly node: Node; readonly depth: number }[] = []
  const children = new Map<string | undefined, string[]>()
  for (const [id, node] of Object.entries(tree.nodes)) {
    const parent = node.parent && tree.nodes[node.parent] ? node.parent : undefined
    children.set(parent, [...(children.get(parent) ?? []), id])
  }
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = tree.nodes[id]
    if (!node) return
    result.push({ id, node, depth })
    for (const child of children.get(id) ?? []) walk(child, depth + 1)
  }
  const roots = Object.keys(tree.nodes).filter((id) => {
    const node = tree.nodes[id]!
    return !node.parent || !tree.nodes[node.parent]
  })
  if (tree.root && roots.includes(tree.root)) {
    roots.splice(roots.indexOf(tree.root), 1)
    roots.unshift(tree.root)
  }
  for (const root of roots) walk(root, 0)
  for (const id of Object.keys(tree.nodes)) walk(id, 0)
  return result
}

interface MessageLike {
  readonly id: string
  readonly type: string
}

const scope = <T extends MessageLike>(
  tree: Info,
  messages: readonly T[],
  options: { readonly links?: boolean; readonly includeCompaction?: boolean } = {},
) => {
  if (Object.keys(tree.nodes).length === 0) return []
  const position = new Map<string, number>()
  messages.forEach((message, index) => {
    if (tree.nodes[message.id]) position.set(message.id, index)
  })
  const active = tree.active
  if (!active || !position.has(active)) return [...messages]
  const activePath = path(tree, active).filter((id) => position.has(id))
  if (activePath.length === 0) return [...messages]
  const linked: string[] = []
  if (options.links) {
    for (const id of tree.nodes[active]?.links ?? []) {
      if (!tree.nodes[id] || !position.has(id) || activePath.includes(id) || linked.includes(id)) continue
      const linkedPath = path(tree, id).filter((node) => position.has(node))
      const common = linkedPath.findLastIndex((node) => activePath.includes(node))
      for (const node of linkedPath.slice(common + 1)) {
        if (!linked.includes(node)) linked.push(node)
      }
    }
  }
  const allowed = [...activePath, ...linked]
  const starts = [...position.values()].sort((left, right) => left - right)
  const ranges = allowed.map((id) => {
    const start = position.get(id)!
    return {
      start: id === tree.root && start === 0 ? 0 : start,
      end: starts.find((value) => value > start) ?? messages.length,
    }
  })
  const selected: T[] = []
  const seen = new Set<number>()
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index++) {
      if (seen.has(index)) continue
      if (!options.includeCompaction && messages[index]!.type === "compaction") continue
      seen.add(index)
      selected.push(messages[index]!)
    }
  }
  return selected
}

export const visible = <T extends MessageLike>(tree: Info, messages: readonly T[]) =>
  scope(tree, messages, { includeCompaction: true })

export const historyMessages = <T extends MessageLike>(tree: Info, messages: readonly T[]) =>
  scope(tree, messages, { links: true, includeCompaction: true })
