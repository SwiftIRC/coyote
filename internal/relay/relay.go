// Package relay runs coyote's embedded TURN server: the fallback media path for a
// client that cannot reach the SFU's UDP ports directly.
//
// Who needs it: a browser restricted to proxied traffic (Chrome's WebRTC IP-handling
// policy "disable_non_proxied_udp", which VPN and privacy extensions set and which can
// be a managed policy) gathers NO ICE candidates at all unless a TURN-over-TCP server
// is configured, so it joins the room — signaling rides the HTTPS WebSocket — and then
// times out on media in both directions. UDP-hostile networks fail the same way. Both
// can still reach TCP 443, which is where this relay is published (TLS terminated in
// front of it, e.g. Traefik), so their media goes client -> relay -> SFU instead.
//
// Scope is deliberately narrow:
//   - It relays ONLY to the SFU (the configured public IP). A TURN server that relays
//     anywhere is an open proxy; this one is useless for anything but this app's media.
//   - Credentials are TURN-REST style (expiry:user, HMAC'd with a secret), minted per
//     join. The secret is random per process: the relay and the minter are the same
//     process, and a restart drops every call anyway — clients rejoin and get fresh
//     credentials — so there is no secret to configure, store, or rotate.
//   - It listens on plain TCP only. UDP clients reach the SFU directly and do not need
//     it; the clients that do need it are exactly the ones that cannot use UDP.
package relay

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/pion/turn/v5"

	"github.com/SwiftIRC/coyote/internal/signal"
)

// CredentialTTL is how long a join's TURN credentials stay valid. It must outlast the
// longest call: an allocation's periodic refresh re-authenticates with the same
// credentials, so a credential that expires mid-call drops a relayed client's media.
// A reconnect rejoins and mints fresh ones, so this only bounds an unbroken session.
const CredentialTTL = 24 * time.Hour

const realm = "coyote"

// Config configures the relay.
type Config struct {
	// Addr is the plain-TCP listen address (TLS is terminated in front of it).
	Addr string
	// SFUIP is the SFU's advertised address: the one and only relay destination, and
	// the address relayed allocations are reported on (relay and SFU share the host).
	SFUIP net.IP
	// URLs are the TURN URLs clients are given, e.g.
	// "turns:turn.example.com:443?transport=tcp".
	URLs []string
}

// Relay is a running embedded TURN server.
type Relay struct {
	srv    *turn.Server
	ln     net.Listener
	secret string
	urls   []string
}

// Start listens on cfg.Addr and serves TURN until Close.
func Start(cfg Config, log *slog.Logger) (*Relay, error) {
	if cfg.SFUIP == nil {
		return nil, fmt.Errorf("relay: SFU IP required")
	}
	if len(cfg.URLs) == 0 {
		return nil, fmt.Errorf("relay: at least one advertised URL required")
	}
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return nil, fmt.Errorf("relay secret: %w", err)
	}
	secret := hex.EncodeToString(raw[:])

	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return nil, fmt.Errorf("relay listen %s: %w", cfg.Addr, err)
	}
	sfuIP := cfg.SFUIP
	srv, err := turn.NewServer(turn.ServerConfig{
		Realm:       realm,
		AuthHandler: turn.LongTermTURNRESTAuthHandler(secret, nil),
		ListenerConfigs: []turn.ListenerConfig{{
			Listener: ln,
			// Relayed sockets bind every interface but are reported on the SFU's IP:
			// the relay and the SFU share the host, so the SFU's connectivity checks
			// to that address arrive locally.
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{RelayAddress: sfuIP, Address: "0.0.0.0"},
			PermissionHandler: func(_ net.Addr, peer net.IP) bool {
				return peer.Equal(sfuIP)
			},
		}},
		// Info, not debug: only a client that could not reach the SFU directly ever
		// allocates, so each line is rare and is itself the answer to "was this
		// participant relayed?". The user id is the participant id from the join.
		EventHandler: turn.EventHandler{
			OnAllocationCreated: func(src, _ net.Addr, _, userID, _ string, relayAddr net.Addr, _ int) {
				log.Info("turn relay allocation created", "peer", userID, "client", src.String(), "relay", relayAddr.String())
			},
			OnAllocationDeleted: func(src, _ net.Addr, _, userID, _ string) {
				log.Debug("turn relay allocation deleted", "peer", userID, "client", src.String())
			},
			OnAllocationError: func(src, _ net.Addr, _, msg string) {
				log.Warn("turn relay allocation error", "client", src.String(), "err", msg)
			},
		},
	})
	if err != nil {
		ln.Close()
		return nil, fmt.Errorf("relay: %w", err)
	}
	return &Relay{srv: srv, ln: ln, secret: secret, urls: append([]string(nil), cfg.URLs...)}, nil
}

// Addr is the address the relay is listening on.
func (r *Relay) Addr() net.Addr { return r.ln.Addr() }

// ICEServers returns the ICE server entries for one participant's media connection,
// with credentials minted for them. user is recorded in the credential (and so in the
// allocation log lines); it is not a secret.
func (r *Relay) ICEServers(user string) []signal.ICEServer {
	username, credential, err := turn.GenerateLongTermTURNRESTCredentials(r.secret, user, CredentialTTL)
	if err != nil {
		return nil // HMAC over an in-memory buffer; cannot fail in practice
	}
	return []signal.ICEServer{{URLs: append([]string(nil), r.urls...), Username: username, Credential: credential}}
}

// Close stops the relay and drops every allocation.
func (r *Relay) Close() error { return r.srv.Close() }
