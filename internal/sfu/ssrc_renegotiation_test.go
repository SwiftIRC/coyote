package sfu

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// ssrcsByMid maps each m-line's mid to the SSRCs its a=ssrc lines declare.
func ssrcsByMid(sdp string) map[string]string {
	out := map[string]string{}
	midRe := regexp.MustCompile(`a=mid:(\S+)`)
	ssrcRe := regexp.MustCompile(`a=ssrc:(\d+) `)
	for _, sec := range strings.Split(sdp, "\nm=")[1:] {
		mid := midRe.FindStringSubmatch(sec)
		if mid == nil {
			continue
		}
		seen := map[string]bool{}
		var ids []string
		for _, m := range ssrcRe.FindAllStringSubmatch(sec, -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				ids = append(ids, m[1])
			}
		}
		out[mid[1]] = strings.Join(ids, ",")
	}
	return out
}

func waitStable(t *testing.T, c *testClient) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		c.server.mu.Lock()
		ok := !c.offerPending && !c.server.makingOffer &&
			c.server.pc.SignalingState() == webrtc.SignalingStateStable &&
			c.pc.SignalingState() == webrtc.SignalingStateStable
		c.server.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s never settled", c.id)
}

// A client that re-offers to add a screenshare gets the server's answer as its new
// remote description. Every forward the server already sends must keep the SSRC it
// was offered under: a receiver whose signaled SSRC changes rebuilds its stream
// under the new one and drops the packets still arriving under the old one (the
// iPhone lost two of three cameras and their mics this way).
//
// The answer must also carry none of the demux header extensions the server strips
// from its offers: echoing sdes:mid back arms MID demux on the client, which then
// drops forwarded packets whose MID names none of its m-lines.
func TestScreenshareOfferKeepsForwardSSRCs(t *testing.T) {
	s := testSFU(t)
	bringUp := func(id string, after int, kinds ...string) *testClient {
		c := newTestClient(t, s, "room", id)
		for _, k := range kinds {
			writeTestRTPLoop(t, c.publish(k))
		}
		c.waitConnected()
		waitForRoomTracks(t, s, "room", after, c)
		return c
	}
	bringUp("p1", 2, "mic", "camera")
	bringUp("p2", 4, "mic", "camera")
	bringUp("p3", 6, "mic", "camera")
	phone := bringUp("phone", 8, "mic", "camera")
	assertReceivesAll(t, phone, map[string]bool{
		"p1:mic": false, "p1:camera": false, "p2:mic": false, "p2:camera": false, "p3:mic": false, "p3:camera": false,
	})
	waitStable(t, phone)
	before := ssrcsByMid(phone.pc.CurrentRemoteDescription().SDP)

	writeTestRTPLoop(t, phone.publish("screen"))
	waitForRoomTracks(t, s, "room", 9, phone)
	waitStable(t, phone)
	answer := phone.pc.CurrentRemoteDescription().SDP
	after := ssrcsByMid(answer)

	for mid, ssrc := range before {
		if ssrc == "" {
			continue
		}
		if after[mid] != ssrc {
			t.Errorf("mid %s: offered with ssrc %s, the answer to the screenshare offer says %q", mid, ssrc, after[mid])
		}
	}
	for _, ext := range []string{"sdes:mid", "sdes:rtp-stream-id", "sdes:repaired-rtp-stream-id"} {
		if strings.Contains(answer, ext) {
			t.Errorf("the answer to the screenshare offer advertises %s", ext)
		}
	}
}
