import AVFoundation
import React

// Plays chimes and soundboard clips inside the call's existing audio session.
// It must never set the category or mode or activate the session: CallKit and
// WebRTC own those, and changing them mid-call breaks call audio.
//
// All player state is confined to the main thread: every exported method hops to
// the main queue, and AVAudioPlayer delivers its delegate callbacks there too.
@objc(CoyoteSounds)
class CoyoteSounds: RCTEventEmitter, AVAudioPlayerDelegate {
  private var players: [String: AVAudioPlayer] = [:]
  private var listening = false

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteSoundEnded", "CoyoteSoundLoaded"] }
  override func startObserving() { DispatchQueue.main.async { [weak self] in self?.listening = true } }
  override func stopObserving() { DispatchQueue.main.async { [weak self] in self?.listening = false } }

  @objc(preload:uri:)
  func preload(_ id: String, uri: String) {
    if uri.hasPrefix("http://") || uri.hasPrefix("https://"), let remote = URL(string: uri) {
      let local = cachedURL(for: remote)
      if FileManager.default.fileExists(atPath: local.path) {
        DispatchQueue.main.async { [weak self] in self?.prepare(id, url: local, cached: local) }
        return
      }
      URLSession.shared.downloadTask(with: remote) { tmp, response, error in
        var ready: URL? = nil
        let okStatus = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } == true
        if let tmp = tmp, error == nil, okStatus {
          try? FileManager.default.removeItem(at: local)
          if (try? FileManager.default.moveItem(at: tmp, to: local)) != nil { ready = local }
        }
        DispatchQueue.main.async { [weak self] in
          if let ready = ready { self?.prepare(id, url: ready, cached: ready) } else { self?.fail(id) }
        }
      }.resume()
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if let url = self.resolve(uri) { self.prepare(id, url: url) } else { self.fail(id) }
    }
  }

  // Main thread only (Ruling 1).
  private func prepare(_ id: String, url: URL, cached: URL? = nil) {
    guard let p = try? AVAudioPlayer(contentsOf: url) else {
      if let cached = cached { try? FileManager.default.removeItem(at: cached) } // never keep a clip that will not play
      fail(id)
      return
    }
    p.delegate = self
    p.prepareToPlay()
    players[id] = p
    loaded(id, ok: true)
  }

  private func fail(_ id: String) {
    players[id] = nil // a failed (re)load never leaves a stale player behind
    loaded(id, ok: false)
  }

  private func loaded(_ id: String, ok: Bool) {
    if listening { sendEvent(withName: "CoyoteSoundLoaded", body: ["id": id, "ok": ok]) }
  }

  private func cachedURL(for remote: URL) -> URL {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("sounds", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let name = remote.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).replacingOccurrences(of: "/", with: "_")
    return dir.appendingPathComponent(name.isEmpty ? "clip" : name)
  }

  @objc(play:)
  func play(_ id: String) {
    DispatchQueue.main.async { [weak self] in
      guard let p = self?.players[id] else { return }
      p.currentTime = 0
      p.play()
    }
  }

  @objc(stop:)
  func stop(_ id: String) {
    DispatchQueue.main.async { [weak self] in
      guard let p = self?.players[id] else { return }
      p.stop()
      p.currentTime = 0
    }
  }

  // Delivered on the main thread, where `players` lives.
  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    guard listening, let id = players.first(where: { $0.value === player })?.key else { return }
    sendEvent(withName: "CoyoteSoundEnded", body: ["id": id])
  }

  private func resolve(_ uri: String) -> URL? {
    if uri.hasPrefix("asset:") {
      return Bundle.main.url(forResource: String(uri.dropFirst("asset:".count)), withExtension: "mp3")
    }
    return URL(string: uri)
  }
}
