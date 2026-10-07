/**
 * dsh-plugin-dex-style-edit — host half.
 *
 * Exposes one same-origin read-only endpoint that resolves "edit this sent
 * message and continue from there" for one direct user message:
 *
 *   POST /dex-style-edit/resolve   { sessionId, messageSeq }
 *     -> { ok, turn, turnStartSeq, forkAtSeq, text, attachmentCount }
 *
 * `forkAtSeq` is the `turn/end` seq of the turn *before* the selected message,
 * i.e. exactly the prefix DSH's own `sessions.fork({ atSeq })` keeps. It is
 * absent when the message belongs to the first turn, where the fork must
 * produce a blank session in the same working directory instead.
 *
 * This half never mutates a session: it only reads the event log. The browser
 * half performs the fork through the ordinary Session Controller service.
 */

import { ClientError, readSessionEvents, resolveMessage } from './resolve.js'

const HTTP_PATH = '/dex-style-edit/resolve'
const BODY_LIMIT = 16 * 1024
const PLUGIN_NAME = 'dsh-plugin-dex-style-edit'

/**
 * Whether a request comes from the DSH page itself.
 *
 * `ctx.webServer` carries no authentication of its own, so the route validates
 * every request: loopback authority, no cross-site fetch metadata, and an
 * Origin that matches Host. Failures close.
 * @param request - inbound Node request.
 * @returns an HTTP status to reject with, or null to proceed.
 */
function selfRejection(request) {
  try {
    const headers = request?.headers ?? {}
    let hostUrl
    try {
      hostUrl = new URL(`http://${String(headers.host ?? '')}`)
    } catch {
      return 403
    }
    const hostname = hostUrl.hostname.toLowerCase()
    const authority = hostUrl.host.toLowerCase()
    const loopback = hostname === '127.0.0.1'
      || hostname === 'localhost'
      || hostname === '[::1]'
      || hostname === '::1'
    if (!loopback) return 403
    if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      let originUrl
      try {
        originUrl = new URL(origin)
      } catch {
        return 403
      }
      if (originUrl.host.toLowerCase() !== authority) return 403
    }
    return null
  } catch {
    return 403
  }
}

/**
 * Read and parse one bounded JSON request body.
 * @param request - inbound Node request.
 * @returns the parsed body.
 * @throws {ClientError} when the body is missing, oversized, or not an object.
 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  await new Promise((resolve, reject) => {
    request.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > BODY_LIMIT) {
        reject(new ClientError('BAD_REQUEST', 'request body is too large'))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', resolve)
    request.on('error', reject)
  })
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ClientError('BAD_REQUEST', 'request body must be valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ClientError('BAD_REQUEST', 'request body must be an object')
  }
  return parsed
}

/**
 * Answer one request.
 * @param response - inbound Node response.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 */
function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(text)),
  })
  response.end(text)
}

/**
 * One resolved request.
 * @param ctx - Cordis context carrying the session services.
 * @param request - inbound Node request.
 * @param response - inbound Node response.
 */
async function handle(ctx, request, response) {
  const rejected = selfRejection(request)
  if (rejected !== null) {
    sendJson(response, rejected, { ok: false, code: 'FORBIDDEN', error: 'request rejected' })
    return
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'use POST' })
    return
  }
  try {
    const body = await readJsonBody(request)
    const { sessionId, messageSeq } = body
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new ClientError('BAD_REQUEST', 'sessionId must be a non-empty string')
    }
    if (!Number.isSafeInteger(messageSeq) || messageSeq < 0) {
      throw new ClientError('BAD_REQUEST', 'messageSeq must be a non-negative integer')
    }
    const events = await readSessionEvents(ctx, sessionId)
    const resolved = resolveMessage(events, messageSeq)
    sendJson(response, 200, { ok: true, sessionId, messageSeq, ...resolved })
  } catch (error) {
    const code = error instanceof ClientError ? error.code : 'RESOLVE_FAILED'
    const status = code === 'SESSION_NOT_FOUND' || code === 'MESSAGE_NOT_FOUND' ? 404 : 400
    if (code === 'RESOLVE_FAILED') {
      ctx.logger?.warn?.(`[${PLUGIN_NAME}] resolve failed: ${String(error?.stack ?? error)}`)
    }
    sendJson(response, status, {
      ok: false,
      code,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Cordis plugin body.
 *
 * Cordis throws when a context reads a service property it never injected, so
 * every service the resolver touches is declared here: `sessions` for live
 * logs, `sessionQuery` for cold ones, `webServer` for the route itself. Nothing
 * awaits an unrelated service.
 * @param root - plugin context.
 */
export function apply(root) {
  root.inject(['webServer', 'sessions', 'sessionQuery'], (ctx) => {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: HTTP_PATH,
        handler: (request, response) => handle(ctx, request, response),
      }),
      `${PLUGIN_NAME}.resolve-route`,
    )
  })
}

export default {
  name: PLUGIN_NAME,
  apply,
}
