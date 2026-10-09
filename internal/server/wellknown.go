package server

import (
	"encoding/json"
	"net/http"
)

// registerWellKnown adds the two documents that let the mobile apps claim this
// host's room links: Apple's apple-app-site-association (Universal Links) and
// Android's assetlinks.json (App Links). Each is 404 until configured, so a
// deployment without apps is unchanged.
func (h *Hub) registerWellKnown(mux *http.ServeMux) {
	mux.HandleFunc("GET /.well-known/apple-app-site-association", h.handleAASA)
	mux.HandleFunc("GET /.well-known/assetlinks.json", h.handleAssetLinks)
}

func (h *Hub) handleAASA(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AppleAppID == "" {
		http.NotFound(w, r)
		return
	}
	type component struct {
		Path    string `json:"/"`
		Exclude bool   `json:"exclude,omitempty"`
	}
	doc := map[string]any{
		"applinks": map[string]any{
			"details": []map[string]any{{
				"appIDs": []string{h.cfg.AppleAppID},
				// Order matters: Apple applies the first matching component.
				"components": []component{
					{Path: "/api/*", Exclude: true},
					{Path: "/ws/*", Exclude: true},
					{Path: "/.well-known/*", Exclude: true},
					{Path: "/*"},
				},
			}},
		},
	}
	writeJSON(w, doc)
}

func (h *Hub) handleAssetLinks(w http.ResponseWriter, r *http.Request) {
	if h.cfg.AndroidPackage == "" || len(h.cfg.AndroidCertSHA256) == 0 {
		http.NotFound(w, r)
		return
	}
	doc := []map[string]any{{
		"relation": []string{"delegate_permission/common.handle_all_urls"},
		"target": map[string]any{
			"namespace":                "android_app",
			"package_name":             h.cfg.AndroidPackage,
			"sha256_cert_fingerprints": h.cfg.AndroidCertSHA256,
		},
	}}
	writeJSON(w, doc)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
