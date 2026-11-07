package relay

import (
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // TURN REST credentials are HMAC-SHA1 by spec
	"encoding/base64"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pion/turn/v5"
)

var testLog = slog.New(slog.NewTextHandler(io.Discard, nil))

// startRelay runs a relay on loopback whose "SFU" is loopback too, so a UDP socket
// on 127.0.0.1 stands in for the SFU.
func startRelay(t *testing.T) *Relay {
	t.Helper()
	r, err := Start(Config{Addr: "127.0.0.1:0", SFUIP: net.ParseIP("127.0.0.1"), URLs: []string{"turns:turn.example.com:443?transport=tcp"}}, testLog)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r
}

// dialTURN opens a TURN-over-TCP client session to the relay.
func dialTURN(t *testing.T, r *Relay, username, password string) *turn.Client {
	t.Helper()
	conn, err := net.Dial("tcp", r.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	c, err := turn.NewClient(&turn.ClientConfig{
		TURNServerAddr: r.Addr().String(),
		STUNServerAddr: r.Addr().String(),
		Conn:           turn.NewSTUNConn(conn),
		Username:       username,
		Password:       password,
		Realm:          realm,
		RTO:            200 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Listen(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	return c
}

func creds(t *testing.T, r *Relay) (string, string) {
	t.Helper()
	s := r.ICEServers("peer1")
	if len(s) != 1 {
		t.Fatalf("ICEServers = %+v, want one entry", s)
	}
	return s[0].Username, s[0].Credential
}

func TestICEServersCarryURLsAndUserScopedCredentials(t *testing.T) {
	r := startRelay(t)
	s := r.ICEServers("peer1")
	if len(s) != 1 || len(s[0].URLs) != 1 || s[0].URLs[0] != "turns:turn.example.com:443?transport=tcp" {
		t.Fatalf("ICEServers = %+v", s)
	}
	exp, user, ok := strings.Cut(s[0].Username, ":")
	if !ok || user != "peer1" {
		t.Fatalf("username %q, want <expiry>:peer1", s[0].Username)
	}
	n, err := strconv.ParseInt(exp, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	if left := time.Until(time.Unix(n, 0)); left < CredentialTTL-time.Minute || left > CredentialTTL+time.Minute {
		t.Errorf("credential valid for %v, want ~%v", left, CredentialTTL)
	}
	if s[0].Credential == "" {
		t.Error("empty credential")
	}
}

// The whole point: a TCP-only client allocates on the relay and its media reaches the
// SFU and comes back.
func TestRelaysToSFUAndBack(t *testing.T) {
	r := startRelay(t)
	sfu, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer sfu.Close()

	u, p := creds(t, r)
	c := dialTURN(t, r, u, p)
	relayConn, err := c.Allocate()
	if err != nil {
		t.Fatalf("allocate: %v", err)
	}
	defer relayConn.Close()
	if ra := relayConn.LocalAddr().(*net.UDPAddr); !ra.IP.Equal(net.ParseIP("127.0.0.1")) {
		t.Errorf("relay address %v, want it reported on the SFU IP", ra)
	}

	if _, err := relayConn.WriteTo([]byte("ping"), sfu.LocalAddr()); err != nil {
		t.Fatalf("write via relay: %v", err)
	}
	buf := make([]byte, 64)
	sfu.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, from, err := sfu.ReadFrom(buf)
	if err != nil || string(buf[:n]) != "ping" {
		t.Fatalf("SFU read = %q, %v", buf[:n], err)
	}
	if _, err := sfu.WriteTo([]byte("pong"), from); err != nil {
		t.Fatal(err)
	}
	relayConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, _, err = relayConn.ReadFrom(buf)
	if err != nil || string(buf[:n]) != "pong" {
		t.Fatalf("client read = %q, %v", buf[:n], err)
	}
}

// Not an open proxy: permission to relay anywhere but the SFU is refused.
func TestRefusesNonSFUPeers(t *testing.T) {
	r := startRelay(t)
	u, p := creds(t, r)
	c := dialTURN(t, r, u, p)
	relayConn, err := c.Allocate()
	if err != nil {
		t.Fatalf("allocate: %v", err)
	}
	defer relayConn.Close()
	if err := c.CreatePermission(&net.UDPAddr{IP: net.ParseIP("192.0.2.1"), Port: 9}); err == nil {
		t.Error("permission to a non-SFU address was granted")
	}
	if err := c.CreatePermission(&net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 9}); err != nil {
		t.Errorf("permission to the SFU refused: %v", err)
	}
}

func TestRejectsBadAndExpiredCredentials(t *testing.T) {
	r := startRelay(t)
	u, _ := creds(t, r)
	if _, err := dialTURN(t, r, u, "wrong").Allocate(); err == nil {
		t.Error("allocation with a wrong password succeeded")
	}

	expired := strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10) + ":peer1"
	mac := hmac.New(sha1.New, []byte(r.secret))
	mac.Write([]byte(expired))
	if _, err := dialTURN(t, r, expired, base64.StdEncoding.EncodeToString(mac.Sum(nil))).Allocate(); err == nil {
		t.Error("allocation with an expired credential succeeded")
	}

	// A second relay (another process) has its own secret: its credentials don't work here.
	other := startRelay(t)
	ou, op := creds(t, other)
	if _, err := dialTURN(t, r, ou, op).Allocate(); err == nil {
		t.Error("credentials from a different relay were accepted")
	}
}
