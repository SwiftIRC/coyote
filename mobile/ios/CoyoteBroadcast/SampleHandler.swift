import ReplayKit

// The broadcast extension: connects to the Coyote app's screen-capture socket and
// streams every third video frame to it. Posts "started" once connected (the app
// waits for that to confirm the share); gives up after 5 s if no call is listening.
// Based on the Jitsi Meet sample (Apache-2.0).
class SampleHandler: RPBroadcastSampleHandler {
  private static let appGroup = "group.net.swiftirc.coyote"
  private static let startedNotification = "net.swiftirc.coyote.broadcast.started"
  private static let connectAttempts = 50 // × 100 ms

  private var connection: SocketConnection?
  private var uploader: SampleUploader?
  private var frameCount = 0
  private var connectTimer: DispatchSourceTimer?

  private var socketPath: String {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SampleHandler.appGroup)?
      .appendingPathComponent("rtc_SSFD").path ?? ""
  }

  override init() {
    super.init()
    if let c = SocketConnection(filePath: socketPath) {
      connection = c
      uploader = SampleUploader(connection: c)
      c.didClose = { [weak self] error in
        self?.finish(error?.localizedDescription ?? "Screen sharing stopped")
      }
    }
  }

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    frameCount = 0
    var attempts = 0
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "net.swiftirc.coyote.broadcast.connect"))
    timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(50))
    timer.setEventHandler { [weak self] in
      guard let self = self else { return }
      attempts += 1
      if self.connection?.open() == true {
        timer.cancel()
        CFNotificationCenterPostNotification(
          CFNotificationCenterGetDarwinNotifyCenter(),
          CFNotificationName(SampleHandler.startedNotification as CFString), nil, nil, true)
      } else if attempts >= SampleHandler.connectAttempts {
        timer.cancel()
        self.finish("Start screen sharing from a Coyote call.")
      }
    }
    connectTimer = timer
    timer.resume()
  }

  override func broadcastFinished() {
    connectTimer?.cancel()
    connection?.close()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return } // video only: app and mic audio are ignored
    frameCount += 1
    if frameCount % 3 == 0 { uploader?.send(sample: sampleBuffer) }
  }

  private func finish(_ message: String) {
    finishBroadcastWithError(NSError(domain: RPRecordingErrorDomain, code: 10001, userInfo: [NSLocalizedDescriptionKey: message]))
  }
}
