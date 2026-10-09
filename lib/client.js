/**
 * dsh-plugin-dex-style-edit — browser half.
 *
 * Replaces the shipped `key: 'user'` renderer for `conversation.chat.node` with
 * a faithful copy of the same bubble that also carries an Edit action. Editing
 * opens a textarea inside the bubble; saving forks the session at the turn
 * *before* that message, opens the fork in place of the current view, and puts
 * the edited text into the composer so the turn can be re-issued.
 *
 * Why the renderer is replaced instead of extended: DSH ships no slot for
 * user-message actions — the only message action area is
 * `conversation.chat.assistant-actions`, which serves finalized assistant turns.
 * `conversation.chat.node` registers at priority -1 so this entry shadows the
 * shipped one (the registry renders the lowest priority).
 *
 * DSH session logs are append-only with no truncation API, so the fork is the
 * only mechanism that can change a past message. It keeps the current files and
 * worktree state exactly as they are.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-dex-style-edit',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const PLUGIN_ID = 'dsh-plugin-dex-style-edit'
    const ROUTE = 'dex-style-edit/resolve'
    const HASH = 'dex'

    const {
      IconBranchOutlineRegular,
      IconCheckOutlineRegular,
      IconCopyOutlineRegular,
      IconEditOutlineRegular,
      JsonBlock,
      Tooltip,
      projectUserText,
      writeClipboard,
    } = primitives

    /**
     * Split one message's content blocks the same way the shipped bubble does.
     * @param content - the node's content blocks.
     * @returns text, attachments, and any block the bubble cannot represent.
     */
    function contentParts(content) {
      const texts = []
      const attachments = []
      const rest = []
      for (const block of content ?? []) {
        if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
        else if (block?.type === 'image' && block.attachment !== undefined) {
          attachments.push({ type: 'image', image: { attachment: block.attachment } })
        } else if (block?.type === 'file' && block.attachment !== undefined) {
          attachments.push({ type: 'file', file: block.attachment })
        } else rest.push(block)
      }
      return { text: texts.join(''), attachments, rest }
    }

    /**
     * One small icon button in the message action row.
     * @param props - label, icon, and click handler.
     * @returns the button element.
     */
    function ActionButton({ label, icon, onClick, disabled = false, active = false }) {
      return React.createElement(
        Tooltip,
        { label, side: 'bottom' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: `${HASH}_action${active ? ` ${HASH}_actionActive` : ''}`,
            'aria-label': label,
            'aria-disabled': disabled || undefined,
            disabled,
            onClick,
          },
          icon,
        ),
      )
    }

    /**
     * The message action row: timestamp, copy, edit, branch.
     * @param props - event time, message text, and the edit/branch handlers.
     * @returns the action row.
     */
    function MessageActions({
      time,
      text,
      onEdit,
      editable,
      editHint,
      attachmentCount = 0,
      onBranch,
      branchEnabled,
      branchHint,
    }) {
      const [copied, setCopied] = React.useState(false)
      const timer = React.useRef(null)
      React.useEffect(() => () => {
        if (timer.current !== null) window.clearTimeout(timer.current)
      }, [])
      const onCopy = React.useCallback(() => {
        if (copied) return
        void writeClipboard(text).then((ok) => {
          if (!ok) return
          setCopied(true)
          timer.current = window.setTimeout(() => {
            timer.current = null
            setCopied(false)
          }, 1000)
        })
      }, [copied, text])

      const clock = time === undefined
        ? null
        : React.createElement(
            'span',
            { className: `${HASH}_time` },
            new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          )

      return React.createElement(
        'div',
        { className: `${HASH}_actions` },
        clock,
        React.createElement(ActionButton, {
          label: copied ? 'Copied' : 'Copy',
          icon: copied
            ? React.createElement(IconCheckOutlineRegular, null)
            : React.createElement(IconCopyOutlineRegular, null),
          onClick: onCopy,
        }),
        React.createElement(ActionButton, {
          label: editable === false
            ? (editHint ?? 'This message cannot be edited')
            : attachmentCount > 0
              ? `Edit this message and continue from here (${String(attachmentCount)} attachment${attachmentCount === 1 ? '' : 's'} will not carry over)`
              : 'Edit this message and continue from here',
          icon: React.createElement(IconEditOutlineRegular, null),
          onClick: onEdit,
          disabled: editable === false,
        }),
        React.createElement(ActionButton, {
          label: branchEnabled === false ? branchHint : 'Branch into a new conversation from here',
          icon: React.createElement(IconBranchOutlineRegular, null),
          onClick: onBranch,
          disabled: branchEnabled === false,
        }),
      )
    }

    /**
     * Inline editor that replaces the bubble while a message is being edited.
     * @param props - initial text, save/cancel handlers, and the busy flag.
     * @returns the editor.
     */
    function BubbleEditor({ initialText, onSave, onCancel, busy, error }) {
      const [value, setValue] = React.useState(initialText)
      const ref = React.useRef(null)

      React.useEffect(() => {
        const node = ref.current
        if (node === null) return
        node.focus()
        node.setSelectionRange(node.value.length, node.value.length)
      }, [])

      React.useLayoutEffect(() => {
        const node = ref.current
        if (node === null) return
        node.style.height = 'auto'
        node.style.height = `${String(node.scrollHeight)}px`
      }, [value])

      const submit = React.useCallback(() => {
        const text = value.trim()
        if (text === '' || busy) return
        onSave(text)
      }, [busy, onSave, value])

      return React.createElement(
        'div',
        { className: `${HASH}_editor` },
        React.createElement('textarea', {
          ref,
          className: `${HASH}_textarea`,
          value,
          spellCheck: false,
          disabled: busy,
          onChange: (event) => setValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          },
        }),
        error === undefined || error === null
          ? null
          : React.createElement('div', { className: `${HASH}_error` }, error),
        React.createElement(
          'div',
          { className: `${HASH}_editorBar` },
          React.createElement(
            'span',
            { className: `${HASH}_hint` },
            busy ? 'Forking and sending…' : 'Enter to send · Shift+Enter for a newline · Esc to cancel',
          ),
          React.createElement(
            'button',
            { type: 'button', className: `${HASH}_ghost`, onClick: onCancel, disabled: busy },
            'Cancel',
          ),
          React.createElement(
            'button',
            { type: 'button', className: `${HASH}_primary`, onClick: submit, disabled: busy },
            'Send from here',
          ),
        ),
      )
    }

    /** Resolution results by `${sessionId}\0${messageSeq}`, so a scroll or remount does not re-ask. */
    const resolveCache = new Map()

    /**
     * Ask the host for the fork coordinates of one message, once per message.
     * @param sessionId - session owning the message.
     * @param messageSeq - the message's event seq.
     * @returns the host's resolved payload.
     * @throws {Error} when the host rejects the request.
     */
    async function resolveAtHost(sessionId, messageSeq) {
      const key = `${String(sessionId)}\u0000${String(messageSeq)}`
      const cached = resolveCache.get(key)
      if (cached !== undefined) return await cached
      const pending = (async () => {
        const response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sessionId, messageSeq }),
        })
        let body
        try {
          body = await response.json()
        } catch {
          throw new Error(`dex-style-edit: unreadable response (${String(response.status)})`)
        }
        if (!body?.ok) throw new Error(String(body?.error ?? `request failed (${String(response.status)})`))
        return body
      })()
      resolveCache.set(key, pending)
      try {
        return await pending
      } catch (error) {
        // A transport failure is worth retrying on the next mount; a host
        // verdict is not, because the log it read from is immutable.
        resolveCache.delete(key)
        throw error
      }
    }

    /**
     * Cut a fork at the resolved boundary.
     * @param ctx - client Cordis context.
     * @param sessionId - source session.
     * @param forkAtSeq - the boundary the host resolved; always present here,
     *   because a message without one is not offered for editing.
     * @returns the child session id.
     */
    async function forkFromHere(ctx, sessionId, forkAtSeq) {
      return await ctx.sessions.fork({
        sessionId,
        atSeq: forkAtSeq,
        increaseTitle: true,
      })
    }

    /**
     * Open one session and wait until it is addressable.
     *
     * Navigation may remount the branch, and a freshly catalogued fork has no
     * retained binding until it does, so the binding is polled rather than
     * assumed.
     * @param ctx - client Cordis context.
     * @param sessionId - session to open.
     * @returns the session's binding, or undefined when it never materialized.
     */
    async function openAndBind(ctx, sessionId) {
      ctx.uiWorkspace.openSession(sessionId)
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const binding = ctx.sessions.binding(sessionId)
        if (binding !== undefined) return binding
        await new Promise((resolve) => { window.setTimeout(resolve, 50) })
      }
      return undefined
    }

    /**
     * The model the composer is pointing at for the next request.
     *
     * The `modelSelection` projection keeps the durable intent: `next` is the
     * choice made in the composer and not yet used, `lastUsed` is what the last
     * request ran with. The selector reads `next ?? catalog.default` for the same
     * reason, so preferring `next` is what makes "change the model, then send"
     * behave the way the user just saw it behave.
     * @param ctx - client Cordis context.
     * @param sessionId - the Session being edited.
     * @returns the pending choice, or undefined when none is recorded.
     */
    function pendingModelChoice(ctx, sessionId) {
      try {
        const projection = ctx.sessions.binding(sessionId)?.session?.projections
        const state = projection?.get?.('modelSelection')
        const choice = state?.next ?? state?.lastUsed
        if (typeof choice?.provider !== 'string' || typeof choice?.model !== 'string') return undefined
        return {
          provider: choice.provider,
          model: choice.model,
          ...(typeof choice.reasoningEffort === 'string' ? { reasoningEffort: choice.reasoningEffort } : {}),
        }
      } catch (failure) {
        ctx.logger?.warn?.(`[${PLUGIN_ID}] could not read the pending model selection`, failure)
        return undefined
      }
    }

    /**
     * Point a freshly forked Session at the composer's model choice.
     *
     * A fork copies the prefix before its cut, so a selection made after the
     * edited message is not inherited: without this call the edited message would
     * run on the child's own default instead of the model the user just picked.
     *
     * This must run before the prompt. The Agent resolves its model once per
     * request, so a later write would only affect the *next* turn.
     *
     * Failure is reported but not fatal: the message is not lost, it simply runs
     * on the Session's own model, and the user sees why.
     * @param ctx - client Cordis context.
     * @param childId - the forked Session.
     * @param choice - the composer's pending choice, when it has one.
     */
    async function applyModelChoice(ctx, childId, choice) {
      if (choice === undefined) return
      try {
        const result = await ctx.remote.session.selectModel({
          sessionId: childId,
          provider: choice.provider,
          model: choice.model,
          ...(choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort }),
        })
        if (result?.ok === false) {
          ctx.logger?.warn?.(
            `[${PLUGIN_ID}] the fork kept its own model: ${String(result.error?.code)} ${String(result.error?.message)}`,
          )
        }
      } catch (failure) {
        ctx.logger?.warn?.(`[${PLUGIN_ID}] could not set the fork's model`, failure)
      }
    }

    /**
     * Submit the edited text as the fork's own opening message.
     *
     * This is the path the composer takes for an idle session, so the turn
     * starts from the fork and the conversation continues with the edited text
     * rather than merely holding it in the draft.
     * @param binding - the child session's binding.
     * @param text - the edited message text.
     * @throws {Error} when the Host rejects the prompt.
     */
    async function sendToFork(binding, text) {
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (result?.ok !== true) {
        const detail = result?.error?.message
        throw new Error(`the forked conversation rejected the message${detail === undefined ? '' : `: ${String(detail)}`}`)
      }
    }

    /**
     * Archive the session the fork replaced.
     *
     * DSH logs are append-only, so the edit cannot consume the original log:
     * the fork is a new session and the original stays readable. Archiving it
     * retires it from the ordinary session list, which is what makes the result
     * read as an edit in place rather than as a branch beside the original.
     *
     * This is a follow-up, not part of the edit: the message is already running
     * on the fork, so a refusal here must not surface as an edit failure.
     * `stopActivity: false` keeps the call from cancelling a turn — the source
     * session is idle by construction (the edit action is only offered on an
     * idle conversation), so nothing is running to stop.
     * @param ctx - client Cordis context.
     * @param sessionId - the replaced session.
     */
    async function archiveReplaced(ctx, sessionId) {
      try {
        await ctx.uiWorkspace.archiveSession(sessionId, { stopActivity: false })
      } catch (failure) {
        ctx.logger?.warn?.(
          `[${PLUGIN_ID}] the replaced session ${sessionId} could not be archived; the edit itself succeeded`,
          failure,
        )
      }
    }

    /**
     * The `sidebar.session.row.leading` occupant: a branch glyph on every
     * Session the user derived from another one.
     *
     * DSH records the lineage on the Session header (`parentSession`, exposed to
     * the browser list as `parentId`) and flags spawned subagent children with
     * `origin: 'subagent'`. A row is therefore a fork branch exactly when it
     * carries a parent and is not a subagent. The Session header draws no
     * breadcrumb for those (its ancestry walk stops at the first non-subagent),
     * so this seat is the only place the lineage becomes visible.
     *
     * The seat is one 16px cell, and `ui-workspace` renders status dots there
     * instead whenever a row has a live status, so a running fork shows no
     * glyph until it settles.
     * @param props - the row's Session identity plus the standard Client props.
     * @returns the branch glyph, or null for a root Session.
     */
    function SessionForkBadge(props) {
      const { sessionId, useSessions } = props
      // The list mutates in place, so the identity probe keeps re-renders cheap
      // while still subscribing to every catalog change.
      useSessions((state) => state.ids)
      const parentId = useSessions((state) => state.byId[sessionId]?.parentId)
      const origin = useSessions((state) => state.byId[sessionId]?.origin)
      if (parentId === undefined || origin === 'subagent') return null

      const parentTitle = useSessions((state) => state.byId[parentId]?.displayTitle)
      return React.createElement(
        Tooltip,
        {
          label: parentTitle === undefined
            ? 'Branched from an earlier conversation'
            : `Branched from ${parentTitle}`,
          side: 'right',
        },
        React.createElement(
          'span',
          {
            className: `${HASH}_forkBadge`,
            'data-plugin': PLUGIN_ID,
            'data-fork-parent': parentId,
          },
          React.createElement(IconBranchOutlineRegular, null),
        ),
      )
    }

    /** Context carrying the client Cordis context down to the renderer. */
    const ContextRef = React.createContext(null)

    /**
     * The `key: 'user'` renderer.
     * @param props - keyed-slot owner props plus the standard client props.
     * @returns the message row.
     */
    function UserMessageNodeView(props) {
      const { node, sessionId } = props
      const renderMessageImages = props.renderMessageImages
      const forkAt = props.forkAt
      const data = node.data ?? {}
      const { text, attachments, rest } = contentParts(data.content)
      const [editing, setEditing] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      // undefined = still probing, null = not editable, object = resolved
      const [target, setTarget] = React.useState(undefined)

      const ctx = React.useContext(ContextRef)
      const compactImages = attachments.length > 1

      React.useEffect(() => {
        let live = true
        resolveAtHost(sessionId, node.anchorSeq).then(
          (resolved) => { if (live) setTarget(resolved) },
          (failure) => { if (live) setTarget(null); void failure },
        )
        return () => { live = false }
      }, [node.anchorSeq, sessionId])

      const editable = target !== undefined && target !== null && target.forkAtSeq !== undefined

      const commit = React.useCallback(async (nextText) => {
        if (ctx === null || target === undefined || target === null) {
          setError('dex-style-edit: client context unavailable')
          return
        }
        setBusy(true)
        setError(null)
        try {
          // Read the composer's choice before forking: it belongs to the Session
          // being replaced, and the child will not inherit it.
          const modelChoice = pendingModelChoice(ctx, sessionId)
          const childId = await forkFromHere(ctx, sessionId, target.forkAtSeq)
          // Point the child at that choice before its first turn starts.
          await applyModelChoice(ctx, childId, modelChoice)
          const binding = await openAndBind(ctx, childId)
          if (binding === undefined) {
            throw new Error('the forked conversation did not open')
          }
          await sendToFork(binding, nextText)
          setEditing(false)
          // Only once the fork is running: the user has already seen the view
          // move, so retiring the original cannot look like a failed edit.
          await archiveReplaced(ctx, sessionId)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }, [ctx, sessionId, target])

      return React.createElement(
        'div',
        {
          className: `${HASH}_userRow`,
          'data-plugin': PLUGIN_ID,
          'data-msg-seq': node.anchorSeq,
        },
        React.createElement(
          'div',
          { className: `${HASH}_userStack` },
          attachments.length > 0 && typeof renderMessageImages === 'function'
            ? React.createElement(
                'div',
                { className: `${HASH}_attachments` },
                attachments.map((attachment, index) => attachment.type === 'image'
                  ? React.createElement(
                      React.Fragment,
                      { key: `image:${String(index)}` },
                      renderMessageImages({ images: [attachment.image], align: 'end', compact: compactImages }),
                    )
                  : React.createElement(
                      'span',
                      { key: `file:${String(index)}`, className: `${HASH}_fileCard`, title: attachment.file?.name },
                      attachment.file?.name,
                    )),
              )
            : null,
          editing
            ? React.createElement(BubbleEditor, {
                initialText: text,
                busy,
                error,
                onSave: (nextText) => { void commit(nextText) },
                onCancel: () => { setEditing(false); setError(null) },
              })
            : (text !== '' || rest.length > 0)
              ? React.createElement(
                  'div',
                  { className: `${HASH}_bubble` },
                  projectUserText(text, data.referenceLabels ?? [], data.skillNames ?? [], 'skill', {
                    openFile: props.openFile,
                    openSkill: props.openSkill,
                  }),
                  rest.map((block, index) => React.createElement(JsonBlock, {
                    key: index,
                    label: 'Additional block',
                    payload: block,
                    truncatedLabel: (total) => `truncated, ${String(total)} blocks`,
                  })),
                )
              : null,
          Array.isArray(data.referenceLabels) && data.referenceLabels.length > 0
            ? React.createElement(
                'div',
                { className: `${HASH}_referenceSummary` },
                `References: ${data.referenceLabels.join(', ')}`,
              )
            : null,
        ),
        React.createElement(MessageActions, {
          time: data.time,
          text,
          onEdit: () => { setEditing(true) },
          editable,
          editHint: target === undefined
            ? 'Checking whether this message can be edited…'
            : 'The first message has no earlier point to continue from',
          attachmentCount: target?.attachmentCount ?? 0,
          onBranch: () => { forkAt(node.anchorSeq) },
          branchEnabled: true,
          branchHint: 'Branch into a new conversation from here',
        }),
      )
    }

    // `remote.session` carries the model-selection endpoint the composer's own
    // selector uses. Both services are already required by the shipped
    // ui-model-selection plugin, so declaring them cannot fail on a host where
    // the model selector itself works.
    const inject = ['slots', 'sessions', 'uiWorkspace', 'remote', 'remote.session']

    /**
     * Client plugin body.
     * @param ctx - client Cordis context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = PLUGIN_ID
        tag.textContent = `
.${HASH}_userRow{width:100%;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.${HASH}_userStack{min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702),82%);display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.${HASH}_bubble{background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);max-width:100%;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;padding:10px 16px}
.${HASH}_referenceSummary{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px))}
.${HASH}_attachments{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:100%}
.${HASH}_fileCard{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-elevated,var(--dsw-specific-bubble));color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.${HASH}_actions{height:calc(24px + var(--dsh-content-font-delta,0px));display:flex;align-items:center;gap:2px}
.${HASH}_time{font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-right:6px}
.${HASH}_action{width:calc(24px + var(--dsh-content-font-delta,0px));height:calc(24px + var(--dsh-content-font-delta,0px));border:none;background:none;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:4px;cursor:pointer}
.${HASH}_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.${HASH}_action:disabled{opacity:.4;cursor:default}
.${HASH}_action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.${HASH}_editor{width:min(calc(var(--dsh-chat-content-width,748px) * .702),82vw);display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-separator-primary);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-bubble);padding:8px}
.${HASH}_textarea{width:100%;box-sizing:border-box;border:none;outline:none;resize:none;overflow:hidden;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));min-height:calc(22px + var(--dsh-content-font-delta,0px))}
.${HASH}_error{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.${HASH}_editorBar{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.${HASH}_hint{margin-right:auto;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px)}
.${HASH}_ghost,.${HASH}_primary{border-radius:var(--dsw-radius-md);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:28px;height:28px;padding:0 10px;cursor:pointer;border:none}
.${HASH}_ghost{background:none;border:0.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.${HASH}_ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.${HASH}_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.${HASH}_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.${HASH}_ghost:disabled,.${HASH}_primary:disabled{opacity:.5;cursor:default}
.${HASH}_forkBadge{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.${HASH}_forkBadge svg{width:14px;height:14px}
`
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, `${PLUGIN_ID}: styles`)

      ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => {
        const Hosted = (componentProps) => React.createElement(
          ContextRef.Provider,
          { value: ctx },
          React.createElement(UserMessageNodeView, componentProps),
        )
        return ctx.slots.register(
          {
            name: 'conversation.chat.node',
            key: 'user',
            // the lowest priority wins, so -1 shadows the shipped renderer
            priority: -1,
          },
          Hosted,
        )
      }), `${PLUGIN_ID}: user-message renderer`)

      ctx.effect(() => ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register(
        {
          name: 'sidebar.session.row.leading',
          id: 'dex-style-edit.fork-badge',
          // after any other leading decoration, and it is the row's only one today
          order: 100,
        },
        SessionForkBadge,
      )), `${PLUGIN_ID}: session fork badge`)

      ctx.logger?.info?.(`[${PLUGIN_ID}] client half active`)
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = PLUGIN_ID
    return module.exports
  },
})
