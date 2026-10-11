import React
import ReplayKit
import UIKit

// Opens the system "Start Broadcast" sheet with our CoyoteBroadcast extension
// preselected, and tells JS when the extension has connected to
// react-native-webrtc's screen-capture socket (the extension posts a Darwin
// notification then). The picker is a hidden RPSystemBroadcastPickerView whose
// button we tap programmatically — the only public way to open that sheet.
@objc(CoyoteScreenShare)
class CoyoteScreenShare: RCTEventEmitter {
  private static let startedName = "net.swiftirc.coyote.broadcast.started"
  private var picker: RPSystemBroadcastPickerView?
  private var listening = false

  override init() {
    super.init()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), observer,
      { _, observer, _, _, _ in
        guard let observer = observer else { return }
        let me = Unmanaged<CoyoteScreenShare>.fromOpaque(observer).takeUnretainedValue()
        DispatchQueue.main.async { me.broadcastStarted() }
      },
      CoyoteScreenShare.startedName as CFString, nil, .deliverImmediately)
  }

  deinit {
    CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteBroadcastStarted"] }
  override func startObserving() { DispatchQueue.main.async { [weak self] in self?.listening = true } }
  override func stopObserving() { DispatchQueue.main.async { [weak self] in self?.listening = false } }

  // Resolves once the sheet's button is tapped; rejects when there is nothing to
  // present it from, so JS reports a failure at once instead of waiting it out.
  @objc(showPicker:rejecter:)
  func showPicker(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        reject("no_window", "No window to present the broadcast picker", nil)
        return
      }
      // Rebuild a picker whose window has gone (or that was never made).
      if self.picker?.window == nil {
        self.picker?.removeFromSuperview()
        self.picker = nil
      }
      guard let picker = self.picker ?? self.makePicker() else {
        reject("no_window", "No window to present the broadcast picker", nil)
        return
      }
      guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
        NSLog("[CoyoteScreenShare] broadcast picker button not found")
        reject("no_picker_button", "Broadcast picker button not found", nil)
        return
      }
      button.sendActions(for: .touchUpInside)
      resolve(nil)
    }
  }

  private func broadcastStarted() {
    if listening { sendEvent(withName: "CoyoteBroadcastStarted", body: nil) }
  }

  // Lives, invisible, in the key window: the picker presents its sheet from there.
  private func makePicker() -> RPSystemBroadcastPickerView? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    guard let window = window else { return nil }
    let p = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    p.preferredExtension = Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") as? String
    p.showsMicrophoneButton = false
    p.alpha = 0
    p.isUserInteractionEnabled = false
    window.addSubview(p)
    picker = p
    return p
  }
}
