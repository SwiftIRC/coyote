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
5. **Mute from the system UI**: iOS lock screen / Control Centre call controls. The
   in-app mic button matches, and the browser's muted badge matches. Android has no
   system mute in Foundation (the notification offers only "Leave", and the
   self-managed call has no system call screen); at most a Bluetooth headset's call
   button may toggle mute, and if it does the in-app button and browser badge match.
6. **End from the system UI** (iOS lock-screen end; Android notification "Leave").
   You leave the room; the browser sees you go.
7. **A cellular call arrives mid-meeting.** Coyote is held and your mic muted; after
   hanging up, the mic returns to its previous state.
8. **Bluetooth headset** connect and disconnect mid-call: audio follows. On Android the
   route button cycles Phone / Speaker / Bluetooth; on iOS it toggles the speaker.
9. **Airplane mode for 10 seconds**, then off: the app rejoins and media resumes.
   "Reconnecting…" or "Media connection lost — rejoining…" may show meanwhile; both
   are fine as long as they clear.
10. **Tap an `#i=` invite link** in an IRC client: the app opens on Join with the
    invite's name locked. (Android App Links only verify for builds whose signing-cert
    SHA-256 is in the server's `WVC_ANDROID_CERT_SHA256`; a debug build won't open
    links unless the debug cert is listed there too.) Join. Then open the same link on a second device: it is refused
    ("Your invite link is invalid.").
11. **Get kicked** by an op in the browser: the app returns to Home with "You were
    removed from the call by <op>." (`<op>` is the op's nickname) and does not rejoin.
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
17. **Android: flip camera on a device that refuses a second open camera.** Tap 🔄
    ("Switch camera") mid-call. The camera switches, or fails with a visible notice while the call and
    the previous camera keep working; it must not freeze the tile or drop the call.
18. **Android: hardware back during a call.** "Leave call?" appears. Cancel stays in
    the call; Leave ends the call and the browser sees you go.
19. **iOS: audio-route button.** A video call starts on Speaker. Tapping the button
    toggles Phone / Speaker and the audio moves accordingly.
20. **Android: deny the microphone permission.** callkeep cannot register the call
    with Telecom, but the call should still work in-app (audio and video as granted,
    leave button works). Expect no system call notification.

## Room features (2a)

Solo setup: the phone plus a browser on a computer **with headphones** (prevents
feedback), both in the same room.

21. **Chat.** Open chat (💬). The history sent before you joined is there once, in
    order. Send a message from each side; each appears on both. Close the sheet, send
    from the browser: the badge counts up; open: it clears. A link such as
    `https://example.com/a_(b).` opens the browser at `https://example.com/a_(b)`;
    `javascript:alert(1)` is plain text.
22. **Chat while reconnecting.** Turn on airplane mode for 5 s, type a message, send:
    "Not connected — message not sent", text kept. Reconnect: the history is not
    duplicated.
23. **Rename.** ☰ → Name → change it → Save (or Done). The browser shows the new name;
    leave and rejoin: the lobby has the new name. Change it again and close the sheet
    without saving: the name is unchanged. Joining with an invite that locks your
    name does not overwrite your saved default name; an explicit in-call rename
    (Save/Done) does become the new default.
    Focus the chat input, then the ☰ Name field (both platforms): each stays visible
    above the keyboard while typing (Android: if it is hidden behind the keyboard,
    report it — the sheet then needs the iOS keyboard-lift path).
24. **Room timer.** The top bar shows `#room · m:ss`, matching the browser's timer.
25. **Chimes.** Browser joins: door chime on the phone. Browser leaves: drop chime
    ~6 s later. Browser reloads quickly: no chimes. Chimes follow the current audio
    route (earpiece / speaker / Bluetooth). iOS: the Xcode console shows no new
    `AVAudioSession` warnings.
26. **Screenshare.** Browser shares a tab with audio: a "Name (screen)" tile appears
    with a bloop. Tap it: full screen; pinch to zoom, drag to pan, ⟲ rotates, the
    volume slider changes the shared tab's audio (0–200%). Stop sharing in the
    browser: the viewer closes and the tile goes. Lock the phone during a share and
    unlock: no second bloop. Airplane mode for 5 s while the browser shares: the
    share tile comes back with no second bloop. On Android too: ⟲ actually turns the
    video 90° and zoom stays within the screen — run this item early on Android; if
    rotation doesn't apply to the video, stop and report (it needs a design decision).
27. **Flip camera** from the ⟳ on the self-view tile.

## Room features (2b)

Server prerequisite: a deploy that serves `GET /api/soundboard`.

28. **Polls (voter).** A browser op creates a poll: a card appears in chat and the
    badge counts it; the Poll tab shows it. Vote, then change your vote: tallies and
    percentages update on both sides and your choice stays highlighted. Airplane mode
    5 s and back: your vote is still highlighted. The op closes it: "Closed", winner
    highlighted. The op creates a new poll: the old chat card reads "This poll was
    replaced."
29. **Polls (op).** Make the phone's user an op. ☰ → New poll… with 2–6 options
    (try 7 and an empty question: refused with a message). Close it from the card.
30. **Soundboard.** Chat sheet → 🔊: tap 🚀 — both the phone and the browser play it;
    the other buttons lock; the phone's button shows ⏹ and stops it. Let one finish on
    its own: the board unlocks for everyone. Start one from the browser: it plays on
    the phone and locks the board. Against a server without `/api/soundboard`, the 🔊
    tab is absent.
31. **Per-participant volume.** Long-press a tile: the slider goes 0–200%; 0% mutes
    that person, 200% is clearly louder; others are unaffected. Leave and rejoin the
    call: volumes reset to 100%. Airplane mode 5 s and back mid-call: volumes stay.
32. **Data saver.** ☰ → Data saver on: every tile shows avatars, audio continues,
    a screenshare's audio still plays. Leave and rejoin: still on. Off: video returns.
33. **Hide self-view.** ☰ → Hide self-view: your picture-in-picture disappears; the
    browser still sees your camera. Rejoin: still hidden.
34. **Recent rooms ×.** On Home, tap × on a Recent row: it disappears at once; quit
    and reopen the app: it's still gone; the other rooms remain.
