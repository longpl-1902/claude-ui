package statefile

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestWriteJSONAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")

	type data struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	err := WriteJSONAtomic(path, &data{Name: "acme", Count: 42})
	if err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got data
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "acme" || got.Count != 42 {
		t.Errorf("got %+v", got)
	}
}

func TestReadJSONMissing(t *testing.T) {
	var v struct{ X int }
	err := ReadJSON("/nonexistent/path.json", &v)
	if !os.IsNotExist(err) {
		t.Errorf("expected not-exist, got %v", err)
	}
}

func TestReadJSONEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.json")
	os.WriteFile(path, []byte{}, 0644)

	var v struct{ X int }
	err := ReadJSON(path, &v)
	if err != nil {
		t.Errorf("empty file should not error, got %v", err)
	}
}

func TestUpdate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "counter.json")

	type counter struct {
		N int `json:"n"`
	}

	for range 5 {
		err := Update(path, func(c *counter) error {
			c.N++
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	var c counter
	if err := ReadJSON(path, &c); err != nil {
		t.Fatal(err)
	}
	if c.N != 5 {
		t.Errorf("counter = %d, want 5", c.N)
	}
}

func TestUpdateConcurrent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "counter.json")

	type counter struct {
		N int `json:"n"`
	}

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 10 {
				_ = Update(path, func(c *counter) error {
					c.N++
					return nil
				})
			}
		}()
	}
	wg.Wait()

	var c counter
	if err := ReadJSON(path, &c); err != nil {
		t.Fatal(err)
	}
	if c.N != 80 {
		t.Errorf("concurrent counter = %d, want 80", c.N)
	}
}
