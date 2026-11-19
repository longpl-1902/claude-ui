import type { ChangedFile } from '@shared/types'
import { shortenPath } from '@shared/displayPath'
import { CopyButton } from '../chat/CopyButton'
import { useConsoleStore } from '../../store/useConsoleStore'
import { rendererPlatform } from '../../store/useWorkspaceStore'

export function FilesTab({ files }: { files: ChangedFile[] }): JSX.Element {
  const demo = useConsoleStore((s) => s.team.source === 'demo')
  const root = useConsoleStore((s) => s.sessions.find((x) => x.sessionId === s.team.sessionId)?.project?.root ?? s.team.cwd)
  const platform = rendererPlatform()
  return (
    <div className="insp-files">
      {files.map((f) => {
        const p = shortenPath(f.path, { ...(root ? { root } : {}), platform })
        return (
          <div key={f.path} className="insp-file">
            <span className="insp-file__path" title={p.full}>
              {p.short}
            </span>
            <CopyButton text={p.full} label={`path ${p.short}`} />
            <span className="insp-file__add">+{f.added}</span>
            <span className="insp-file__del">−{f.removed}</span>
          </div>
        )
      })}
      {files.length === 0 && <span className="insp-empty">No file changes from Edit/Write yet</span>}
      <button
        type="button"
        className="insp-link"
        disabled={!demo}
        title={demo ? undefined : 'Diffs arrive in Phase 5'}
        onClick={() => undefined}
      >
        Open full diff against main
      </button>
    </div>
  )
}
