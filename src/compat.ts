import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"

export interface SessionHistoryEvent {
  readonly session: Session.Info
  readonly messages: ReadonlyArray<SessionMessage.Info>
  result?: ReadonlyArray<SessionMessage.Info>
}

export interface SessionCompactionEvent {
  readonly sessionID: Session.ID
  metadata?: Record<string, unknown>
}

export type SessionHook = {
  (name: "history", callback: (event: SessionHistoryEvent) => void | Promise<void>): Promise<unknown>
  (name: "compaction", callback: (event: SessionCompactionEvent) => void | Promise<void>): Promise<unknown>
}

export const sessionHook = (session: object) => (session as { hook: SessionHook }).hook

export interface MessageFilterInput {
  readonly sessionID: string
  readonly messages: readonly SessionMessage.Info[]
}

export type MessageFilter = (input: MessageFilterInput) => readonly SessionMessage.Info[]

export interface MessageFilters {
  filter(callback: MessageFilter): () => void
}

export const messageFilters = (ui: object) => (ui as { messages: MessageFilters }).messages