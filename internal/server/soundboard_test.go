package server

import (
	"encoding/json"
	"strings"
	"testing"
	"testing/fstest"
)

func mp3() *fstest.MapFile { return &fstest.MapFile{Data: []byte("mp3")} }

// The board is exactly assets/sounds/board/*.mp3: the call chimes live one level up
// and must never become buttons, and nothing is picked up recursively.
func TestBuildSoundboardTakesOnlyTheBoardDirectory(t *testing.T) {
	assets := fstest.MapFS{
		"sounds/board/1f680.mp3":      mp3(),
		"sounds/board/1f389.mp3":      mp3(),
		"sounds/chime.mp3":            mp3(), // a sibling sound, not a board sound
		"sounds/board/README.md":      &fstest.MapFile{Data: []byte("# docs")},
		"sounds/board/deep/1f600.mp3": mp3(), // not recursive
	}
	var ids []string
	for _, s := range buildSoundboard(assets, "v1") {
		ids = append(ids, s.ID)
	}
	if strings.Join(ids, ",") != "1f389,1f680" {
		t.Fatalf("ids = %v, want 1f389,1f680", ids)
	}
}

// The filename IS the label: its stem is the emoji's codepoints in hex, dash-joined
// for sequences (the twemoji convention). go:embed refuses emoji filenames outright,
// so this is as close to "the file is named with the emoji" as the build allows.
func TestSoundboardLabelsDecodeCodepoints(t *testing.T) {
	for stem, want := range map[string]string{
		"1f680":            "🚀",
		"1F680":            "🚀",
		"2764-fe0f":        "❤️",
		"1f468-200d-1f4bb": "👨‍💻",
	} {
		got, ok := emojiFromStem(stem)
		if !ok || got != want {
			t.Errorf("emojiFromStem(%q) = %q, %v; want %q", stem, got, ok, want)
		}
	}
}

// A stem that is not a codepoint list has no label to show, so it is left off the
// board rather than rendered as a blank or garbage button.
func TestSoundboardSkipsUnreadableNames(t *testing.T) {
	for _, stem := range []string{"", "rocket", "1f680-", "-1f680", "1f680--1f389", "110000", "d800", "1f680 1f389"} {
		if got, ok := emojiFromStem(stem); ok {
			t.Errorf("emojiFromStem(%q) = %q, want refused", stem, got)
		}
	}
	assets := fstest.MapFS{
		"sounds/board/rocket.mp3": mp3(),
		"sounds/board/1f680.mp3":  mp3(),
	}
	got := buildSoundboard(assets, "v1")
	if len(got) != 1 || got[0].ID != "1f680" || got[0].Label != "🚀" {
		t.Fatalf("board = %+v, want just 1f680/🚀", got)
	}
}

// Same reasoning as the scenes: absolute and version-stamped, so it caches like
// every other asset and never resolves against a room path.
func TestBuildSoundboardStampsAbsoluteVersionedSrc(t *testing.T) {
	got := buildSoundboard(fstest.MapFS{"sounds/board/1f680.mp3": mp3()}, "deadbeef")
	if len(got) != 1 || got[0].Src != "/v/deadbeef/sounds/board/1f680.mp3" {
		t.Fatalf("board = %+v, want src /v/deadbeef/sounds/board/1f680.mp3", got)
	}
}

// The shell is built once and cached, and an empty board must still be an array.
func TestSoundboardJSONIsAlwaysAnArray(t *testing.T) {
	b := soundboardJSON(buildSoundboard(fstest.MapFS{}, "v1"))
	var out []sound
	if err := json.Unmarshal(b, &out); err != nil || string(b) == "null" || len(out) != 0 {
		t.Fatalf("empty board = %s (err %v), want []", b, err)
	}
}

// The shipped build carries the rocket, and the dispatcher's validity check agrees
// with what the page was given.
func TestEmbeddedSoundboardHasTheRocket(t *testing.T) {
	if !knownSound("1f680") {
		t.Fatal("embedded board is missing 1f680 (🚀)")
	}
	if knownSound("") || knownSound("nope") || knownSound("../door_open") {
		t.Fatal("knownSound accepted an id that is not on the board")
	}
}
