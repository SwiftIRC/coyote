import AVFoundation
import React

// Reports the call's current audio output and the available microphones, and sets
// the preferred microphone. iOS has no API to list or pick outputs by name: choosing
// happens in Apple's route picker (CoyoteRoutePicker), and this keeps the labels in
// step, including switches from Control Centre or CallKit. It never touches the
// session's category, mode or output override.
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

  @objc(selectInput:resolver:rejecter:)
  func selectInput(_ uid: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let session = AVAudioSession.sharedInstance()
    guard let port = session.availableInputs?.first(where: { $0.uid == uid }) else {
      reject("unknown-input", "No input \(uid)", nil)
      return
    }
    do {
      try session.setPreferredInput(port)
      resolve(nil)
    } catch {
      reject("select-failed", error.localizedDescription, error)
    }
  }

  // The preferred input is session-wide and outlives the call: back to the system's
  // choice when a call ends, so a mic picked in one call doesn't carry into the next.
  @objc func resetInput() {
    try? AVAudioSession.sharedInstance().setPreferredInput(nil)
  }

  private static func snapshot() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let inputs: [[String: Any]] = (session.availableInputs ?? []).map {
      ["id": $0.uid, "kind": inputKind($0.portType), "name": $0.portName]
    }
    let input = session.currentRoute.inputs.first?.uid ?? ""
    guard let port = session.currentRoute.outputs.first else {
      return ["outputs": [], "selected": "", "inputs": inputs, "input": input]
    }
    let output: [String: Any] = ["id": port.uid, "kind": kind(port.portType), "name": port.portName]
    return ["outputs": [output], "selected": port.uid, "inputs": inputs, "input": input]
  }

  private static func inputKind(_ type: AVAudioSession.Port) -> String {
    switch type {
    case .usbAudio: return "usb"
    case .headsetMic, .lineIn: return "wired"
    case .bluetoothHFP, .bluetoothLE: return "bluetooth"
    default: return "builtin"
    }
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
