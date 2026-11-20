package statefile

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

type AppDirs struct {
	Config string
	Local  string
	Locks  string
}

func GetDirs() AppDirs {
	var config, local string
	if runtime.GOOS == "windows" {
		config = filepath.Join(os.Getenv("APPDATA"), "ac")
		local = filepath.Join(os.Getenv("LOCALAPPDATA"), "ac")
	} else {
		home, _ := os.UserHomeDir()
		config = filepath.Join(home, ".config", "ac")
		local = filepath.Join(home, ".local", "share", "ac")
	}
	locks := filepath.Join(local, "locks")
	return AppDirs{Config: config, Local: local, Locks: locks}
}

func WriteJSONAtomic(path string, v any) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}

	tmp := fmt.Sprintf("%s.tmp-%d-%d", path, os.Getpid(), rand.IntN(1000000))

	if err := WriteFileSync(tmp, data); err != nil {
		os.Remove(tmp)
		return err
	}

	for i := range 10 {
		err = os.Rename(tmp, path)
		if err == nil {
			return nil
		}
		if !isTransientFSError(err) && i >= 2 {
			break
		}
		time.Sleep(time.Duration(5*(i+1)) * time.Millisecond)
	}

	os.Remove(tmp)
	return fmt.Errorf("atomic write failed after retries: %w", err)
}

// WriteFileSync creates path exclusively, writes data, fsyncs and closes it on
// one write-capable handle (Windows FlushFileBuffers needs write access).
func WriteFileSync(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// isTransientFSError reports Windows sharing errors (access denied / sharing
// violation) that occur while another handle briefly holds the file. The
// numeric values are compared so this compiles on every platform.
func isTransientFSError(err error) bool {
	return errors.Is(err, syscall.Errno(5)) || errors.Is(err, syscall.Errno(32))
}

func ReadJSON[T any](path string, v *T) error {
	var data []byte
	var err error
	for i := range 10 {
		data, err = os.ReadFile(path)
		if err == nil || runtime.GOOS != "windows" || !isTransientFSError(err) {
			break
		}
		time.Sleep(time.Duration(5*(i+1)) * time.Millisecond)
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func Update[T any](path string, fn func(*T) error) error {
	lockPath := path + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0755); err != nil {
		return err
	}

	for i := range 10 {
		lf, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err == nil {
			fmt.Fprintf(lf, `{"pid":%d,"ts":%d}`, os.Getpid(), time.Now().UnixMilli())
			lf.Close()
			break
		}
		if i == 9 {
			removeStaleLock(lockPath)
			lf2, err2 := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
			if err2 != nil {
				return fmt.Errorf("cannot acquire lock %s: %w", lockPath, err)
			}
			fmt.Fprintf(lf2, `{"pid":%d,"ts":%d}`, os.Getpid(), time.Now().UnixMilli())
			lf2.Close()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	defer os.Remove(lockPath)

	var val T
	_ = ReadJSON(path, &val)
	if err := fn(&val); err != nil {
		return err
	}
	return WriteJSONAtomic(path, &val)
}

func removeStaleLock(lockPath string) {
	fi, err := os.Stat(lockPath)
	if err != nil {
		return
	}
	if time.Since(fi.ModTime()) > 10*time.Second {
		os.Remove(lockPath)
	}
}
