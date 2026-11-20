package control

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

// Proc is a running child process (normally claude).
type Proc interface {
	Stdin() io.WriteCloser
	Stdout() io.Reader
	Stderr() io.Reader
	// Wait blocks until the process exits and returns its exit code.
	Wait() (code int, err error)
	// KillTree kills the process and all of its descendants.
	KillTree() error
	Pid() int
}

// Spawner starts child processes. Tests substitute their own.
type Spawner interface {
	Start(path string, args, env []string, cwd string) (Proc, error)
}

// DefaultSpawner is the OS implementation.
var DefaultSpawner Spawner = osSpawner{}

type osSpawner struct{}

type osProc struct {
	cmd    *exec.Cmd
	stdin  *os.File
	stdout *os.File
	stderr *os.File
	plat   platProc

	waitOnce sync.Once
	code     int
	werr     error
}

func (osSpawner) Start(path string, args, env []string, cwd string) (Proc, error) {
	if cwd != "" {
		st, err := os.Stat(cwd)
		if err != nil {
			return nil, fmt.Errorf("working folder %s: %w", cwd, err)
		}
		if !st.IsDir() {
			return nil, fmt.Errorf("working folder %s is not a directory", cwd)
		}
	}

	cmd := commandFor(path, args)
	cmd.Env = env
	cmd.Dir = cwd
	configureCmd(cmd)

	inR, inW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		closeAll(inR, inW)
		return nil, err
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		closeAll(inR, inW, outR, outW)
		return nil, err
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = inR, outW, errW

	p := &osProc{cmd: cmd, stdin: inW, stdout: outR, stderr: errR}
	if err := p.start(); err != nil {
		closeAll(inR, inW, outR, outW, errR, errW)
		return nil, fmt.Errorf("start %s (cwd %s): %w", path, cwd, err)
	}
	// The child owns its ends now.
	closeAll(inR, outW, errW)
	return p, nil
}

func closeAll(fs ...*os.File) {
	for _, f := range fs {
		_ = f.Close()
	}
}

func (p *osProc) Stdin() io.WriteCloser { return p.stdin }
func (p *osProc) Stdout() io.Reader     { return p.stdout }
func (p *osProc) Stderr() io.Reader     { return p.stderr }

func (p *osProc) Pid() int {
	if p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

// Wait is safe to call more than once; later calls return the first result.
func (p *osProc) Wait() (int, error) {
	p.waitOnce.Do(func() {
		st, err := p.cmd.Process.Wait()
		if st != nil {
			p.code = st.ExitCode()
		} else {
			p.code = -1
		}
		p.werr = err
		_ = p.stdin.Close()
		p.afterWait()
	})
	return p.code, p.werr
}

func (p *osProc) KillTree() error {
	if p.cmd.Process == nil {
		return errors.New("process not started")
	}
	return p.killTree()
}
