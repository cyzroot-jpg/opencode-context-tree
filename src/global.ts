
export type FileState = {
  readonly file: string
  readonly status: string
  readonly additions: number
  readonly deletions: number
}

export type Todo = {
  readonly content: string
  readonly status: string
}

export type ShellCommand = {
  readonly command: string
  readonly workdir?: string
}

export type State = {
  readonly files: Map<string, FileState>
  readonly todos: Todo[]
  readonly commands: ShellCommand[]
}

const MAX_FILES = 20
const MAX_TODOS = 30
const MAX_COMMANDS = 5

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const createState = (): State => ({ files: new Map(), todos: [], commands: [] })

const parseFiles = (metadata: unknown) => {
  if (!isRecord(metadata) || !Array.isArray(metadata.files)) return []
  return metadata.files.flatMap((item): FileState[] => {
    if (!isRecord(item) || typeof item.file !== "string") return []
    return [
      {
        file: item.file,
        status: typeof item.status === "string" ? item.status : "modified",
        additions: typeof item.additions === "number" ? item.additions : 0,
        deletions: typeof item.deletions === "number" ? item.deletions : 0,
      },
    ]
  })
}

const parseTodos = (metadata: unknown, output: unknown) => {
  const source = isRecord(metadata) && Array.isArray(metadata.todos) ? metadata.todos : undefined
  const value = source ?? (isRecord(output) && Array.isArray(output.todos) ? output.todos : undefined)
  if (!value) return
  return value.flatMap((item): Todo[] => {
    if (!isRecord(item) || typeof item.content !== "string" || !item.content) return []
    return [
      {
        content: item.content,
        status: typeof item.status === "string" ? item.status : "pending",
      },
    ]
  })
}

const setFile = (state: State, file: FileState) => {
  state.files.delete(file.file)
  state.files.set(file.file, file)
  while (state.files.size > MAX_FILES) {
    const oldest = state.files.keys().next()
    if (oldest.done) break
    state.files.delete(oldest.value)
  }
}

const setTodos = (state: State, todos: Todo[]) => {
  state.todos.splice(0, state.todos.length, ...todos.slice(0, MAX_TODOS))
}

export const apply = (state: State, tool: string, input: unknown, result: { output?: unknown; metadata?: unknown }) => {
  if (tool === "todowrite") {
    const todos = parseTodos(result.metadata, result.output)
    if (todos) setTodos(state, todos)
    return
  }
  if (tool === "edit" || tool === "patch") {
    for (const file of parseFiles(result.metadata)) setFile(state, file)
    return
  }
  if (tool === "write" && isRecord(result.output) && typeof result.output.resource === "string") {
    setFile(state, {
      file: result.output.resource,
      status: result.output.existed === true ? "modified" : "added",
      additions: 0,
      deletions: 0,
    })
    return
  }
  if (tool === "shell" && isRecord(input) && typeof input.command === "string") {
    state.commands.push({
      command: input.command,
      ...(typeof input.workdir === "string" ? { workdir: input.workdir } : {}),
    })
    if (state.commands.length > MAX_COMMANDS) state.commands.splice(0, state.commands.length - MAX_COMMANDS)
  }
}

const marker = (status: string) => {
  if (status === "completed") return "[✓]"
  if (status === "in_progress") return "[•]"
  if (status === "cancelled") return "[-]"
  return "[ ]"
}

export const renderState = (state: State, directory: string) => {
  const files = [...state.files.values()]
  if (files.length === 0 && state.todos.length === 0 && state.commands.length === 0) return
  const lines = [
    "<global-state>",
    "The workspace is shared by every context tree branch. These changes may have happened on another branch; " +
      "do not assume an earlier branch's files still match this state.",
    `Working directory: ${directory}`,
  ]
  if (files.length > 0) {
    lines.push("Changed files:")
    for (const file of files) {
      const stats = file.additions === 0 && file.deletions === 0 ? "" : `, +${file.additions} -${file.deletions}`
      lines.push(`- ${file.file} (${file.status}${stats})`)
    }
  }
  if (state.todos.length > 0) {
    lines.push("Latest todo list:")
    for (const todo of state.todos) lines.push(`- ${marker(todo.status)} ${todo.content}`)
  }
  if (state.commands.length > 0) {
    lines.push("Recent shell commands:")
    for (const command of state.commands) {
      lines.push(`- ${command.command}${command.workdir === undefined ? "" : ` (in ${command.workdir})`}`)
    }
  }
  lines.push("</global-state>")
  return lines.join("\n")
}

