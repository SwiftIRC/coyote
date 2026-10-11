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
  override func supportedEvents() -> [String]! { ["CoyoteSoundEnded"] }
  override func startObserving() { DispatchQueue.main.async { [weak self] in self?.listening = true } }
  override func stopObserving() { DispatchQueue.main.async { [weak self] in self?.listening = false } }

  @objc(preload:uri:)
  func preload(_ id: String, uri: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let url = self.resolve(uri), let p = try? AVAudioPlayer(contentsOf: url) else { return }
      p.delegate = self
      p.prepareToPlay()
      self.players[id] = p
    }
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
