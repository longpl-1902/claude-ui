import type { MailboxMessage } from '@shared/types'

export function MessagesTab({ messages }: { messages: MailboxMessage[] }): JSX.Element {
  return (
    <div className="insp-msgs">
      {messages.map((m, i) => (
        <div key={`${m.time}-${i}`} className="insp-msg">
          <span className="insp-msg__meta">
            <span className="insp-msg__peer">
              {m.direction === 'in' ? 'from' : 'to'} {m.peer}
            </span>{' '}
            · {m.time}
          </span>
          <span className="insp-msg__text">{m.text}</span>
        </div>
      ))}
    </div>
  )
}
