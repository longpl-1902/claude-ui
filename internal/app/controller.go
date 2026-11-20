package app

import "github.com/longpl-1902/claude-ui/internal/control"

// This file links the real runtime (internal/control, T13). At merge time the
// orchestrator removes the build tag above and deletes controller_pre.go.

type (
	ctlAnswer  = control.Answer
	ctlInfo    = control.Info
	ctlSpawner = control.Spawner
)

var (
	errNotBusy        = control.ErrNotBusy
	errNotLive        = control.ErrNotLive
	errUnknownRequest = control.ErrUnknownRequest
)

func init() {
	defaultNewController = func(o Options) newControllerFunc {
		return func(l control.Launch) controller {
			return control.New(l, control.Deps{Spawner: o.Spawner, BaseEnv: o.Env})
		}
	}
}
