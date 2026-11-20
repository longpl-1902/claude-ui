package gitx

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Project struct {
	Key  string
	Name string
	Root string
	Git  bool
}

type Resolver struct {
	mu    sync.Mutex
	cache map[string]*cacheEntry
}

type cacheEntry struct {
	project Project
	at      time.Time
}

func NewResolver() *Resolver {
	return &Resolver{cache: make(map[string]*cacheEntry)}
}

func (r *Resolver) Provisional(cwd string) Project {
	key := normalizeKey(cwd)
	r.mu.Lock()
	e, ok := r.cache[key]
	r.mu.Unlock()
	if ok {
		return e.project
	}
	name := filepath.Base(cwd)
	return Project{Key: key, Name: name, Root: cwd, Git: false}
}

func (r *Resolver) Cached(cwd string) (Project, bool) {
	key := normalizeKey(cwd)
	r.mu.Lock()
	e, ok := r.cache[key]
	r.mu.Unlock()
	if !ok {
		return Project{}, false
	}
	return e.project, true
}

func (r *Resolver) Resolve(ctx context.Context, cwd string) Project {
	key := normalizeKey(cwd)
	r.mu.Lock()
	e, ok := r.cache[key]
	r.mu.Unlock()
	if ok && time.Since(e.at) < 5*time.Minute {
		return e.project
	}

	p := resolveGit(ctx, cwd)
	r.mu.Lock()
	r.cache[key] = &cacheEntry{project: p, at: time.Now()}
	r.mu.Unlock()
	return p
}

func resolveGit(ctx context.Context, cwd string) Project {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
	out, err := cmd.Output()
	if err != nil {
		name := filepath.Base(cwd)
		return Project{Key: normalizeKey(cwd), Name: name, Root: cwd, Git: false}
	}

	gitDir := strings.TrimSpace(string(out))
	gitDir = strings.ReplaceAll(gitDir, "\r", "")

	var root string
	if strings.HasSuffix(gitDir, "/.git") || strings.HasSuffix(gitDir, "\\.git") {
		root = filepath.Dir(gitDir)
	} else {
		root = filepath.Dir(gitDir)
	}

	name := filepath.Base(root)
	return Project{Key: normalizeKey(root), Name: name, Root: root, Git: true}
}

func normalizeKey(path string) string {
	p := filepath.ToSlash(path)
	p = strings.ToLower(p)
	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	p = strings.TrimRight(p, "/")
	return p
}
