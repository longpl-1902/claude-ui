/** Plain-language, one-sentence messages (with the next step) for every failure reason the main process returns. */
export const REASON_TEXT: Record<string, string> = {
  // launch blocks
  'account-locked': 'That account is locked. Unlock it in Accounts, then try again.',
  'unknown-account': 'That account no longer exists. Pick another account and try again.',
  'pty-unavailable': 'The terminal component is not available. Restart Agent Console and try again.',
  'claude-not-found': 'Claude Code was not found on PATH. Install it, then restart Agent Console.',
  'invalid-folder': 'That folder cannot be used. Pick an existing project folder and try again.',
  'needs-confirmation': 'Please review the warnings and confirm to continue.',
  'invalid-args': 'Some of the start options are not valid. Check them and try again.',
  'spawn-failed': 'Claude could not be started. Check that it runs in a terminal, then try again.',
  'session-live-elsewhere': 'That session is running somewhere else (VS Code or a terminal). Fork it instead of resuming it.',
  'nothing-running': 'Nothing is running in this session right now.',
  // process / project control
  'app-owned': 'This session was started by Agent Console, so use its own Stop button.',
  'not-registered': 'Agent Console is not tracking that process. Refresh the session list and try again.',
  'not-running': 'That session is not running any more. Start it again to continue.',
  'unexpected-process': 'The process did not look like Claude Code, so it was left alone.',
  'invalid-path': 'That path is not valid. Pick an existing file or folder and try again.',
  'opened-folder': 'That folder is already open. Pick a different project.',
  'no-project': 'No project is selected. Pick a git project first.',
  'node-not-found': 'Node.js was not found on PATH. Install Node 18+ to use hooks, then reopen this dialog.',
  'invalid-json': 'The settings file is not valid JSON. Fix or remove it, then reopen this dialog.',
  // hooks preview / apply
  'changed-since-preview': 'The settings file changed since the preview. Review the new preview and apply again.',
  expired: 'The preview expired. Preview the change again, then apply it.',
  'nothing-to-do': 'Nothing to change - hooks are already in that state.',
  'not-object': 'The settings file is not a JSON object. Fix it by hand, then reopen this dialog.'
}

export function isKnownReason(reason?: string): boolean {
  return !!reason && Object.prototype.hasOwnProperty.call(REASON_TEXT, reason)
}

export function reasonText(reason?: string): string {
  if (isKnownReason(reason)) return REASON_TEXT[reason as string]!
  return `Something went wrong (${reason || 'unknown'}).`
}
