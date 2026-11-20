package gitx

import "strings"

type Overlap struct {
	Path      string
	Worktrees []string
	Live      bool
}

func DetectOverlaps(worktrees []Worktree, files map[string][]ChangedFile) []Overlap {
	fileWt := make(map[string][]wtFile)
	for _, wt := range worktrees {
		changed, ok := files[wt.Path]
		if !ok {
			continue
		}
		for _, f := range changed {
			key := strings.ToLower(f.Path)
			fileWt[key] = append(fileWt[key], wtFile{
				worktree:    wt.Path,
				uncommitted: f.Uncommitted,
			})
		}
	}

	var overlaps []Overlap
	for path, wts := range fileWt {
		if len(wts) < 2 {
			continue
		}
		var names []string
		for _, w := range wts {
			names = append(names, w.worktree)
		}
		overlaps = append(overlaps, Overlap{
			Path:      path,
			Worktrees: names,
			Live:      isLiveOverlap(wts),
		})
	}
	return overlaps
}

type wtFile struct {
	worktree    string
	uncommitted bool
}

func isLiveOverlap(wts []wtFile) bool {
	uncommittedCount := 0
	for _, w := range wts {
		if w.uncommitted {
			uncommittedCount++
		}
	}
	return uncommittedCount >= 2
}

func LiveOverlaps(overlaps []Overlap) []Overlap {
	var live []Overlap
	for _, o := range overlaps {
		if o.Live {
			live = append(live, o)
		}
	}
	return live
}

func WorktreeForCwd(cwd string, worktrees []Worktree) (Worktree, bool) {
	cwdNorm := strings.ToLower(strings.ReplaceAll(cwd, "\\", "/"))
	best := -1
	bestLen := 0
	for i, wt := range worktrees {
		wtNorm := strings.ToLower(strings.ReplaceAll(wt.Path, "\\", "/"))
		if !strings.HasPrefix(cwdNorm, wtNorm) {
			continue
		}
		rem := cwdNorm[len(wtNorm):]
		if rem != "" && !strings.HasPrefix(rem, "/") {
			continue
		}
		if len(wtNorm) > bestLen {
			best = i
			bestLen = len(wtNorm)
		}
	}
	if best < 0 {
		return Worktree{}, false
	}
	return worktrees[best], true
}
