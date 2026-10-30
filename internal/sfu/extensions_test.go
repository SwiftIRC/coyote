package sfu

import (
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// A forwarded packet must not carry the publisher's RTP header extensions. Their ids
// were negotiated on the publisher's connection, not the subscriber's, and the MID
// extension names an m-line of the publisher's. A phone whose own offer declares
// sdes:mid (every screenshare re-offer does) read those MIDs and filed each forwarded
// stream under an unrelated m-line of its own: it stopped seeing and hearing everyone
// the moment it started sharing.
func TestForwardStripsPublisherHeaderExtensions(t *testing.T) {
	const foreignID = 14 // any id; real publishers send sdes:mid as 4
	s := testSFU(t)

	pub := newTestClient(t, s, "room", "pub")
	track := pub.publish("camera")
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for seq := 0; ; seq++ {
			select {
			case <-stop:
				return
			default:
			}
			h := rtp.Header{Version: 2, SequenceNumber: uint16(seq), Timestamp: uint32(seq * 3000)}
			_ = h.SetExtension(foreignID, []byte("7")) // a MID naming one of the publisher's m-lines
			_ = track.WriteRTP(&rtp.Packet{Header: h, Payload: []byte{0x90, 0x00, 0x00, 0x00, 0x00}})
			time.Sleep(20 * time.Millisecond)
		}
	}()
	pub.waitConnected()
	waitFor(t, func() bool { return s.trackCount("room") == 1 })

	sub := newTestClient(t, s, "room", "sub")
	sub.pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly})
	var tr *webrtc.TrackRemote
	select {
	case tr = <-sub.gotTrack:
	case <-time.After(15 * time.Second):
		t.Fatal("subscriber never received the camera")
	}

	if err := tr.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		pkt, _, err := tr.ReadRTP()
		if err != nil {
			t.Fatalf("no RTP forwarded: %v", err)
		}
		// None at all: the publisher's transport-cc sequence numbers describe its own
		// connection too, and the server stamps no extensions of its own.
		if pkt.Header.Extension {
			t.Fatalf("forwarded packet %d still carries header extensions %v (publisher's %d = %q)",
				i, pkt.Header.GetExtensionIDs(), foreignID, pkt.Header.GetExtension(foreignID))
		}
	}
}
