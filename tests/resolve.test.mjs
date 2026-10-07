import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ClientError,
  contentText,
  isDirectUserMessage,
  nonTextBlockCount,
  resolveMessage,
} from '../lib/resolve.js'

/**
 * Build one direct user message event.
 * @param seq - event seq.
 * @param text - message text.
 * @param extra - additional content blocks.
 * @returns a session event shaped like the ones DSH writes.
 */
function userMessage(seq, text, extra = []) {
  return {
    type: 'user/message',
    seq,
    surfaceOp: 'append',
    data: {
      id: `message-${String(seq)}`,
      source: { kind: 'user' },
      content: [{ type: 'text', text }, ...extra],
    },
  }
}

/** Build one injected context message. */
function injected(seq, kind, text = 'context') {
  return {
    type: 'user/message',
    seq,
    surfaceOp: 'append',
    data: { id: `inject-${String(seq)}`, source: { kind, form: 'text' }, content: [{ type: 'text', text }] },
  }
}

/** A realistic three-turn session: two user turns and an assistant reply between them. */
function threeTurnSession() {
  return [
    { type: 'session', version: 4, id: 's' },
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    userMessage(2, 'first question'),
    injected(3, 'agent-instructions'),
    injected(4, 'runtime-context'),
    { type: 'assistant/message', seq: 6, data: {} },
    { type: 'turn/end', seq: 7, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 8, data: { turn: 2 } },
    userMessage(9, 'second question'),
    { type: 'turn/end', seq: 14, data: { turn: 2, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 15, data: { turn: 3 } },
    userMessage(16, 'third question'),
    { type: 'turn/end', seq: 20, data: { turn: 3, reason: { kind: 'completed' } } },
  ]
}

/**
 * Run a resolution that must fail and return its structured error.
 * @param events - session events to resolve against.
 * @param seq - message seq to resolve.
 * @returns the thrown ClientError.
 */
function expectFailure(events, seq) {
  try {
    resolveMessage(events, seq)
  } catch (error) {
    assert.ok(error instanceof ClientError, `expected ClientError, got ${String(error)}`)
    return error
  }
  throw new Error(`expected resolveMessage(${String(seq)}) to throw`)
}

test('the first message of a session has no fork anchor', () => {
  const resolved = resolveMessage(threeTurnSession(), 2)
  assert.equal(resolved.turn, 1)
  assert.equal(resolved.turnStartSeq, 1)
  assert.equal('forkAtSeq' in resolved, false)
  assert.equal(resolved.text, 'first question')
})

test('a later message forks at the previous turn end', () => {
  const resolved = resolveMessage(threeTurnSession(), 9)
  assert.equal(resolved.turn, 2)
  assert.equal(resolved.forkAtSeq, 7)
  assert.equal(resolved.text, 'second question')
})

test('the last message forks at the second turn end', () => {
  assert.equal(resolveMessage(threeTurnSession(), 16).forkAtSeq, 14)
})

test('injected context messages are not editable', () => {
  const events = threeTurnSession()
  const error = expectFailure(events, 3)
  assert.equal(error.code, 'MESSAGE_NOT_FOUND')
  assert.equal(isDirectUserMessage(events[3]), false)
})

test('a surface replacement is not an authored message', () => {
  const events = threeTurnSession()
  events.push({
    type: 'user/message',
    seq: 30,
    surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 },
    data: { id: 'summary', source: { kind: 'user' }, content: [{ type: 'text', text: 'summary' }] },
  })
  assert.equal(expectFailure(events, 30).code, 'MESSAGE_NOT_FOUND')
})

test('a steering message inside an open turn is rejected as not the opening message', () => {
  const events = threeTurnSession()
  // Drop turn 3's closer so it stays open, then append a steered follow-up.
  events.splice(events.findIndex((event) => event.type === 'turn/end' && event.data.turn === 3), 1)
  events.push(userMessage(21, 'steer'))
  const error = expectFailure(events, 21)
  assert.equal(error.code, 'NOT_TURN_OPENING')
})

test('an unknown seq is a not-found failure', () => {
  assert.equal(expectFailure(threeTurnSession(), 999).code, 'MESSAGE_NOT_FOUND')
})

test('contentText joins text blocks and ignores the rest', () => {
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'ab')
  assert.equal(contentText(undefined), '')
})

test('nonTextBlockCount counts attachments', () => {
  assert.equal(nonTextBlockCount([{ type: 'text', text: 'a' }]), 0)
  assert.equal(nonTextBlockCount([{ type: 'text' }, { type: 'image' }, { type: 'file' }]), 2)
  assert.equal(nonTextBlockCount(undefined), 0)
})

test('attachments are reported so the browser can warn about them', () => {
  const events = threeTurnSession()
  events[events.findIndex((event) => event.seq === 9)] = userMessage(9, 'with a screenshot', [{ type: 'image', attachment: { id: 'x' } }])
  const resolved = resolveMessage(events, 9)
  assert.equal(resolved.text, 'with a screenshot')
  assert.equal(resolved.attachmentCount, 1)
})
