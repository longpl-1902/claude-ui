package control

import (
	"os"
	"testing"

	"github.com/longpl-1902/claude-ui/internal/control/fakeclaude"
)

func TestMain(m *testing.M) {
	fakeclaude.MaybeRun()
	os.Exit(m.Run())
}
