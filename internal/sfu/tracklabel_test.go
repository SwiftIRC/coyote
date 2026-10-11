package sfu

import (
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/SwiftIRC/coyote/internal/signal"
)

// A label keyed by an empty mid can never match an ontrack mid on the client, so a
// forward announced that way is media the client holds and is never told how to
// render — a permanently black tile.
//
// It is reachable because signalPeerConnections evaluates peerTrackInfos after
// releasing p.mu, while syncPeerSendersLocked adds transceivers under s.mu: a
// concurrent pass can append one to the same PeerConnection between our
// SetLocalDescription and the Tracks send. This pins the guard directly rather than
// trying to reproduce that interleaving.
func TestPeerTrackInfosSkipsUnnegotiatedTransceivers(t *testing.T) {
	s := testSFU(t)
	p, err := s.AddPeer("room", "p1", SignalerFunc(func(any) bool { return true }))
	if err != nil {
		t.Fatal(err)
	}
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "camera", "publisher")
	if err != nil {
		t.Fatal(err)
	}
	// Added but never negotiated: exactly the state a concurrent reconcile leaves
	// behind for the window this guards.
	if _, err := p.pc.AddTransceiverFromTrack(track, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendonly,
	}); err != nil {
		t.Fatal(err)
	}
	if mid := p.pc.GetTransceivers()[0].Mid(); mid != "" {
		t.Fatalf("precondition failed: expected an un-negotiated transceiver, got mid %q", mid)
	}
	if infos := peerTrackInfos(p); len(infos) != 0 {
		t.Fatalf("peerTrackInfos announced an un-negotiated forward: %+v", infos)
	}
}

// The invariant a client depends on: every label it is ever handed names a real
// mid. An entry with an empty mid is worse than a missing one — the list looks
// complete while carrying a pairing that cannot happen.
func TestEveryTracksFrameNamesRealMids(t *testing.T) {
	s := testSFU(t)

	p1 := newTestClient(t, s, "room", "p1")
	writeTestRTPLoop(t, p1.publish("camera"))
	writeTestRTPLoop(t, p1.publish("mic"))
	p1.waitConnected()
	waitFor(t, func() bool { return s.trackCount("room") == 2 })

	p2 := newTestClient(t, s, "room", "p2")
	writeTestRTPLoop(t, p2.publish("camera"))
	p2.waitConnected()
	waitFor(t, func() bool { return s.trackCount("room") == 3 })

	// Let the renegotiations settle so every frame either side produced is in hand.
	time.Sleep(500 * time.Millisecond)

	for _, c := range []*testClient{p1, p2} {
		for {
			select {
			case tks := <-c.gotTracks:
				for _, ti := range tks.Tracks {
					if ti.Mid == "" {
						t.Errorf("%s got a label with an empty mid: %+v", c.id, ti)
					}
					if ti.ParticipantID == "" || ti.Kind == "" {
						t.Errorf("%s got an incomplete label: %+v", c.id, ti)
					}
				}
				continue
			default:
			}
			break
		}
	}
}

// The repair path. A label map is now sent when a negotiation COMPLETES, not only
// when one is proposed — so a forward that could not be named at offer time gets
// named as soon as the client answers, without waiting for a future renegotiation
// that a settled call will never produce.
func TestAnswerReSendsTheLabelMap(t *testing.T) {
	s := testSFU(t)

	p1 := newTestClient(t, s, "room", "p1")
	writeTestRTPLoop(t, p1.publish("camera"))
	p1.waitConnected()
	waitFor(t, func() bool { return s.trackCount("room") == 1 })

	p2 := newTestClient(t, s, "room", "p2")
	writeTestRTPLoop(t, p2.publish("camera"))
	p2.waitConnected()
	waitFor(t, func() bool { return s.trackCount("room") == 2 })

	// p2 must learn p1's camera. Drain until a frame names it; the point is that a
	// correct label arrives at all, whichever send carried it.
	waitForTracks(t, p2.gotTracks, func(tks signal.Tracks) bool {
		return listsTrack(tks, "p1", "camera")
	}, "naming p1's camera to p2")

	// The discriminator. The map used to be sent in exactly one place — beside each
	// server-initiated offer — so a peer saw one Tracks frame per offer and no more.
	// It is now also sent when the answer lands, so the count must EXCEED the offer
	// count. Equality is the old behaviour, and the state in which a forward that
	// could not be named at offer time stays unnamed.
	time.Sleep(500 * time.Millisecond) // let every renegotiation settle
	offers := len(p1.serverOffers())
	tracks := count(p1.gotTracks)
	if offers == 0 {
		t.Fatal("p1 received no server offers; nothing to assert about")
	}
	if tracks <= offers {
		t.Fatalf("p1 got %d label maps for %d offers — the answer is not re-sending one", tracks, offers)
	}
}

func count(ch <-chan signal.Tracks) int {
	n := 0
	for {
		select {
		case <-ch:
			n++
		default:
			return n
		}
	}
}

// Forwarded track ids must be unique per subscriber PeerConnection. They were the
// bare kind ("camera", "mic"), so a subscriber with two other publishers saw two
// remote tracks both called "camera". Browsers key ontrack by transceiver and
// never noticed; react-native-webrtc keys receivers by track id and bound the
// second publisher's tracks to the first's transceivers, so the mobile app showed
// one participant of three. The kind still travels, bare, in the tracks labels.
func TestForwardedTrackIDsAreUnique(t *testing.T) {
	s := testSFU(t)

	pubs := []*testClient{newTestClient(t, s, "room", "p1"), newTestClient(t, s, "room", "p2")}
	for i, p := range pubs {
		writeTestRTPLoop(t, p.publish("camera"))
		writeTestRTPLoop(t, p.publish("mic"))
		p.waitConnected()
		want := 2 * (i + 1)
		waitFor(t, func() bool { return s.trackCount("room") == want })
	}
	sub := newTestClient(t, s, "room", "p3")
	writeTestRTPLoop(t, sub.publish("mic"))
	sub.waitConnected()

	ids := map[string]string{}
	deadline := time.After(10 * time.Second)
	for len(ids) < 4 {
		select {
		case tr := <-sub.gotTrack:
			if prev, dup := ids[tr.ID()]; dup {
				t.Fatalf("track id %q forwarded twice (streams %s and %s)", tr.ID(), prev, tr.StreamID())
			}
			ids[tr.ID()] = tr.StreamID()
		case <-deadline:
			t.Fatalf("subscriber got %d of 4 forwarded tracks: %v", len(ids), ids)
		}
	}

	for {
		select {
		case tks := <-sub.gotTracks:
			for _, ti := range tks.Tracks {
				if ti.Kind != "camera" && ti.Kind != "mic" {
					t.Errorf("label kind %q is not a bare kind: %+v", ti.Kind, ti)
				}
			}
			continue
		default:
		}
		break
	}
}

// A forward that comes back must not reuse its old track id. Turning low bandwidth
// off re-adds the room's video as fresh transceivers, while the earlier ones stay
// behind, inactive, still carrying the old receiver. react-native-webrtc matches an
// incoming receiver to the FIRST transceiver with the same id, so a reused
// "pub:camera" bound the restored camera to the dead transceiver and the app's
// camera never came back. Browsers key by transceiver and were unaffected.
func TestRestoredVideoGetsAFreshTrackID(t *testing.T) {
	s := testSFU(t)

	sub := newTestClient(t, s, "room", "sub")
	writeTestRTPLoop(t, sub.publish("mic"))
	sub.waitConnected()
	waitFor(t, func() bool { return s.hasTrack("room", "sub:mic") })

	pub := newTestClient(t, s, "room", "pub")
	writeTestRTPLoop(t, pub.publish("mic"))
	writeTestRTPLoop(t, pub.publish("camera"))
	pub.waitConnected()
	waitFor(t, func() bool { return s.hasTrack("room", "pub:mic") && s.hasTrack("room", "pub:camera") })

	nextVideo := func(desc string) string {
		t.Helper()
		deadline := time.After(10 * time.Second)
		for {
			select {
			case tr := <-sub.gotTrack:
				if tr.Kind() == webrtc.RTPCodecTypeVideo {
					return tr.ID()
				}
			case <-deadline:
				t.Fatalf("no video track %s", desc)
			}
		}
	}

	first := nextVideo("before low bandwidth")
	sub.server.SetReceiveVideo(false)
	waitForTracksWithout(t, sub.gotTracks, "pub", "camera")
	sub.server.SetReceiveVideo(true)
	restored := nextVideo("after low bandwidth off")
	if restored == first {
		t.Fatalf("restored camera reused track id %q", first)
	}
	waitForTracks(t, sub.gotTracks, func(tks signal.Tracks) bool {
		return listsTrack(tks, "pub", "camera")
	}, "labelling the restored camera with its bare kind")
}

// roomKeyOf maps a forwarded track id ("publisherID:kind#n") back to its room
// key ("publisherID:kind").
func roomKeyOf(id string) string {
	key, _, _ := strings.Cut(id, "#")
	return key
}
