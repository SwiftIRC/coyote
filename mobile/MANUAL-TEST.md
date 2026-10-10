# Mobile manual test checklist

Run on a real iPhone and a real Android phone before every TestFlight / closed-testing
build, against `vc.swiftirc.net` with at least one browser participant. This layer has
no automated coverage; treat the list as load-bearing, as with the root MANUAL-TEST.md.
Each change that touches iOS-only native code or configuration names the items to re-run.

1. **Two-way audio (iOS CallKit audio session).** Join with mic on. The browser hears
   you and you hear the browser. A silent call here means the CallKit
   didActivateAudioSession → RTCAudioSession hand-off is broken. The app forwards
   CallKit's didActivate/didDeactivateAudioSession to react-native-webrtc's
   RTCAudioSession and leaves WebRTC in its default automatic-audio mode; it does not
   set `useManualAudio`. If this item gives a silent or glitchy call, the documented
   fix is a small native AppDelegate hook that sets RTCAudioSession `useManualAudio`
   and `isAudioEnabled`.
2. **Two-way video.** Camera on: the browser sees you; you see the browser's camera.
   A black remote tile means VP8 was not negotiated or a `tracks` pairing failed.
3. **Lock the screen mid-call** for 1 minute. Audio continues both ways; the browser
   shows your avatar placeholder (camera off). Unlock: your camera comes back.
4. **Switch to another app for 2 minutes** and return. The call is intact or rejoins
   within a few seconds ("Reconnecting…" banner, then gone).
5. **Mute from the system UI**: iOS lock screen / Control Centre call controls;
   Android notification shade. The in-app mic button matches, and the browser's
   muted badge matches.
6. **End from the system UI** (iOS lock-screen end; Android notification "Leave").
   You leave the room; the browser sees you go.
7. **A cellular call arrives mid-meeting.** Coyote is held and your mic muted; after
   hanging up, the mic returns to its previous state.
8. **Bluetooth headset** connect and disconnect mid-call: audio follows. On Android the
   route button cycles Phone / Speaker / Bluetooth; on iOS it toggles the speaker.
9. **Airplane mode for 10 seconds**, then off: the app rejoins and media resumes.
10. **Tap an `#i=` invite link** in an IRC client: the app opens on Join with the
    invite's name locked. Join. Then open the same link on a second device: it is refused
    ("Your invite link is invalid.").
11. **Get kicked** by an op in the browser: the app returns to Home with "You were
    removed from the call by <op>." and does not rejoin.
12. **Restart the server** mid-call. A call joined by room name or token shows
    "Reconnecting…", then is back in the call. A call joined via an `#i=` invite link
    ends instead, with "Your invite link is invalid.", because invites live in server
    memory and do not survive a restart.
13. **Wrong room password**: back on Join with "Wrong password for this room."
14. **Deny camera permission** (fresh install): you join with the camera off and a
    notice; turning the camera on later shows "Camera unavailable."
15. **Tap a link while already in a call**: "Switch rooms?" prompt; Stay keeps the call.
16. **Android: swipe the app away from recents** mid-call: the notification and call
    end cleanly (no orphaned "In call" notification).
17. **Android: flip camera on a device that refuses a second open camera.** Tap flip
    mid-call. The camera switches, or fails with a visible notice while the call and
    the previous camera keep working; it must not freeze the tile or drop the call.
18. **Android: hardware back during a call.** "Leave call?" appears. Cancel stays in
    the call; Leave ends the call and the browser sees you go.
19. **iOS: audio-route button.** A video call starts on Speaker. Tapping the button
    toggles Phone / Speaker and the audio moves accordingly.
20. **Android: deny the microphone permission.** callkeep cannot register the call
    with Telecom, but the call should still work in-app (audio and video as granted,
    leave button works). Expect no system call notification.
