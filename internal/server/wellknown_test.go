package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SwiftIRC/coyote/internal/config"
)

func wellKnownServer(t *testing.T, cfg config.Config) *httptest.Server {
	t.Helper()
	h := &Hub{cfg: cfg}
	mux := http.NewServeMux()
	h.registerWellKnown(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestAASAServed(t *testing.T) {
	srv := wellKnownServer(t, config.Config{AppleAppID: "T1.net.swiftirc.coyote"})
	resp, err := http.Get(srv.URL + "/.well-known/apple-app-site-association")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("status %d type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	var doc struct {
		Applinks struct {
			Details []struct {
				AppIDs     []string         `json:"appIDs"`
				Components []map[string]any `json:"components"`
			} `json:"details"`
		} `json:"applinks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	d := doc.Applinks.Details
	if len(d) != 1 || len(d[0].AppIDs) != 1 || d[0].AppIDs[0] != "T1.net.swiftirc.coyote" {
		t.Fatalf("appIDs wrong: %+v", d)
	}
	want := []string{"/api/*", "/ws/*", "/.well-known/*", "/*"}
	if len(d[0].Components) != len(want) {
		t.Fatalf("components = %+v", d[0].Components)
	}
	for i, w := range want {
		c := d[0].Components[i]
		if c["/"] != w {
			t.Errorf("component %d path = %v, want %s", i, c["/"], w)
		}
		excluded, _ := c["exclude"].(bool)
		if excluded != (i < 3) {
			t.Errorf("component %d exclude = %v", i, c["exclude"])
		}
	}
}

func TestAssetLinksServed(t *testing.T) {
	srv := wellKnownServer(t, config.Config{AndroidPackage: "net.swiftirc.coyote", AndroidCertSHA256: []string{"AA:BB", "CC:DD"}})
	resp, err := http.Get(srv.URL + "/.well-known/assetlinks.json")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("status %d type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	var doc []struct {
		Relation []string `json:"relation"`
		Target   struct {
			Namespace   string   `json:"namespace"`
			PackageName string   `json:"package_name"`
			Certs       []string `json:"sha256_cert_fingerprints"`
		} `json:"target"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if len(doc) != 1 || doc[0].Relation[0] != "delegate_permission/common.handle_all_urls" ||
		doc[0].Target.Namespace != "android_app" || doc[0].Target.PackageName != "net.swiftirc.coyote" ||
		len(doc[0].Target.Certs) != 2 {
		t.Fatalf("assetlinks wrong: %+v", doc)
	}
}

func TestWellKnownNotFoundWhenUnconfigured(t *testing.T) {
	srv := wellKnownServer(t, config.Config{AndroidPackage: "net.swiftirc.coyote"}) // no certs
	for _, p := range []string{"/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"} {
		resp, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 404 {
			t.Errorf("%s: status %d, want 404", p, resp.StatusCode)
		}
	}
}

func TestWellKnownRoutedByHub(t *testing.T) {
	// The real router must send these paths to the handlers, not the static catch-all.
	_, srv := newTestHub(t, "", true)
	resp, err := http.Get(srv.URL + "/.well-known/assetlinks.json")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 404 || resp.Header.Get("Content-Type") == "text/html; charset=utf-8" {
		t.Fatalf("unconfigured hub: status %d type %q, want a bare 404", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
}
