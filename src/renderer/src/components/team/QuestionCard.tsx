import { useEffect, useId, useState } from 'react'
import type { PermissionAnswer, PermissionPrompt } from '@shared/types'
import { useControlStore } from '../../store/useControlStore'
import { useDetailsStore } from '../../store/useDetailsStore'
import { Button } from '../ui/Button'
import '../chat/chat.css'

export interface QuestionOption {
  label: string
  description?: string
}
export interface Question {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function parseInput(prompt: PermissionPrompt): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(prompt.inputPreview)
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

/** The AskUserQuestion questions, or null when the preview is not (complete) JSON in the expected shape. */
export function parseQuestions(prompt: PermissionPrompt): Question[] | null {
  const input = parseInput(prompt)
  const qs = input?.questions
  if (!Array.isArray(qs) || qs.length === 0) return null
  const out: Question[] = []
  for (const q of qs) {
    if (!isObj(q)) return null
    const question = str(q.question)
    if (!question) return null
    const options: QuestionOption[] = []
    if (Array.isArray(q.options))
      for (const o of q.options) {
        if (!isObj(o) || !str(o.label)) continue
        options.push({ label: str(o.label)!, ...(str(o.description) ? { description: str(o.description)! } : {}) })
      }
    out.push({ question, ...(str(q.header) ? { header: str(q.header)! } : {}), options, multiSelect: q.multiSelect === true })
  }
  return out
}

export const parsePlan = (prompt: PermissionPrompt): string | null => str(parseInput(prompt)?.plan) ?? null

interface Pick {
  labels: string[]
  other: string
  otherOn: boolean
}

const joinAnswer = (p: Pick): string => [...p.labels, ...(p.otherOn && p.other.trim() ? [p.other.trim()] : [])].join(', ')

export interface CardProps {
  prompt: PermissionPrompt
  onAnswer(a: PermissionAnswer): void
  controlId?: string
}

/** AskUserQuestion: answers go back as `answers` {question -> label(s) comma-joined} (updatedInput.answers). */
export function QuestionCard({ prompt, questions, onAnswer }: CardProps & { questions: Question[] }): JSX.Element {
  const uid = useId()
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const get = (q: string): Pick => picks[q] ?? { labels: [], other: '', otherOn: false }
  const patch = (q: string, f: (p: Pick) => Pick): void => setPicks((s) => ({ ...s, [q]: f(get(q)) }))
  const ready = questions.every((q) => joinAnswer(get(q.question)) !== '')

  const submit = (): void => {
    const answers: Record<string, string> = {}
    for (const q of questions) answers[q.question] = joinAnswer(get(q.question))
    onAnswer({ behavior: 'allow', answers })
  }

  return (
    <div
      className="ac-tc-perm ac-qcard"
      role="alertdialog"
      aria-label="Claude has a question"
      aria-modal="false"
      data-request={prompt.requestId}
    >
      <div className="ac-tc-perm__title">Claude has a question</div>
      {questions.map((q, qi) => {
        const p = get(q.question)
        const name = `${uid}-${qi}`
        const kind = q.multiSelect ? 'checkbox' : 'radio'
        return (
          <fieldset key={q.question} className="ac-qcard__q">
            <legend>
              {q.header && <span className="ac-qcard__header">{q.header}</span>}
              {q.question}
            </legend>
            {q.options.map((o) => {
              const on = p.labels.includes(o.label)
              return (
                <label key={o.label} className="ac-qcard__opt">
                  <input
                    type={kind}
                    name={name}
                    checked={on}
                    onChange={() =>
                      patch(q.question, (s) =>
                        q.multiSelect
                          ? { ...s, labels: on ? s.labels.filter((l) => l !== o.label) : [...s.labels, o.label] }
                          : { ...s, labels: [o.label], otherOn: false }
                      )
                    }
                  />
                  <span>
                    <span className="ac-qcard__label">{o.label}</span>
                    {o.description && <span className="ac-qcard__desc">{o.description}</span>}
                  </span>
                </label>
              )
            })}
            <label className="ac-qcard__opt">
              <input
                type={kind}
                name={name}
                checked={p.otherOn}
                onChange={() =>
                  patch(q.question, (s) => (q.multiSelect ? { ...s, otherOn: !s.otherOn } : { ...s, labels: [], otherOn: true }))
                }
              />
              <span className="ac-qcard__label">Other</span>
            </label>
            {p.otherOn && (
              <textarea
                className="ac-tc-perm__msg ac-qcard__other"
                aria-label={`Other answer for: ${q.question}`}
                placeholder="Type your answer (Ctrl+Enter sends)"
                rows={2}
                autoFocus
                value={p.other}
                onChange={(e) => {
                  const t = e.currentTarget
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight + 2, 200)}px`
                  patch(q.question, (s) => ({ ...s, other: e.target.value }))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
            )}
          </fieldset>
        )
      })}
      <div className="ac-tc-perm__actions">
        <Button size="sm" variant="primary" disabled={!ready} onClick={submit}>
          Send answers
        </Button>
        <Button
          size="sm"
          title="Claude is told you skipped the question and carries on"
          onClick={() => onAnswer({ behavior: 'deny', message: 'User dismissed the question' })}
        >
          Skip question
        </Button>
      </div>
    </div>
  )
}

/** ExitPlanMode: the plan as plain preformatted text (never HTML) with approve / keep-planning actions. */
export function PlanCard({ prompt, onAnswer, controlId }: CardProps): JSX.Element {
  const setMode = useControlStore((s) => s.setMode)
  const getPlan = useDetailsStore((s) => s.getPlan)
  const inline = parsePlan(prompt)
  const [plan, setPlan] = useState<string | null>(inline)
  const [feedback, setFeedback] = useState('')
  const titleId = useId()

  // The request preview is clipped at ~2 KB; fall back to the plan file when it does not parse.
  useEffect(() => {
    if (inline !== null || !controlId) return
    let live = true
    void getPlan(controlId).then((r) => {
      if (live && r.exists && r.content) setPlan(r.content)
    })
    return () => {
      live = false
    }
  }, [inline, controlId, getPlan])

  return (
    <div className="ac-tc-perm ac-plan" role="alertdialog" aria-labelledby={titleId} aria-modal="false">
      <div className="ac-tc-perm__title" id={titleId}>
        Claude has a plan
      </div>
      <pre className="ac-tc-perm__preview ac-plan__text" tabIndex={0} aria-label="Plan">
        {plan ?? prompt.inputPreview}
      </pre>
      <input
        className="ac-tc-perm__msg"
        aria-label="Feedback for Claude (optional)"
        placeholder="Feedback if you want changes (optional)"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className="ac-tc-perm__actions">
        <Button size="sm" variant="primary" onClick={() => onAnswer({ behavior: 'allow' })}>
          Approve plan
        </Button>
        <Button
          size="sm"
          disabled={!controlId}
          onClick={() => {
            onAnswer({ behavior: 'allow' })
            if (controlId) void setMode(controlId, 'acceptEdits')
          }}
        >
          Approve + auto-accept edits
        </Button>
        <Button
          size="sm"
          onClick={() => onAnswer({ behavior: 'deny', ...(feedback.trim() ? { message: feedback.trim() } : {}) })}
        >
          Keep planning
        </Button>
      </div>
    </div>
  )
}
