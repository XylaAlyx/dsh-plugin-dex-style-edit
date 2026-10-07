/**
 * dsh-plugin-dex-style-edit — pure event-log resolution.
 *
 * Kept free of Cordis so the DSH session-log coordinates a fork needs can be
 * tested against real event streams without booting the host.
 */

/** A structural failure the browser half can act on. */
export class ClientError extends Error {
  /**
   * @param code - stable machine code returned to the browser.
   * @param message - human-readable detail.
   */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * Whether one event is a direct, user-authored message.
 *
 * A session log carries `user/message` for injected context too
 * (`agent-instructions`, `runtime-context`, `skill-catalog`, `model-selection`),
 * and only the events whose source is the ordinary `user` kind own a bubble the
 * user can edit. `surfaceOp === 'append'` excludes surface replacements, which
 * reuse the event type without being authored messages.
 * @param event - candidate session event.
 * @returns whether the event is an editable direct user message.
 */
export function isDirectUserMessage(event) {
  if (event?.type !== 'user/message') return false
  if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return false
  const source = event.data?.source
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return false
  return source.kind === 'user'
}

/**
 * Flatten a `user/message` content list into its plain text.
 * @param content - the event's content blocks.
 * @returns the concatenated text of every text block.
 */
export function contentText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

/**
 * Count the blocks an inline text editor cannot round-trip.
 * @param content - the event's content blocks.
 * @returns how many attachments or other non-text blocks the message carries.
 */
export function nonTextBlockCount(content) {
  if (!Array.isArray(content)) return 0
  let count = 0
  for (const block of content) if (block?.type !== 'text') count += 1
  return count
}

/**
 * Resolve the selected message into the coordinates a fork needs.
 *
 * `forkAtSeq` is the `turn/end` seq of the turn *before* the selected message —
 * exactly the inclusive prefix `sessions.fork({ atSeq })` keeps, so the edited
 * text becomes the fork's own opening message. It is absent when the message
 * belongs to the first turn, where the fork must instead create a blank session
 * in the same working directory.
 * @param events - the session's events in log order.
 * @param messageSeq - seq of the direct user message being edited.
 * @returns turn identity, the previous turn's end seq, and the message text.
 * @throws {ClientError} when the seq names no editable message.
 */
export function resolveMessage(events, messageSeq) {
  if (!Array.isArray(events)) {
    throw new ClientError('SESSION_NOT_FOUND', 'session has no readable events')
  }
  const message = events.find(
    (event) => isDirectUserMessage(event) && event.seq === messageSeq,
  )
  if (message === undefined) {
    throw new ClientError(
      'MESSAGE_NOT_FOUND',
      `session has no direct user message at seq ${String(messageSeq)}`,
    )
  }

  let start
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.seq < messageSeq) {
      start = event
      break
    }
  }
  const turn = start?.data?.turn
  if (start === undefined || !Number.isSafeInteger(turn) || turn < 0) {
    throw new ClientError('MESSAGE_NOT_FOUND', 'the selected message has no turn start')
  }

  // Only a turn's opening message starts a request; editing a steered follow-up
  // inside a running turn has no fork point of its own.
  const opening = events.find(
    (event) => isDirectUserMessage(event)
      && event.seq > start.seq
      && event.seq <= messageSeq,
  )
  if (opening?.seq !== messageSeq) {
    throw new ClientError(
      'NOT_TURN_OPENING',
      'only the opening user message of a turn can be edited',
    )
  }

  let previousEnd
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/end' && event.seq < start.seq) {
      previousEnd = event
      break
    }
  }

  return {
    turn,
    turnStartSeq: start.seq,
    ...(previousEnd === undefined ? {} : { forkAtSeq: previousEnd.seq }),
    text: contentText(message.data?.content),
    attachmentCount: nonTextBlockCount(message.data?.content),
  }
}

/**
 * Read every event of one session, live or cold.
 * @param ctx - Cordis context carrying the session services.
 * @param sessionId - session identity to read.
 * @returns the session's events in log order.
 */
export async function readSessionEvents(ctx, sessionId) {
  const live = ctx.sessions?.get?.(sessionId)
  if (live !== undefined && live !== null) {
    if (typeof live.snapshotEvents === 'function') return live.snapshotEvents()
    if (Array.isArray(live.events)) return live.events
  }
  const stored = await ctx.sessionQuery.readSession(sessionId)
  if (stored === undefined || stored === null) {
    throw new ClientError('SESSION_NOT_FOUND', `unknown session ${sessionId}`)
  }
  return stored.events ?? []
}
