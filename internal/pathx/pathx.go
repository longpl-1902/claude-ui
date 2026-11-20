package pathx

import (
	"path/filepath"
	"strings"
)

func ExpandHome(path, home string) string {
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") || strings.HasPrefix(path, "~\\") {
		return filepath.Join(home, path[2:])
	}
	return path
}

func NormalizeForCompare(path string) string {
	p := strings.ReplaceAll(path, `\`, "/")
	p = strings.ToLower(p)
	unc := strings.HasPrefix(p, "//")
	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	if unc {
		p = "/" + p
	}
	p = strings.TrimRight(p, "/")
	return p
}

func Same(a, b string) bool {
	return NormalizeForCompare(a) == NormalizeForCompare(b)
}

func Display(path, home string) string {
	if home == "" {
		return path
	}
	norm := NormalizeForCompare(path)
	normHome := NormalizeForCompare(home)
	if norm == normHome {
		return "~"
	}
	if strings.HasPrefix(norm, normHome+"/") {
		return "~/" + path[len(home)+1:]
	}
	return path
}

func IsAbs(path string) bool {
	if strings.HasPrefix(path, "/") {
		return true
	}
	if len(path) >= 3 && isLetter(path[0]) && path[1] == ':' && (path[2] == '/' || path[2] == '\\') {
		return true
	}
	if strings.HasPrefix(path, `\\`) || strings.HasPrefix(path, "//") {
		return true
	}
	return false
}

func IsSameOrNested(child, parent string) bool {
	nc := NormalizeForCompare(child)
	np := NormalizeForCompare(parent)
	if nc == np {
		return true
	}
	return strings.HasPrefix(nc, np+"/")
}

func isLetter(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}
