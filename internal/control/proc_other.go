//go:build !windows

package control

import (
	"os/exec"
	"syscall"
)

type platProc struct{}

func commandFor(path string, args []string) *exec.Cmd {
	return exec.Command(path, args...)
}

func configureCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func (p *osProc) start() error { return p.cmd.Start() }

func (p *osProc) afterWait() {}

// killTree signals the whole process group (the child is its leader).
func (p *osProc) killTree() error {
	err := syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
	if err == syscall.ESRCH {
		return nil
	}
	return err
}
