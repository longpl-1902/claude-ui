import { useId, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PermissionAnswer, PermissionPrompt } from '@shared/types'
import { Button } from '../ui/Button'
import { PlanCard, QuestionCard, parseQuestions } from './QuestionCard'
import './teamCenter.css'

const PREVIEW_LINES = 12

export interface PermissionCardProps {
  prompt: PermissionPrompt
  onAnswer(a: PermissionAnswer): void
  /** Needed by the plan card for "auto-accept edits" and the plan-file fallback. */
  controlId?: string
}

/** One pending tool permission (D7). Not modal: the log and prompt stay usable. */
export function PermissionCard(p: PermissionCardProps): JSX.Element {
  if (p.prompt.toolName === 'ExitPlanMode')
    return <PlanCard prompt={p.prompt} onAnswer={p.onAnswer} {...(p.controlId ? { controlId: p.controlId } : {})} />
  const questions = p.prompt.toolName === 'AskUserQuestion' ? parseQuestions(p.prompt) : null
  if (questions) return <QuestionCard prompt={p.prompt} questions={questions} onAnswer={p.onAnswer} />
  return <GenericPermissionCard prompt={p.prompt} onAnswer={p.onAnswer} />
}

function GenericPermissionCard({ prompt, onAnswer }: PermissionCardProps): JSX.Element {
  const titleId = useId()
  const [expanded, setExpanded] = useState(false)
  const [denying, setDenying] = useState(false)
  const [message, setMessage] = useState('')

  const lines = prompt.inputPreview.split('\n')
  const clipped = !expanded && lines.length > PREVIEW_LINES
  const shown = clipped ? lines.slice(0, PREVIEW_LINES).join('\n') : prompt.inputPreview

  const onDeny = (e: MouseEvent): void => {
    if (e.shiftKey) setDenying(true)
    else onAnswer({ behavior: 'deny' })
  }

  return (
    <div className="ac-tc-perm" role="alertdialog" aria-labelledby={titleId} aria-modal="false">
      <div className="ac-tc-perm__title" id={titleId}>
        {prompt.displayName} wants to run
      </div>
      {prompt.inputPreview !== '' && (
        <pre className="ac-tc-perm__preview" tabIndex={0} aria-label="Request details">
          {shown}
        </pre>
      )}
      {lines.length > PREVIEW_LINES && (
        <button type="button" className="ac-tc-linkbtn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'show less' : `show more (${lines.length - PREVIEW_LINES} more lines)`}
        </button>
      )}
      {prompt.decisionReason && <p className="ac-tc-perm__reason">{prompt.decisionReason}</p>}
      {denying ? (
        <div className="ac-tc-perm__actions">
          <input
            className="ac-tc-perm__msg"
            aria-label="Reason for denying"
            placeholder="Tell Claude why (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            size="sm"
            variant="danger"
            onClick={() => onAnswer({ behavior: 'deny', ...(message.trim() ? { message: message.trim() } : {}) })}
          >
            Send deny
          </Button>
          <Button size="sm" onClick={() => setDenying(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="ac-tc-perm__actions">
          <Button size="sm" variant="primary" onClick={() => onAnswer({ behavior: 'allow', scope: 'once' })}>
            Allow
          </Button>
          {prompt.canAllowSession && (
            <Button size="sm" onClick={() => onAnswer({ behavior: 'allow', scope: 'session' })}>
              Allow for this session
            </Button>
          )}
          <Button size="sm" variant="danger" title="Shift+click to add a reason" onClick={onDeny}>
            Deny
          </Button>
        </div>
      )}
    </div>
  )
}
