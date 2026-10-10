package server

import (
	"strings"
	"testing"
)

// /privacy is the privacy policy the app stores link to. It must be served as its
// own page: the static catch-all would otherwise treat "privacy" as a room slug and
// return the app shell.
func TestPrivacyPageServed(t *testing.T) {
	_, srv := newTestHub(t, "", true)
	for _, path := range []string{"/privacy", "/privacy.html"} {
		resp, body := httpGet(t, srv.URL+path)
		if resp.StatusCode != 200 {
			t.Errorf("GET %s status = %d, want 200", path, resp.StatusCode)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Errorf("GET %s content-type = %q, want text/html", path, ct)
		}
		if !strings.Contains(body, "Privacy Policy") || strings.Contains(body, `id="app"`) {
			t.Errorf("GET %s did not return the privacy policy page", path)
		}
		if !strings.Contains(body, "support@swiftirc.net") {
			t.Errorf("GET %s: policy is missing the contact address", path)
		}
	}
	// Rooms keep working: a room with a similar-looking slug still gets the shell.
	if _, body := httpGet(t, srv.URL+"/privacy-room"); !strings.Contains(body, `id="app"`) {
		t.Errorf("GET /privacy-room did not return the app shell")
	}
}
