package pathx

import "testing"

func TestExpandHome(t *testing.T) {
	tests := []struct {
		path, home, want string
	}{
		{"~", "/home/u", "/home/u"},
		{"~/docs", "/home/u", "/home/u/docs"},
		{"~\\docs", "/home/u", "/home/u/docs"},
		{"/abs/path", "/home/u", "/abs/path"},
		{"rel/path", "/home/u", "rel/path"},
		{"~", "", ""},
	}
	for _, tt := range tests {
		got := ExpandHome(tt.path, tt.home)
		if got != tt.want {
			t.Errorf("ExpandHome(%q, %q) = %q, want %q", tt.path, tt.home, got, tt.want)
		}
	}
}

func TestNormalizeForCompare(t *testing.T) {
	tests := []struct {
		path, want string
	}{
		{`D:\Work\Demo`, "d:/work/demo"},
		{`d:\work\demo`, "d:/work/demo"},
		{"/home/user/work", "/home/user/work"},
		{`C:\Users\u\\dir`, "c:/users/u/dir"},
		{"path/", "path"},
		{`\\server\share`, "//server/share"},
	}
	for _, tt := range tests {
		got := NormalizeForCompare(tt.path)
		if got != tt.want {
			t.Errorf("NormalizeForCompare(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestSame(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{`D:\Work`, `d:\work`, true},
		{`D:\Work\`, `d:\work`, true},
		{"/a/b", "/a/b", true},
		{"/a/b", "/a/c", false},
	}
	for _, tt := range tests {
		got := Same(tt.a, tt.b)
		if got != tt.want {
			t.Errorf("Same(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestDisplay(t *testing.T) {
	tests := []struct {
		path, home, want string
	}{
		{"/home/u/docs", "/home/u", "~/docs"},
		{"/home/u", "/home/u", "~"},
		{"/other/path", "/home/u", "/other/path"},
		{"/some/path", "", "/some/path"},
	}
	for _, tt := range tests {
		got := Display(tt.path, tt.home)
		if got != tt.want {
			t.Errorf("Display(%q, %q) = %q, want %q", tt.path, tt.home, got, tt.want)
		}
	}
}

func TestIsAbs(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/abs", true},
		{`C:\abs`, true},
		{`d:\abs`, true},
		{`\\server\share`, true},
		{"//server/share", true},
		{"rel/path", false},
		{"", false},
		{"~", false},
	}
	for _, tt := range tests {
		got := IsAbs(tt.path)
		if got != tt.want {
			t.Errorf("IsAbs(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

func TestIsSameOrNested(t *testing.T) {
	tests := []struct {
		child, parent string
		want          bool
	}{
		{"/a/b/c", "/a/b", true},
		{"/a/b", "/a/b", true},
		{"/a/bc", "/a/b", false},
		{`D:\Work\Sub`, `d:\work`, true},
		{`D:\Other`, `d:\work`, false},
	}
	for _, tt := range tests {
		got := IsSameOrNested(tt.child, tt.parent)
		if got != tt.want {
			t.Errorf("IsSameOrNested(%q, %q) = %v, want %v", tt.child, tt.parent, got, tt.want)
		}
	}
}
