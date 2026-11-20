package statefile

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"runtime"
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

	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}

	f, err := os.Open(tmp)
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	f.Close()

	for i := range 5 {
		err = os.Rename(tmp, path)
		if err == nil {
			return nil
		}
		time.Sleep(time.Duration(10*(i+1)) * time.Millisecond)
	}

	os.Remove(tmp)
	return fmt.Errorf("atomic write failed after retries: %w", err)
}

func ReadJSON[T any](path string, v *T) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return err
		}
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
