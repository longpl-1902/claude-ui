import { useEffect, useState } from 'react'

/** Accounts > Appearance: whether the pop-out windows that were open at quit come back on the next start. */
export function ReopenWindowsToggle(): JSX.Element | null {
  const [on, setOn] = useState<boolean | null>(null)
  const win = window.api?.windows
  const getPrefs = win?.getPrefs
  const setPrefs = win?.setPrefs

  useEffect(() => {
    if (!getPrefs) return
    let alive = true
    void getPrefs().then(
      (p) => {
        if (alive) setOn(p.reopenOnStart)
      },
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [getPrefs])

  if (on === null || !getPrefs || !setPrefs) return null

  const change = (v: boolean): void => {
    setOn(v)
    void setPrefs({ reopenOnStart: v }).then(
      (r) => {
        if (!r.ok) setOn(!v)
      },
      () => setOn(!v)
    )
  }

  return (
    <label className="ac-acc-sub">
      <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} /> Reopen pop-out windows on start
    </label>
  )
}
