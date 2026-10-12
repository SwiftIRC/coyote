import AVFoundation
import React

// Reports the call's current audio output. iOS has no API to list or pick outputs by
// name: choosing happens in Apple's route picker (CoyoteRoutePicker), and this keeps
// the button's label in step, including switches from Control Centre or CallKit.
// It never touches the session's category, mode or output override.
@objc(CoyoteAudioRoute)
class CoyoteAudioRoute: RCTEventEmitter {
  private var listening = false

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteAudioRoutes"] }

  override func startObserving() {
    listening = true
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
  }

  override func stopObserving() {
    listening = false
    NotificationCenter.default.removeObserver(self, name: AVAudioSession.routeChangeNotification, object: nil)
  }

  @objc private func routeChanged(_ note: Notification) {
    if listening { sendEvent(withName: "CoyoteAudioRoutes", body: Self.snapshot()) }
  }

  @objc(routes:rejecter:)
  func routes(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.snapshot())
  }

  private static func snapshot() -> [String: Any] {
    guard let port = AVAudioSession.sharedInstance().currentRoute.outputs.first else {
      return ["outputs": [], "selected": ""]
    }
    let output: [String: Any] = ["id": port.uid, "kind": kind(port.portType), "name": port.portName]
    return ["outputs": [output], "selected": port.uid]
  }

  private static func kind(_ type: AVAudioSession.Port) -> String {
    switch type {
    case .builtInReceiver: return "earpiece"
    case .builtInSpeaker: return "speaker"
    case .headphones, .usbAudio, .lineOut: return "wired"
    case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
    case .carAudio: return "car"
    default: return "speaker"
    }
  }
}
