package gitx

import (
	"strconv"
	"strings"
)

type Worktree struct {
	Path     string
	Branch   string
	Commit   string
	Bare     bool
	Detached bool
	Locked   bool
	Prunable bool
	IsMain   bool
}

type FileStatus struct {
	Path       string
	XY         string
	Renamed    string
	IsUnmerged bool
}

type LeftRight struct {
	Ahead  int
	Behind int
}

type NumstatEntry struct {
	Added   *int
	Removed *int
	Path    string
	Renamed string
}

type ChangedFile struct {
	Path        string
	Committed   bool
	Uncommitted bool
	Added       int
	Removed     int
}

func ParseWorktreeList(output string) []Worktree {
	output = strings.ReplaceAll(output, "\r\n", "\n")
	blocks := strings.Split(strings.TrimRight(output, "\n"), "\n\n")
	var result []Worktree

	first := true
	for _, block := range blocks {
		if strings.TrimSpace(block) == "" {
			continue
		}
		wt := Worktree{IsMain: first}
		first = false
		for _, line := range strings.Split(block, "\n") {
			line = strings.TrimSpace(line)
			switch {
			case strings.HasPrefix(line, "worktree "):
				wt.Path = strings.TrimPrefix(line, "worktree ")
			case strings.HasPrefix(line, "HEAD "):
				wt.Commit = strings.TrimPrefix(line, "HEAD ")
			case strings.HasPrefix(line, "branch "):
				ref := strings.TrimPrefix(line, "branch ")
				wt.Branch = strings.TrimPrefix(ref, "refs/heads/")
			case line == "bare":
				wt.Bare = true
			case line == "detached":
				wt.Detached = true
			case line == "locked":
				wt.Locked = true
			case line == "prunable":
				wt.Prunable = true
			}
		}
		if wt.Path != "" {
			result = append(result, wt)
		}
	}
	return result
}

func ParseStatusZ(output []byte) []FileStatus {
	var result []FileStatus
	i := 0
	for i < len(output) {
		if i+3 >= len(output) {
			break
		}
		xy := string(output[i : i+2])
		i += 3 // skip XY and space

		end := i
		for end < len(output) && output[end] != 0 {
			end++
		}
		path := string(output[i:end])
		i = end + 1

		fs := FileStatus{Path: path, XY: xy}

		if xy == "UU" || xy == "AA" || xy == "DD" ||
			xy[0] == 'U' || xy[1] == 'U' {
			fs.IsUnmerged = true
		}

		if xy[0] == 'R' || xy[0] == 'C' || xy[1] == 'R' || xy[1] == 'C' {
			end = i
			for end < len(output) && output[end] != 0 {
				end++
			}
			fs.Renamed = string(output[i:end])
			i = end + 1
		}

		result = append(result, fs)
	}
	return result
}

func ParseLeftRight(output string) LeftRight {
	output = strings.TrimSpace(output)
	parts := strings.Fields(output)
	if len(parts) != 2 {
		return LeftRight{}
	}
	a, _ := strconv.Atoi(parts[0])
	b, _ := strconv.Atoi(parts[1])
	return LeftRight{Ahead: a, Behind: b}
}

func ParseNumstatZ(output []byte) []NumstatEntry {
	lines := strings.Split(strings.ReplaceAll(string(output), "\r\n", "\n"), "\n")
	var result []NumstatEntry
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		e := NumstatEntry{Path: parts[2]}
		if parts[0] != "-" {
			v, _ := strconv.Atoi(parts[0])
			e.Added = &v
		}
		if parts[1] != "-" {
			v, _ := strconv.Atoi(parts[1])
			e.Removed = &v
		}
		if idx := strings.Index(e.Path, "\t"); idx >= 0 {
			e.Renamed = e.Path[idx+1:]
			e.Path = e.Path[:idx]
		}
		result = append(result, e)
	}
	return result
}

func PickBase(branches []string) string {
	priority := []string{"origin/HEAD", "main", "master", "origin/main", "origin/master"}
	for _, p := range priority {
		for _, b := range branches {
			if b == p {
				return b
			}
		}
	}
	if len(branches) > 0 {
		return branches[0]
	}
	return "HEAD"
}

func ParseSymbolicRef(output string) string {
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(output), "refs/heads/"))
}

func MergeChanged(committed, uncommitted []NumstatEntry, cap int) []ChangedFile {
	m := make(map[string]*ChangedFile)
	var order []string

	for _, e := range committed {
		p := normPath(e.Path)
		if _, ok := m[p]; !ok {
			m[p] = &ChangedFile{Path: p}
			order = append(order, p)
		}
		f := m[p]
		f.Committed = true
		if e.Added != nil {
			f.Added += *e.Added
		}
		if e.Removed != nil {
			f.Removed += *e.Removed
		}
	}

	for _, e := range uncommitted {
		p := normPath(e.Path)
		if _, ok := m[p]; !ok {
			m[p] = &ChangedFile{Path: p}
			order = append(order, p)
		}
		f := m[p]
		f.Uncommitted = true
		if e.Added != nil {
			f.Added += *e.Added
		}
		if e.Removed != nil {
			f.Removed += *e.Removed
		}
	}

	var result []ChangedFile
	for _, p := range order {
		result = append(result, *m[p])
		if cap > 0 && len(result) >= cap {
			break
		}
	}
	return result
}

func normPath(p string) string {
	return strings.ReplaceAll(p, "\\", "/")
}
