//go:build windows

package app

import (
	"os"
	"os/exec"
	"testing"
)

func TestIsProcessAliveWindows(t *testing.T) {
	if !isProcessAlive(os.Getpid()) {
		t.Fatal("own pid should be alive")
	}
	if processStart(os.Getpid()) == 0 {
		t.Fatal("own start time should be known")
	}
	cmd := exec.Command("cmd", "/c", "exit", "0")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	if isProcessAlive(cmd.Process.Pid) {
		t.Fatal("finished child should be dead")
	}
	if isProcessAlive(0) || isProcessAlive(-1) {
		t.Fatal("pid <= 0 must be dead")
	}
}
