package server

import (
	"testing"

	"github.com/SwiftIRC/coyote/internal/signal"
)

// Each joiner's Joined frame carries ICE servers minted for THAT participant.
func TestJoinedCarriesPerParticipantICEServers(t *testing.T) {
	h, srv := newTestHub(t, "", true)
	h.SetICEServers(func(id string) []signal.ICEServer {
		return []signal.ICEServer{{URLs: []string{"turns:turn.example.com:443?transport=tcp"}, Username: "exp:" + id, Credential: "c-" + id}}
	})
	a := dialRoom(t, srv, "lobby")
	send(t, a, map[string]any{"type": "join", "name": "alice"})
	ja := recv(t, a, "joined")
	list, ok := ja["iceServers"].([]any)
	if !ok || len(list) != 1 {
		t.Fatalf("iceServers = %#v, want one entry", ja["iceServers"])
	}
	s := list[0].(map[string]any)
	urls, _ := s["urls"].([]any)
	if len(urls) != 1 || urls[0] != "turns:turn.example.com:443?transport=tcp" {
		t.Errorf("urls = %#v", s["urls"])
	}
	if s["username"] != "exp:"+ja["selfId"].(string) || s["credential"] != "c-"+ja["selfId"].(string) {
		t.Errorf("credentials not minted for this participant: %#v (selfId %v)", s, ja["selfId"])
	}
}

// No relay configured: the field is absent, and clients connect to the SFU directly.
func TestJoinedOmitsICEServersWithoutRelay(t *testing.T) {
	_, srv := newTestHub(t, "", true)
	a := dialRoom(t, srv, "lobby")
	send(t, a, map[string]any{"type": "join", "name": "alice"})
	if v, ok := recv(t, a, "joined")["iceServers"]; ok {
		t.Errorf("iceServers = %#v, want absent", v)
	}
}
