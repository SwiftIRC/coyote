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
35. **Rejoin mid-poll.** With a poll open and your vote cast, toggle airplane mode for
    5 s and back: after rejoining, the poll card is in the chat log with the tallies and
    your vote highlighted, and the chat badge doesn't count it as unread. Joining a room
    that already has an open poll also shows its card.
36. **Leave mid-clip.** Start a soundboard clip and hang up while it plays: the audio
    stops immediately.
37. **Data saver during a screenshare.** While someone is screensharing, turn ☰ → Data
    saver on. Note what the screen tile shows (known risk: a frozen last frame rather
    than an avatar) and that the screenshare's audio keeps playing.

## Op moderation (1.3.0)

Server prerequisite: a deploy whose `joined` frame carries `locked` (members survive a
lock on reconnect). Run with the phone as op and a browser as the target, then swap.

38. **Mute and make op.** Long-press the browser's tile: the sheet shows the volume
    slider and Mute mic / Make op / Kick / Ban. Mute mic: the browser's mic turns off
    and the button reads "Muted"; the browser can unmute. Make op: a confirm appears;
    after it, the tile shows "@" and Make op disappears.
39. **Kick and ban.** Kick (confirm "Kick <name>?"): the browser is removed, the sheet
    closes, chat shows the moderation line. Rejoin from the browser, then Ban: the
    browser can't rejoin ("You are banned from this room.").
40. **Stop share.** The browser shares its screen; open it on the phone: Stop share
    ends it and the viewer closes. A non-op phone shows no Stop share button.
41. **Lock.** ☰ → Lock room…, enter a password, Lock: 🔒 appears in the phone's top
    bar and the browser shows "Room locked". A third client is refused without the
    password and admitted with it. Airplane mode on the phone for 10 s: it rejoins the
    locked room without asking for the password. ☰ → Unlock room: 🔒 goes away.
42. **Late joiner sees the lock.** Lock the room from the browser, then join from the
    phone (with the password): 🔒 shows immediately.
43. **Quality.** ☰ → Quality… → Camera → Low: the browser's camera visibly drops to
    360p·15 and the check moves; back to Auto. Repeat for Screen with a share running.
44. **Non-op.** As a non-op, long-press a tile: only the volume slider; ☰ has no Lock
    room or Quality. Get made op by the browser while the sheet is open: the actions
    appear.
45. **Being moderated.** With a browser op and the phone as the target:
    (a) **Force-mute:** the op clicks "mute" on the phone's tile. The phone's mic
    turns off, the in-app mic button shows muted, the browser shows the muted
    badge, and the phone can unmute itself.
    (b) **Kick** (as item 11): the phone returns to Home with "You were removed
    from the call by <op>." and does not rejoin.
    (c) **Ban:** the phone returns to Home with "You were banned from the call by
    <op>."; joining again from PreJoin shows "You are banned from this room."

## Screenshare sending (1.4.0)

Run with the phone in a call with a browser (and a second phone if available).

46. **iOS share.** ☰ → Share screen: the system "Screen Broadcast" sheet opens with
    Coyote selected. Start Broadcast; after the countdown the red pill "Sharing your
    screen · Stop" shows and a "You're sharing your screen" tile appears first in the
    grid. The browser shows the phone's screen tile within a few seconds. Switch to
    another app: the browser follows it; the phone's camera turns off while away and
    comes back on return. If the broadcast ends at once with "Start screen sharing
    from a Coyote call." during a call, the App Group (entitlements / provisioning) is
    not set up — see RELEASE.md.
47. **iOS cancel.** ☰ → Share screen, then dismiss the sheet: within 30 s the ☰ row
    reads "Share screen" again, and no error notice appears.
48. **iOS stop from the system.** While sharing, stop via Control Center (or the red
    status-bar pill): the phone's pill and tile disappear; the browser's tile goes.
49. **Stop from the app.** Tap the pill: the share ends everywhere (iOS shows its
    "Screen sharing stopped" alert). Repeat from ☰ → Stop sharing.
50. **Android share.** ☰ → Share screen: the "Start recording or casting?" prompt;
    Start → pill, own tile and the browser sees the screen; a "screen sharing"
    notification is shown. On Android 15+, choose "A single app" and confirm only
    that app is shared. The phone's camera may blink off and on while the consent
    prompt is up (Android pauses the app).
51. **Android denied.** ☰ → Share screen → Cancel: back to "Share screen", no notice.
52. **Android stop from the system.** Stop from the notification / status-bar chip:
    the share ends in the app and the browser.
53. **Op stops the share.** The browser op stops the phone's share: the phone shows
    "An op stopped your screen share." and the share ends.
54. **Reconnect mid-share.** While sharing, airplane mode for ~10 s, then off: the
    phone rejoins and the browser sees the screen again without re-sharing.
55. **Quality.** A browser op sets Screen quality to Low: the phone's share visibly
    drops; back to Auto.
56. **Leave while sharing.** Leave the call: the share ends (iOS broadcast stops,
    Android notification goes).
57. **Extension without a call (iOS).** Start a broadcast to Coyote from Control
    Center with no call open: it ends within ~5 s with "Start screen sharing from a
    Coyote call."
58. **Lock the phone while sharing.** iOS: locking ends the broadcast; on unlock the
    pill and own tile are gone and the browser's tile went when it ended. Android: the
    share keeps running (the browser may see a black/secure frame) and the pill is
    still there on unlock.
59. **A second phone sees the share.** With another phone in the call, it shows the
    sharing phone's screen tile and can open it full screen.

## Background effects (1.5.0)

Server prerequisite: a deploy with `GET /api/scenes`. Run on both platforms with a
browser in the call to watch the result.

60. **PreJoin.** The Background row reads "None". Open it: None, Blur, Blur+, then
    the server's scenes (thumbnails). Pick Blur: the preview blurs behind you within
    a second; Blur+ is stronger; a scene replaces the background. The choice is
    remembered after leaving and reopening PreJoin.
61. **In the call.** Join with Blur: the browser sees you blurred. ☰ → Background… →
    a scene: the browser sees the scene, upright, filling the frame (not stretched).
    Back to None: the plain camera returns.
62. **Orientation.** With an effect on, hold the phone in portrait, then landscape:
    the person cut-out lines up with you in both (a rotated or offset cut-out means
    the frame rotation is handled wrongly).
63. **Flip and camera off/on.** With an effect on, flip to the back camera and back;
    turn the camera off and on; background the app and return: the effect stays on.
64. **Android resolution.** With an effect on, the browser's stats (or the tile) show
    a 640×360 / 360×640 camera from the Android phone (640×480 / 480×640 on a 4:3
    camera, not stretched); with None, the normal 720p. With the effect still on, a
    browser op sets Camera quality to Low: the phone's camera stays at 360p (not 180p).
65. **Slow phone.** On an older phone, pick Blur+: if it cannot keep up, within a few
    seconds the effect turns off with "Background effect turned off: this phone
    couldn't keep up." Flipping or turning the camera off and on keeps it off (no
    second notice); picking it again tries again.
66. **Offline / older server.** In airplane mode (or against a server without
    `/api/scenes`), the sheet shows None/Blur/Blur+ and "Scenes currently unavailable";
    a saved scene choice joins with no effect and no error.
67. **Quick changes.** Tap a scene and immediately Blur: you end up blurred, not on
    the scene.
68. **Battery and heat.** Ten minutes with Blur on: the call stays smooth and the
    phone does not get uncomfortably hot.
69. **Colour.** Switch between None and Blur on iOS: skin tones and colours look the
    same (a colour shift means the composite's pixel format needs BGRA).
70. **Android call audio (risk check, do first).** On an Android 14+ phone and an
    Android 9–13 device: join a call and hear the others; they hear you. Audio-only
    call: it starts on the earpiece and the screen turns off at your ear. Video call:
    it starts on the speaker. (No call audio at all means Telecom didn't set the
    call audio mode: report it; the fix is to start incall-manager for the mode only.)
71. **Output list.** Tap the audio button: a sheet lists Phone, Speaker and any
    headset; the current one has ✓. Pick Speaker, then Phone: audio moves each time
    and the button follows.
72. **Two Bluetooth devices.** Connect two (earbuds and a speaker or car): both are
    listed by name; picking each moves the call audio there. Mute and unmute your mic:
    both stay listed.
73. **Changes from outside the app.** Mid-call, put the earbuds in their case, turn
    Bluetooth off and on, plug in a wired headset: the button's label follows each
    change; an open sheet updates live.
74. **Tablet.** On the tablet: the list shows Speaker (plus any Bluetooth), never
    Phone.
75. **Failed switch.** Pick a Bluetooth device and switch it off at the same moment:
    within 5 s "Couldn't switch to <name>." appears and the label shows the real
    output.
76. **iPhone output.** Tap the audio button: the devices sheet opens; its Output row
    shows the current output. Tap the row: Apple's output sheet opens and lists
    iPhone, Speaker, AirPods etc. Pick each: audio moves and the row and button
    follow. Switch from Control Centre: they follow too. Video calls still start on
    the speaker. VoiceOver reads "Audio and video devices. Output: <name>" on the
    button and "Audio output: <name>. Change" on the row.
77. **Leaving.** After leaving a call (Android): the screen times out normally again
    and the proximity sensor no longer blanks it.
78. **Devices sheet (Android).** Tap the audio button: Output, Microphone and Camera
    sections; picking a row keeps the sheet open and moves the ✓ (with "…" briefly).
79. **Android microphones.** With Bluetooth earbuds connected: Microphone lists Phone
    microphone and the earbuds by name. Pick the earbuds' mic: output moves to them
    and the others hear you through them. Pick Phone microphone: output moves to the
    earpiece (audio-only call) or the speaker (video call). With a wired headset,
    "Headset microphone" appears and works the same way.
80. **Android cameras.** Camera lists every camera ("Front camera", "Back camera",
    "Back camera 2" …). Pick each with the camera on: the self-view and what others
    see switch live; a background effect stays on. Flip after a pick: the ✓ follows.
81. **iPhone microphones.** Microphone lists iPhone Microphone and, when connected,
    AirPods / a wired headset mic. Pick each: the others hear you through it; picking
    AirPods also moves the output to them.
82. **iPhone cameras.** Camera lists Front Camera, Back Camera and, where the phone has
    them, Back Ultra Wide / Telephoto. Pick each: switches live. Flip after a pick works.
83. **iPad USB devices.** Plug in a USB camera and a USB mic: both listed and
    selectable. Unplug the camera, turn the camera off and on: it falls back to the
    back camera.
84. **Camera picked while off.** Turn the camera off, pick another camera (the ✓
    moves, nothing turns on), turn the camera on: that camera is used.
85. **iPhone microphone doesn't carry over.** With AirPods connected, pick iPhone
    Microphone in a call, leave, and start another call with the AirPods still in:
    it starts on the AirPods (the system's choice), not the iPhone mic.
86. **R8 release build (Android).** On a Play (release) build: sign in, join a video
    call, chat, play a board sound, turn on a background effect, share the screen,
    switch output/mic/camera from the devices sheet, take an incoming call from the
    lock screen, leave. Nothing crashes (check `adb logcat` for `FATAL EXCEPTION`).

## Picture-in-picture (1.8.0, Android)

87. **Auto-enter (Android 12+).** In a video call, press Home and then swipe up from
    another app: the call shrinks smoothly into a floating window each time. The others
    still see your camera and hear you.
88. **Older Android (8–11, if a device is available).** Press Home in a call: it enters
    PiP.
89. **PiP buttons.** Tap the window: Mute shows a mic icon; tap it: others stop hearing
    you and it turns into Unmute (mic-off icon); tap again: back. Muting from the call
    screen before going to PiP shows Unmute. Hang up ends the call.
90. **Hang up / kicked in PiP.** Hang up from the window, and (in another call) get kicked
    by an op while in PiP: the window expands to the app, showing Home (with the
    "removed" message for the kick).
91. **Swipe the window away.** You stay in the call (notification shown); others see your
    camera go off. Open the app: camera back on, full call screen.
92. **Screenshare in PiP.** Someone shares: the window shows the share in 16:9 and "+N";
    when they stop, it switches to the first person in 3:4.
93. **Sheets and the viewer.** Open the chat sheet with the keyboard up, press Home: the
    window shows the tile. Expand: the call screen with nothing open. Same with the
    full-screen screen viewer open.
94. **Alone.** Alone in the room, press Home: the window shows your self view (or your
    initials with the camera off or Hide self on).
95. **Expand.** Tap the window, then expand: back to the full call screen, camera still
    on, no duplicate app window in Recents.
96. **Not outside calls.** Press Home on Home, on PreJoin and while "Connecting…": no PiP.
97. **PiP off in settings.** Settings → Apps → Coyote → Picture-in-picture off: Home in a
    call behaves as before (camera off in the background, back on return). Turn it on again.
98. **Incoming phone call in PiP.** Answer a phone call while the window is up: nothing
    crashes; the call carries on afterwards.

## Closing sheets (iOS and Android)

99. **Drag down anywhere.** In a call, open Chat and drag down on the tab row, then on the
    empty Poll tab ("No poll in this room"), then on the 🔊 tab: each closes the sheet. A
    short drag springs back.
100. **Lists scroll first.** With a long chat, scroll up into the history and drag down: the
     list scrolls, the sheet stays. Scroll to the very top and pull down again: the sheet
     follows your finger and closes. Same in More (scrolled down) and the poll form.
101. **Taps and sideways drags.** In each sheet (Chat, More, Devices, Background, a person's
     sheet, New poll): buttons, toggles, tabs, the volume slider, text fields and sending a
     message all still work; nothing closes by accident.
102. **Android back.** With each sheet open, press back (button or gesture): the sheet
     closes and you stay in the call. Back again with nothing open: "Leave call?".
103. **Keyboard up.** Chat with the keyboard up: dragging the sheet down closes it and the
     keyboard; on Android, back first hides the keyboard, then closes the sheet.

## Switching cameras (iOS and Android)

104. **Flip and pick.** In a call with someone watching, flip cameras from your self-view,
     then pick each camera in Devices: your preview and their view switch within about a
     second, with no long black gap, and keep working after several switches back and
     forth. With a background effect on, it stays on across the switch.
