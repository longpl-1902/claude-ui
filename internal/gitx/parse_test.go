package gitx

import "testing"

func TestParseWorktreeList(t *testing.T) {
	input := `worktree /home/u/repo
HEAD abc123
branch refs/heads/main

worktree /home/u/repo-wt
HEAD def456
branch refs/heads/feature
locked

`
	wts := ParseWorktreeList(input)
	if len(wts) != 2 {
		t.Fatalf("expected 2 worktrees, got %d", len(wts))
	}
	if !wts[0].IsMain {
		t.Error("first worktree should be main")
	}
	if wts[0].Branch != "main" {
		t.Errorf("branch = %q, want main", wts[0].Branch)
	}
	if !wts[1].Locked {
		t.Error("second worktree should be locked")
	}
	if wts[1].Branch != "feature" {
		t.Errorf("branch = %q, want feature", wts[1].Branch)
	}
}

func TestParseWorktreeListDetached(t *testing.T) {
	input := "worktree /tmp/x\nHEAD abc\ndetached\n\n"
	wts := ParseWorktreeList(input)
	if len(wts) != 1 {
		t.Fatalf("expected 1, got %d", len(wts))
	}
	if !wts[0].Detached {
		t.Error("should be detached")
	}
}

func TestParseWorktreeListCRLF(t *testing.T) {
	input := "worktree /home/u/repo\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\n"
	wts := ParseWorktreeList(input)
	if len(wts) != 1 {
		t.Fatalf("expected 1, got %d", len(wts))
	}
}

func TestParseStatusZ(t *testing.T) {
	data := []byte("M  src/main.go\x00A  new.txt\x00R  old.txt\x00renamed.txt\x00")
	files := ParseStatusZ(data)
	if len(files) != 3 {
		t.Fatalf("expected 3 files, got %d", len(files))
	}
	if files[0].Path != "src/main.go" {
		t.Errorf("path = %q", files[0].Path)
	}
	if files[2].Renamed != "renamed.txt" {
		t.Errorf("renamed = %q", files[2].Renamed)
	}
}

func TestParseLeftRight(t *testing.T) {
	lr := ParseLeftRight("3\t5\n")
	if lr.Ahead != 3 || lr.Behind != 5 {
		t.Errorf("got %+v", lr)
	}
}

func TestPickBase(t *testing.T) {
	tests := []struct {
		branches []string
		want     string
	}{
		{[]string{"origin/HEAD", "main"}, "origin/HEAD"},
		{[]string{"develop", "main"}, "main"},
		{[]string{"develop"}, "develop"},
		{nil, "HEAD"},
	}
	for _, tt := range tests {
		got := PickBase(tt.branches)
		if got != tt.want {
			t.Errorf("PickBase(%v) = %q, want %q", tt.branches, got, tt.want)
		}
	}
}

func TestMergeChanged(t *testing.T) {
	a1, r1 := 10, 5
	committed := []NumstatEntry{{Added: &a1, Removed: &r1, Path: "file.go"}}
	a2, r2 := 2, 0
	uncommitted := []NumstatEntry{{Added: &a2, Removed: &r2, Path: "file.go"}}
	merged := MergeChanged(committed, uncommitted, 0)
	if len(merged) != 1 {
		t.Fatalf("expected 1 file, got %d", len(merged))
	}
	if !merged[0].Committed || !merged[0].Uncommitted {
		t.Error("file should be both committed and uncommitted")
	}
	if merged[0].Added != 12 {
		t.Errorf("added = %d, want 12", merged[0].Added)
	}
}

func TestWorktreeForCwd(t *testing.T) {
	wts := []Worktree{
		{Path: "/home/u/repo"},
		{Path: "/home/u/repo-wt"},
	}
	wt, ok := WorktreeForCwd("/home/u/repo/src", wts)
	if !ok || wt.Path != "/home/u/repo" {
		t.Errorf("got %v, %v", wt.Path, ok)
	}

	wt, ok = WorktreeForCwd("/home/u/repo-wt", wts)
	if !ok || wt.Path != "/home/u/repo-wt" {
		t.Errorf("got %v, %v", wt.Path, ok)
	}

	_, ok = WorktreeForCwd("/home/u/other", wts)
	if ok {
		t.Error("should not match")
	}
}

func TestLiveOverlaps(t *testing.T) {
	overlaps := []Overlap{
		{Path: "a.go", Live: true},
		{Path: "b.go", Live: false},
		{Path: "c.go", Live: true},
	}
	live := LiveOverlaps(overlaps)
	if len(live) != 2 {
		t.Errorf("expected 2 live, got %d", len(live))
	}
}
