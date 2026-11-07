package server

import (
	"context"
	"fmt"
	"net"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/SwiftIRC/coyote/internal/config"
	"github.com/SwiftIRC/coyote/internal/relay"
	"github.com/SwiftIRC/coyote/internal/room"
	"github.com/SwiftIRC/coyote/internal/sfu"
)

// hostIPv4 is a non-loopback local address to stand in for the node's public IP
// (Pion's ICE ignores loopback interfaces, so 127.0.0.1 can't play the SFU).
func hostIPv4(t *testing.T) net.IP {
	t.Helper()
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		t.Skip(err)
	}
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && !n.IP.IsLoopback() && n.IP.To4() != nil {
			return n.IP.To4()
		}
	}
	t.Skip("no non-loopback IPv4 interface")
	return nil
}

// The fix end to end: a client that may ONLY use relay candidates — what a browser
// restricted to proxied traffic amounts to — joins over the WebSocket, takes the TURN
// credentials from its joined frame, and its media connection to the SFU comes up
// through the embedded relay over TCP.
func TestRelayOnlyClientConnectsThroughEmbeddedTURN(t *testing.T) {
	ip := hostIPv4(t)
	cfg := config.Config{AdhocRooms: true, PublicIP: ip.String()}
	e, err := sfu.NewEngine(cfg)
	if err != nil {
		t.Fatal(err)
	}
	h := NewHub(cfg, room.NewRegistry(true, time.Now), testLog, time.Now, sfu.NewSFU(e, testLog))
	r, err := relay.Start(relay.Config{Addr: "127.0.0.1:0", SFUIP: ip, URLs: []string{"turns:turn.example.com:443?transport=tcp"}}, testLog)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	h.SetICEServers(r.ICEServers)
	srv := httptest.NewServer(h.Routes())
	t.Cleanup(func() { srv.Close(); h.conns.Wait() })

	conn := dialRoom(t, srv, "media")
	send(t, conn, map[string]any{"type": "join", "name": "restricted"})
	joined := recv(t, conn, "joined")
	ice, _ := joined["iceServers"].([]any)
	if len(ice) != 1 {
		t.Fatalf("joined iceServers = %#v", joined["iceServers"])
	}
	entry := ice[0].(map[string]any)

	// The advertised URL is the public TLS front (turns:...:443, terminated by
	// Traefik in production); in the test, dial the relay's plain-TCP listener with
	// the SAME minted credentials.
	pc, err := clientAPI(t).NewPeerConnection(webrtc.Configuration{
		ICETransportPolicy: webrtc.ICETransportPolicyRelay,
		ICEServers: []webrtc.ICEServer{{
			URLs:       []string{fmt.Sprintf("turn:%s?transport=tcp", r.Addr())},
			Username:   entry["username"].(string),
			Credential: entry["credential"].(string),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })

	mc := &wsMediaClient{t: t, conn: conn, pc: pc}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go mc.readLoop(ctx)

	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "track", "camera")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pc.AddTrack(track); err != nil {
		t.Fatal(err)
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(10 * time.Second):
		t.Fatal("client ICE gathering did not complete")
	}
	mc.writeJSON(map[string]any{"type": "offer", "sdp": pc.LocalDescription().SDP})

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
			pair, _ := pc.SCTP().Transport().ICETransport().GetSelectedCandidatePair()
			if pair == nil || pair.Local.Typ != webrtc.ICECandidateTypeRelay {
				t.Fatalf("connected, but not through the relay: %v", pair)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("relay-only client never reached Connected (state %v)", pc.ConnectionState())
}
