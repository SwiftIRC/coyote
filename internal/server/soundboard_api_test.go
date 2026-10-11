package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The apps can't read the board out of the web page, so it is served as JSON — the
// exact list the page is built with.
func TestSoundboardAPIServesTheEmbeddedBoard(t *testing.T) {
	_, srv := newTestHub(t, "", true)
	resp, err := http.Get(srv.URL + "/api/soundboard")
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
	var got []sound
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(embeddedSoundboard) {
		t.Fatalf("got %d sounds, want %d", len(got), len(embeddedSoundboard))
	}
	for i, s := range got {
		if s != embeddedSoundboard[i] {
			t.Fatalf("sound %d = %+v, want %+v", i, s, embeddedSoundboard[i])
		}
	}
}
