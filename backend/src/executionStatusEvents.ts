import { EventEmitter } from 'node:events'
import type { SessionRecord } from './types.js'

const emitter = new EventEmitter()
emitter.setMaxListeners(200)

export function subscribeExecutionStatus(sessionId: string, listener: (session: SessionRecord) => void) {
  const channel = channelName(sessionId)
  emitter.on(channel, listener)
  return () => {
    emitter.off(channel, listener)
  }
}

export function emitExecutionStatus(session: SessionRecord) {
  emitter.emit(channelName(session.id), session)
}

function channelName(sessionId: string) {
  return `execution-status:${sessionId}`
}
