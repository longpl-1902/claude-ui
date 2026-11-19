import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, Ref } from 'react'
import { routeConsoleInput } from '@shared/agentMessage'
import type { ConsoleRoute } from '@shared/agentMessage'
import type { ControlSessionInfo, FileSuggestion, ImageAttachment, OkResult, SlashCommandInfo } from '@shared/types'
import { useConsoleStore } from '../../store/useConsoleStore'
import { useControlStore } from '../../store/useControlStore'
import { selectCommands, useDetailsStore } from '../../store/useDetailsStore'
import { useExtensionsStore } from '../../store/useExtensionsStore'
import { Composer } from '../chat/Composer'
import { reasonText } from '../ui/reasonText'
import { findMention, insertMention, isAgentRouting, mentionOptionId, MentionPicker, relativePath } from './MentionPicker'
import type { MentionMatch } from './MentionPicker'
import { buildPalette, slashOptionId, SlashPalette } from './SlashPalette'
import type { PaletteItem } from './SlashPalette'

export const CTRL_ENTER_KEY = 'ac.ctrlEnterSend'
export const MAX_IMAGES = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES: ImageAttachment['mediaType'][] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_SUGGESTIONS = 50

const SEND_ERRORS: Record<string, string> = {
  'unknown-agent': 'No teammate with that name in this team.',
  'too-long': 'That message is too long (max 32000 characters).'
}

/** Prompt history per controlled session, kept in memory only. */
const HISTORY = new Map<string, string[]>()

/**
 * routeConsoleInput treats a leading `@word` as an agent. A leading `@src/a.ts` (a file mention, recognised by a path
 * separator or a dot) is not an agent name, so it is sent as plain text. Agent names still win when they match.
 */
export function routeMessage(input: string, agents: { id: string; name: string }[]): ConsoleRoute {
  const r = routeConsoleInput(input, agents)
  if (r.kind === 'error' && r.reason === 'unknown-agent') {
    const text = input.trim()
    const first = text.split(/\s/, 1)[0] ?? ''
    if (/[\\/.]/.test(first)) return { kind: 'send', text }
  }
  return r
}

const readCtrlEnter = (): boolean => {
  try {
    return window.localStorage.getItem(CTRL_ENTER_KEY) === '1'
  } catch {
    return false
  }
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('read failed'))
    fr.onload = () => {
      const s = typeof fr.result === 'string' ? fr.result : ''
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.readAsDataURL(file)
  })
}

interface Attached {
  id: number
  att: ImageAttachment
  src: string
}

export interface ControlComposerProps {
  /** The controlled session this prompt talks to; undefined when none (demo, external, nothing running). */
  control?: ControlSessionInfo
  demo: boolean
  disabled: boolean
  disabledReason?: ReactNode
  stateLabel?: string
  placeholder?: string
  /** DOM id and accessible name of the textarea (the lead console keeps `ac-prompt` / "Message the lead"). */
  id?: string
  ariaLabel?: string
  /** Extra toolbar content rendered after the built-in buttons (generic slot, e.g. session controls). */
  toolbar?: ReactNode
  textareaRef?: Ref<HTMLTextAreaElement>
}

/**
 * The prompt of both the Chat view and the lead console: the chat Composer plus the slash palette, @-mentions,
 * image attach/paste/drop, prompt history and the Ctrl+Enter option. Nothing is sent except by Enter / Send (R-19).
 */
export function ControlComposer(p: ControlComposerProps): JSX.Element {
  const { control } = p
  const team = useConsoleStore((s) => s.team)
  const draft = useConsoleStore((s) => s.consoleDraft)
  const setDraft = useConsoleStore((s) => s.setConsoleDraft)
  const submitDemo = useConsoleStore((s) => s.submitConsole)
  const send = useControlStore((s) => s.send)
  const sendRich = useDetailsStore((s) => s.sendRich)
  const fileSuggestions = useDetailsStore((s) => s.fileSuggestions)
  const loadDetails = useDetailsStore((s) => s.load)
  const details = useDetailsStore((s) => (control ? s.byControl[control.id] : undefined))
  const catalog = useExtensionsStore((s) => s.catalog)

  const controlled = control !== undefined && control.state !== 'exited'
  const isDraft = controlled && control.state === 'draft' && !control.sessionId
  const controlId = control?.id
  const cwd = control?.cwd ?? team.cwd ?? ''
  const usable = controlled && !p.disabled

  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const setTa = useCallback(
    (el: HTMLTextAreaElement | null) => {
      taRef.current = el
      if (typeof p.textareaRef === 'function') p.textareaRef(el)
      else if (p.textareaRef) (p.textareaRef as { current: HTMLTextAreaElement | null }).current = el
    },
    [p.textareaRef]
  )
  const fileRef = useRef<HTMLInputElement>(null)

  const [sendError, setSendError] = useState('')
  const [notice, setNotice] = useState('')
  const [active, setActive] = useState(-1)
  const [slashClosed, setSlashClosed] = useState(false)
  const [mentionClosed, setMentionClosed] = useState(false)
  const [caret, setCaret] = useState(0)
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([])
  const [images, setImages] = useState<Attached[]>([])
  const [ctrlEnter, setCtrlEnter] = useState(readCtrlEnter)
  const slots = useRef(0)
  const nextId = useRef(1)
  const histIdx = useRef(-1)
  const stash = useRef('')
  const pendingCaret = useRef<number | null>(null)

  // The session's own `initialize` data is local (no model call); load it once the session runs (PD1).
  useEffect(() => {
    if (controlId && controlled && !isDraft) void loadDetails(controlId)
  }, [controlId, controlled, isDraft, loadDetails])

  // Commands: the session's list (with descriptions), names from system/init, then the built-in fallback.
  const commands = useMemo<SlashCommandInfo[]>(() => {
    const base = selectCommands(controlId)(useDetailsStore.getState())
    const have = new Set(base.map((c) => c.name))
    const extra: SlashCommandInfo[] = (control?.slashCommands ?? [])
      .map((n) => (n.startsWith('/') ? n.slice(1) : n))
      .filter((n) => n !== '' && !have.has(n))
      .map((name) => ({ name, description: '', source: 'unknown' as const }))
    return [...base, ...extra]
    // `details` changes when the session pushes new commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlId, details, control?.slashCommands])

  const slashOpen = usable && !slashClosed && /^\/\S*$/.test(draft)
  const paletteItems = useMemo(() => (slashOpen ? buildPalette(commands, catalog, draft.slice(1)) : []), [slashOpen, commands, catalog, draft])
  const slashShown = slashOpen && paletteItems.length > 0

  const mention: MentionMatch | null = useMemo(() => {
    if (!usable || mentionClosed || slashOpen) return null
    const m = findMention(draft, Math.min(caret, draft.length))
    if (!m || isAgentRouting(m, team.agents.map((a) => a.name))) return null
    return m
  }, [usable, mentionClosed, slashOpen, draft, caret, team.agents])
  const mentionQuery = mention?.query
  const mentionOpen = mention !== null

  useEffect(() => {
    if (!mentionOpen || mentionQuery === undefined || !controlId) {
      setSuggestions([])
      return
    }
    let live = true
    void fileSuggestions(isDraft ? null : controlId, cwd, mentionQuery).then((r) => {
      if (live) setSuggestions(r.slice(0, MAX_SUGGESTIONS))
    })
    return () => {
      live = false
    }
  }, [mentionOpen, mentionQuery, controlId, isDraft, cwd, fileSuggestions])
  const mentionShown = mentionOpen && suggestions.length > 0

  useLayoutEffect(() => {
    const pos = pendingCaret.current
    const el = taRef.current
    if (pos !== null && el) {
      pendingCaret.current = null
      el.focus()
      el.setSelectionRange(pos, pos)
      setCaret(pos)
    }
  }, [draft])

  const onDraft = (v: string): void => {
    setDraft(v)
    setActive(-1)
    setSlashClosed(false)
    setMentionClosed(false)
    setSendError('')
    setNotice('')
    histIdx.current = -1
    setCaret(taRef.current?.selectionStart ?? v.length)
  }

  const pickSlash = (c: PaletteItem): void => {
    setDraft(`${c.label} `)
    setActive(-1)
    pendingCaret.current = c.label.length + 1
  }
  const pickMention = (path: string): void => {
    if (!mention) return
    const r = insertMention(draft, mention, path)
    setDraft(r.text)
    setActive(-1)
    pendingCaret.current = r.caret
  }

  // ---- images -------------------------------------------------------------------------------------------------
  const addFiles = (files: File[]): void => {
    setNotice('')
    for (const f of files) {
      if (!(IMAGE_TYPES as string[]).includes(f.type)) {
        setNotice(`"${f.name || 'file'}" is not a supported image. Use PNG, JPEG, GIF or WebP.`)
        continue
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setNotice(`"${f.name || 'image'}" is larger than 5 MB.`)
        continue
      }
      if (slots.current >= MAX_IMAGES) {
        setNotice(`You can attach up to ${MAX_IMAGES} images per message.`)
        break
      }
      slots.current++
      const id = nextId.current++
      const mediaType = f.type as ImageAttachment['mediaType']
      readBase64(f)
        .then((dataBase64) => {
          const att: ImageAttachment = { mediaType, dataBase64, ...(f.name ? { name: f.name } : {}) }
          setImages((s) => [...s, { id, att, src: `data:${mediaType};base64,${dataBase64}` }])
        })
        .catch(() => {
          slots.current--
          setNotice(`Could not read "${f.name || 'image'}".`)
        })
    }
  }
  const removeImage = (id: number): void => {
    slots.current = Math.max(0, slots.current - 1)
    setImages((s) => s.filter((i) => i.id !== id))
    setNotice('')
  }
  const clearImages = (): void => {
    slots.current = 0
    setImages([])
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!usable) return
    const cd = e.clipboardData
    const files = Array.from(cd?.files ?? [])
    if (files.length === 0)
      for (const it of Array.from(cd?.items ?? []))
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
    const pics = files.filter((f) => f.type.startsWith('image/'))
    if (pics.length === 0) return
    e.preventDefault() // the image is attached, never sent (R-19)
    addFiles(pics)
  }
  const hasFiles = (e: DragEvent<HTMLElement>): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (usable && hasFiles(e)) e.preventDefault()
  }
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    if (!usable || !hasFiles(e)) return
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  // ---- keyboard -----------------------------------------------------------------------------------------------
  const popCount = slashShown ? paletteItems.length : mentionShown ? suggestions.length : 0
  const pickActive = (): void => {
    const i = active >= 0 ? active : 0
    if (slashShown) pickSlash(paletteItems[i]!)
    else if (mentionShown) pickMention(relativePath(suggestions[i]!.path, cwd))
  }
  const history = (): string[] => (controlId ? (HISTORY.get(controlId) ?? []) : [])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (popCount > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % popCount)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a <= 0 ? popCount - 1 : a - 1))
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        pickActive()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (slashShown) setSlashClosed(true)
        else setMentionClosed(true)
      } else if (e.key === 'Enter' && active >= 0 && !e.shiftKey) {
        e.preventDefault()
        pickActive()
      }
      return
    }
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
    const el = e.currentTarget
    const h = history()
    if (e.key === 'ArrowUp' && h.length > 0 && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault()
      if (histIdx.current === -1) stash.current = draft
      histIdx.current = Math.min(histIdx.current + 1, h.length - 1)
      setDraft(h[h.length - 1 - histIdx.current]!)
      pendingCaret.current = 0
    } else if (e.key === 'ArrowDown' && histIdx.current >= 0 && !el.value.slice(el.selectionEnd).includes('\n')) {
      e.preventDefault()
      histIdx.current--
      const v = histIdx.current < 0 ? stash.current : h[h.length - 1 - histIdx.current]!
      setDraft(v)
      pendingCaret.current = v.length
    }
  }

  // ---- send ---------------------------------------------------------------------------------------------------
  const route = routeMessage(draft, team.agents)
  const targetAgent = route.kind === 'send' && route.targetAgentId ? team.agents.find((a) => a.id === route.targetAgentId) : undefined
  const target = targetAgent ? `to @${targetAgent.name}` : 'to lead'

  const onSend = (): void => {
    if (p.demo) {
      submitDemo()
      return
    }
    if (!controlled || !control) return
    const r = routeMessage(draft, team.agents)
    if (r.kind === 'error') {
      setSendError(SEND_ERRORS[r.reason] ?? '')
      return
    }
    setSendError('')
    const sent = draft
    const call: Promise<OkResult> =
      images.length > 0 ? sendRich(control.id, r.text, images.map((i) => i.att)) : send(control.id, r.text)
    void call.then((res) => {
      if (res.ok) {
        HISTORY.set(control.id, [...(HISTORY.get(control.id) ?? []), sent].slice(-50))
        histIdx.current = -1
        setDraft('')
        clearImages()
        setNotice('')
      } else setSendError(reasonText(res.reason))
    })
  }

  const popId = slashShown ? 'ac-slash-list' : mentionShown ? 'ac-mention-list' : undefined
  const activeId = active >= 0 && popCount > 0 ? (slashShown ? slashOptionId(active) : mentionOptionId(active)) : undefined
  const inputAria = popId
    ? { 'aria-autocomplete': 'list', 'aria-controls': popId, 'aria-activedescendant': activeId }
    : undefined

  const toolbar = (
    <>
      {!p.demo && (
        <>
          <button
            type="button"
            className="ac-composer__tool"
            disabled={!usable}
            title="Attach an image (PNG, JPEG, GIF or WebP, up to 5 MB each, 5 per message)"
            onClick={() => fileRef.current?.click()}
          >
            Attach image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            multiple
            style={{ display: 'none' }}
            aria-label="Attach image file"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </>
      )}
      <span className="ac-composer__switch" role="radiogroup" aria-label="Send with">
        <span className="ac-composer__switch-label" aria-hidden="true">
          Send with:
        </span>
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={ctrlEnter === v}
            className={`ac-composer__opt${ctrlEnter === v ? ' is-on' : ''}`}
            title={v ? 'Enter adds a new line and Ctrl+Enter sends' : 'Enter sends and Shift+Enter adds a new line'}
            onClick={() => {
              setCtrlEnter(v)
              try {
                window.localStorage.setItem(CTRL_ENTER_KEY, v ? '1' : '0')
              } catch {
                /* storage unavailable: keep the in-memory choice */
              }
            }}
          >
            {v ? 'Ctrl+Enter' : 'Enter'}
          </button>
        ))}
      </span>
      {p.toolbar}
    </>
  )

  const chips =
    images.length > 0 ? (
      <ul className="ac-attach" aria-label="Attached images">
        {images.map((i) => (
          <li key={i.id} className="ac-attach__chip">
            <img src={i.src} alt={i.att.name ?? 'Attached image'} />
            <span className="ac-attach__name">{i.att.name ?? 'image'}</span>
            <button type="button" aria-label={`Remove ${i.att.name ?? 'image'}`} onClick={() => removeImage(i.id)}>
              {'×'}
            </button>
          </li>
        ))}
      </ul>
    ) : undefined

  const popover = slashShown ? (
    <SlashPalette items={paletteItems} active={active} fallbackNote={isDraft} onPick={pickSlash} />
  ) : mentionShown ? (
    <MentionPicker items={suggestions} cwd={cwd} active={active} onPick={pickMention} />
  ) : undefined

  return (
    <Composer
      value={draft}
      onChange={onDraft}
      onSend={onSend}
      disabled={p.disabled}
      {...(p.disabledReason !== undefined ? { disabledReason: p.disabledReason } : {})}
      target={target}
      {...(p.stateLabel ? { stateLabel: p.stateLabel } : {})}
      {...(p.placeholder !== undefined ? { placeholder: p.placeholder } : {})}
      error={sendError || notice}
      {...(p.id ? { id: p.id } : {})}
      {...(p.ariaLabel ? { ariaLabel: p.ariaLabel } : {})}
      ctrlEnterSend={ctrlEnter}
      toolbar={toolbar}
      {...(chips ? { beforeInput: chips } : {})}
      {...(popover ? { suggestions: popover } : {})}
      {...(inputAria ? { inputAria } : {})}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      onSelect={() => setCaret(taRef.current?.selectionStart ?? 0)}
      textareaRef={setTa}
    />
  )
}
