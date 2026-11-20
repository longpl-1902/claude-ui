package app

import (
	"os"
	"testing"

	"github.com/longpl-1902/claude-ui/internal/control/fakeclaude"
)

// TestMain turns the test binary into the scripted fake claude when it is
// spawned with AC_FAKE_CLAUDE set; the e2e tests use os.Args[0] as the claude
// path. No real claude is ever started (R-19).
func TestMain(m *testing.M) {
	fakeclaude.MaybeRun()
	os.Exit(m.Run())
}
