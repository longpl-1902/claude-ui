//go:build !t13

package app

import (
	"errors"

	"github.com/longpl-1902/claude-ui/internal/control"
)

// Stand-ins for the T13 runtime types until internal/control/runner.go lands.
// Field sets mirror spec 2.1 exactly; delete this file at merge time (the
// build-tagged controller.go then aliases the real types).

type ctlAnswer struct {
	Allow      bool
	ForSession bool
	Message    string
	Answers    map[string]string
}

type ctlInfo struct {
	State                  control.State
	SessionID, Model, Mode string
	Version                string
	Commands, Models       []string
	CostUSD, CtxPct        float64
	PID                    int
	Error                  string
	Spawns                 int
}

var (
	errNotBusy        = errors.New("not busy")
	errNotLive        = errors.New("not live")
	errUnknownRequest = errors.New("unknown request")
)

// ctlSpawner stands in for control.Spawner until T13 lands.
type ctlSpawner interface{}
