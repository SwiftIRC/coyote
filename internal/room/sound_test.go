package room

import (
	"errors"
	"testing"

	"github.com/SwiftIRC/coyote/internal/signal"
)

// lastSound returns the most recent SoundEvent a fakeConn received.
func lastSound(c *fakeConn) (signal.SoundEvent, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := len(c.msgs) - 1; i >= 0; i-- {
		if m, ok := c.msgs[i].(signal.SoundEvent); ok {
			return m, true
		}
	}
	return signal.SoundEvent{}, false
}

// TestSoundStartBroadcastsToAll: a start reaches every participant,
// including the starter, carrying the starter's display name.
func TestSoundStartBroadcastsToAll(t *testing.T) {
	r, _, ac, _, bc := modRoom(t) // alice=p1, bob=p2
	if err := r.Sound("p1", "start", "1f680"); err != nil {
		t.Fatal(err)
	}
	for who, c := range map[string]*fakeConn{"alice": ac, "bob": bc} {
		ev, ok := lastSound(c)
		if !ok || ev.Action != "start" || ev.ID != "1f680" || ev.By != "alice" {
			t.Errorf("%s got %+v ok=%v, want {start 1f680 alice}", who, ev, ok)
		}
	}
}

// TestSoundRefusesSecondStart: while one is active, another participant's
// start is refused server-side (the client lock is only advisory).
func TestSoundRefusesSecondStart(t *testing.T) {
	r, _, _, _, _ := modRoom(t)
	if err := r.Sound("p1", "start", "1f680"); err != nil {
		t.Fatal(err)
	}
	if err := r.Sound("p2", "start", "1f389"); !errors.Is(err, ErrSoundActive) {
		t.Errorf("second start = %v, want ErrSoundActive", err)
	}
}

// TestSoundNonStarterCannotStop: only the starter may stop it.
func TestSoundNonStarterCannotStop(t *testing.T) {
	r, _, _, _, _ := modRoom(t)
	if err := r.Sound("p1", "start", "1f680"); err != nil {
		t.Fatal(err)
	}
	if err := r.Sound("p2", "stop", ""); !errors.Is(err, ErrSoundNotOwner) {
		t.Errorf("non-starter stop = %v, want ErrSoundNotOwner", err)
	}
}

// TestSoundStarterStopClearsAndBroadcasts: the starter's stop clears the
// state (so anyone may start again) and broadcasts a stop to everyone.
func TestSoundStarterStopClearsAndBroadcasts(t *testing.T) {
	r, _, ac, _, bc := modRoom(t)
	if err := r.Sound("p1", "start", "1f680"); err != nil {
		t.Fatal(err)
	}
	if err := r.Sound("p1", "stop", ""); err != nil {
		t.Fatal(err)
	}
	for who, c := range map[string]*fakeConn{"alice": ac, "bob": bc} {
		ev, ok := lastSound(c)
		if !ok || ev.Action != "stop" || ev.ID != "1f680" {
			t.Errorf("%s last sound = %+v ok=%v, want stop of 1f680", who, ev, ok)
		}
	}
	// State cleared: a fresh start by a different participant is accepted.
	if err := r.Sound("p2", "start", "1f389"); err != nil {
		t.Errorf("start after stop = %v, want nil", err)
	}
}

// TestSoundOwnerLeaveClears: if the starter leaves mid-sound, the room
// clears the state and broadcasts a stop so the control unlocks for everyone.
func TestSoundOwnerLeaveClears(t *testing.T) {
	r, _, _, _, bc := modRoom(t)
	if err := r.Sound("p1", "start", "1f680"); err != nil {
		t.Fatal(err)
	}
	r.Leave("p1")
	ev, ok := lastSound(bc)
	if !ok || ev.Action != "stop" || ev.ID != "1f680" {
		t.Errorf("bob last sound after owner leave = %+v ok=%v, want stop", ev, ok)
	}
	// Cleared: bob can start now.
	if err := r.Sound("p2", "start", "1f389"); err != nil {
		t.Errorf("start after owner leave = %v, want nil", err)
	}
}

// TestSoundStopWhenInactiveAndBadInputs: stopping with nothing running,
// an unknown actor, a bad action and a start naming no sound are each refused without a broadcast.
func TestSoundStopWhenInactiveAndBadInputs(t *testing.T) {
	r, _, _, _, bc := modRoom(t)
	if err := r.Sound("p1", "stop", ""); !errors.Is(err, ErrSoundInactive) {
		t.Errorf("stop when idle = %v, want ErrSoundInactive", err)
	}
	if err := r.Sound("ghost", "start", "1f680"); !errors.Is(err, ErrNoSuchPeer) {
		t.Errorf("unknown actor = %v, want ErrNoSuchPeer", err)
	}
	if err := r.Sound("p1", "sideways", "1f680"); !errors.Is(err, ErrBadSound) {
		t.Errorf("bad action = %v, want ErrBadSound", err)
	}
	if err := r.Sound("p1", "start", ""); !errors.Is(err, ErrBadSound) {
		t.Errorf("start with no id = %v, want ErrBadSound", err)
	}
	if _, ok := lastSound(bc); ok {
		t.Error("a refused sound must not broadcast")
	}
}
