package server

import (
	"encoding/json"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/SwiftIRC/coyote/internal/web"
)

// The soundboard is whatever .mp3 files are in assets/sounds/board/, discovered at
// startup exactly as the background scenes are (see scenes.go): drop a file in,
// rebuild, and it appears. The directory holds only board sounds, so the call chimes
// one level up can never turn into buttons.
//
// Each file's name IS its button. Ideally that would be the emoji itself, but
// go:embed refuses any non-ASCII filename that is not a letter ("invalid name
// 🚀.mp3"), so the stem is the emoji's codepoints in hex, dash-joined for sequences —
// the twemoji convention: 1f680.mp3 is 🚀, 1f468-200d-1f4bb.mp3 is 👨‍💻. The hex stem
// doubles as the sound's wire id, which keeps the protocol plain ASCII.

// sound is what the client receives: the wire id, the emoji to show, and a
// version-stamped src (absolute for the same reason a scene's is).
type sound struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Src   string `json:"src"`
}

// soundboardDir is the one directory whose .mp3 contents are board sounds.
const soundboardDir = "sounds/board"

// buildSoundboard lists the board sounds this build embedded, sorted by filename so
// the cached shell is deterministic. A file whose stem does not decode to codepoints
// has nothing to show and is left off.
func buildSoundboard(assets fs.FS, version string) []sound {
	files, err := fs.Glob(assets, soundboardDir+"/*.mp3")
	if err != nil {
		return []sound{}
	}
	sort.Strings(files)
	out := make([]sound, 0, len(files))
	for _, f := range files {
		base := path.Base(f)
		id := strings.TrimSuffix(base, path.Ext(base))
		label, ok := emojiFromStem(id)
		if !ok {
			continue
		}
		out = append(out, sound{
			ID:    id,
			Label: label,
			Src:   "/v/" + version + "/" + soundboardDir + "/" + base,
		})
	}
	return out
}

// emojiFromStem decodes "1f468-200d-1f4bb" into the string those codepoints spell.
// Every dash-separated part must be a hex number naming a valid Unicode scalar.
func emojiFromStem(stem string) (string, bool) {
	if stem == "" {
		return "", false
	}
	var b strings.Builder
	for _, part := range strings.Split(stem, "-") {
		n, err := strconv.ParseUint(part, 16, 32)
		if err != nil || !utf8.ValidRune(rune(n)) {
			return "", false
		}
		b.WriteRune(rune(n))
	}
	return b.String(), true
}

// soundboardJSON renders the board for injection into the app shell; see scenesJSON
// for why a failure is an empty array and why the output is <script>-safe.
func soundboardJSON(board []sound) []byte {
	b, err := json.Marshal(board)
	if err != nil {
		return []byte("[]")
	}
	return b
}

// embeddedSoundboard is this build's board, computed once at startup from the same
// embedded FS everything else is served from. The page and the dispatcher's validity
// check both read it, so they cannot disagree about which sounds exist.
var embeddedSoundboard = buildSoundboard(web.Assets, assetsVersion)

var soundboardIDs = func() map[string]struct{} {
	m := make(map[string]struct{}, len(embeddedSoundboard))
	for _, s := range embeddedSoundboard {
		m[s.ID] = struct{}{}
	}
	return m
}()

// knownSound reports whether id names a sound on this build's board. The room only
// relays the id, so this is what stops a client broadcasting one nobody can play.
func knownSound(id string) bool {
	_, ok := soundboardIDs[id]
	return ok
}
