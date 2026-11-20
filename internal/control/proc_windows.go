//go:build windows

package control

import (
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type platProc struct {
	mu  sync.Mutex
	job windows.Handle
}

func commandFor(path string, args []string) *exec.Cmd {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".cmd" || ext == ".bat" {
		return exec.Command("cmd.exe", append([]string{"/c", path}, args...)...)
	}
	return exec.Command(path, args...)
}

func configureCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP,
		HideWindow:    true,
	}
}

// start launches the process and puts it into a kill-on-close job object.
// The job handle stays open while the process lives, so a crash of ac takes
// the whole tree down.
func (p *osProc) start() error {
	if err := p.cmd.Start(); err != nil {
		return err
	}
	fail := func(err error, job windows.Handle) error {
		if job != 0 {
			_ = windows.CloseHandle(job)
		}
		_ = p.cmd.Process.Kill()
		_, _ = p.cmd.Process.Wait()
		return err
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return fail(err, 0)
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return fail(err, job)
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(p.cmd.Process.Pid))
	if err != nil {
		return fail(err, job)
	}
	defer windows.CloseHandle(h)
	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		return fail(err, job)
	}
	p.plat.job = job
	return nil
}

func (p *osProc) afterWait() {
	// Closing the handle kills any descendant still in the job.
	p.plat.mu.Lock()
	defer p.plat.mu.Unlock()
	if p.plat.job != 0 {
		_ = windows.CloseHandle(p.plat.job)
		p.plat.job = 0
	}
}

func (p *osProc) killTree() error {
	p.plat.mu.Lock()
	defer p.plat.mu.Unlock()
	if p.plat.job == 0 {
		return p.cmd.Process.Kill()
	}
	return windows.TerminateJobObject(p.plat.job, 1)
}
