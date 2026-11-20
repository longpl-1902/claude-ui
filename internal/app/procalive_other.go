//go:build !windows

package app

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// isProcessAlive checks if a pid is still running.
func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = p.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

// processStart returns the process start time in Unix ms, or 0 when unknown.
// Only implemented on Linux (/proc).
func processStart(pid int) int64 {
	if pid <= 0 {
		return 0
	}
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return 0
	}
	s := string(data)
	// The comm field may contain spaces/parens; fields resume after the last ')'.
	i := strings.LastIndexByte(s, ')')
	if i < 0 {
		return 0
	}
	fields := strings.Fields(s[i+1:])
	// fields[0] is field 3 (state); starttime is field 22 -> index 19.
	if len(fields) < 20 {
		return 0
	}
	ticks, err := strconv.ParseInt(fields[19], 10, 64)
	if err != nil {
		return 0
	}
	stat, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	var btime int64
	for _, line := range strings.Split(string(stat), "\n") {
		if v, ok := strings.CutPrefix(line, "btime "); ok {
			btime, _ = strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			break
		}
	}
	if btime == 0 {
		return 0
	}
	const clkTck = 100 // USER_HZ is 100 on all supported Linux platforms
	return btime*1000 + ticks*1000/clkTck
}
