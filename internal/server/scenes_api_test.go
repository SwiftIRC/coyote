package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/SwiftIRC/coyote/internal/web"
)

// The apps can't read the scenes out of the web page, so they are served as JSON —
// the exact list the page is built with.
func TestScenesAPIServesTheEmbeddedScenes(t *testing.T) {
	_, srv := newTestHub(t, "", true)
	resp, err := http.Get(srv.URL + "/api/scenes")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type %q", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "public, max-age=300" {
		t.Fatalf("cache-control %q", cc)
	}
	var got []scene
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	want := buildScenes(web.Assets, assetsVersion)
	if len(got) != len(want) {
		t.Fatalf("got %d scenes, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("scene %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
