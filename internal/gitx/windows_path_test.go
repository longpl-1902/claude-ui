package gitx

import "testing"

func TestProvisionalWindowsPath(t *testing.T) {
	r := NewResolver()
	a := r.Provisional(`C:\Users\u\work\acme`)
	b := r.Provisional(`c:\users\u\work\acme\`)
	if a.Key != b.Key {
		t.Errorf("keys differ: %q vs %q", a.Key, b.Key)
	}
	if a.Name != "acme" {
		t.Errorf("name = %q", a.Name)
	}
}
