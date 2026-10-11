import Foundation

// Client end of react-native-webrtc's screen-capture Unix socket in the App Group
// container. Based on the Jitsi Meet broadcast extension sample (Apache-2.0).
final class SocketConnection: NSObject {
  var didOpen: (() -> Void)?
  var didClose: ((Error?) -> Void)?
  var streamHasSpaceAvailable: (() -> Void)?

  private let filePath: String
  private var socketHandle: Int32 = -1
  private var address: sockaddr_un?
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var networkQueue: DispatchQueue?
  private var shouldKeepRunning = false

  init?(filePath path: String) {
    filePath = path
    socketHandle = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socketHandle != -1 else { return nil }
    super.init()
  }

  func open() -> Bool {
    guard FileManager.default.fileExists(atPath: filePath), setupAddress(), connectSocket() else { return false }
    setupStreams()
    inputStream?.open()
    outputStream?.open()
    return true
  }

  func close() {
    unscheduleStreams()
    inputStream?.delegate = nil
    outputStream?.delegate = nil
    inputStream?.close()
    outputStream?.close()
    inputStream = nil
    outputStream = nil
  }

  func writeToStream(buffer: UnsafePointer<UInt8>, maxLength length: Int) -> Int {
    outputStream?.write(buffer, maxLength: length) ?? 0
  }
}

extension SocketConnection: StreamDelegate {
  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    switch eventCode {
    case .openCompleted:
      if aStream == outputStream { didOpen?() }
    case .hasBytesAvailable:
      if aStream == inputStream {
        var buffer: UInt8 = 0
        let n = inputStream?.read(&buffer, maxLength: 1) ?? 0
        if n == 0 && inputStream?.streamStatus == .atEnd {
          close()
          didClose?(nil)
        }
      }
    case .hasSpaceAvailable:
      if aStream == outputStream { streamHasSpaceAvailable?() }
    case .errorOccurred:
      close()
      didClose?(aStream.streamError)
    default:
      break
    }
  }
}

private extension SocketConnection {
  func setupAddress() -> Bool {
    var addr = sockaddr_un()
    guard filePath.count < MemoryLayout.size(ofValue: addr.sun_path) else { return false }
    addr.sun_family = sa_family_t(AF_UNIX)
    _ = withUnsafeMutablePointer(to: &addr.sun_path.0) { ptr in
      filePath.withCString { strncpy(ptr, $0, filePath.count) }
    }
    address = addr
    return true
  }

  func connectSocket() -> Bool {
    guard var addr = address else { return false }
    let status = withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(socketHandle, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    return status == noErr
  }

  func setupStreams() {
    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, socketHandle, &readStream, &writeStream)
    inputStream = readStream?.takeRetainedValue()
    inputStream?.delegate = self
    inputStream?.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    outputStream = writeStream?.takeRetainedValue()
    outputStream?.delegate = self
    outputStream?.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    scheduleStreams()
  }

  func scheduleStreams() {
    shouldKeepRunning = true
    networkQueue = DispatchQueue.global(qos: .userInitiated)
    networkQueue?.async { [weak self] in
      self?.inputStream?.schedule(in: .current, forMode: .common)
      self?.outputStream?.schedule(in: .current, forMode: .common)
      RunLoop.current.run()
      var isRunning = false
      repeat {
        isRunning = (self?.shouldKeepRunning ?? false) && RunLoop.current.run(mode: .default, before: .distantFuture)
      } while isRunning
    }
  }

  func unscheduleStreams() {
    networkQueue?.sync { [weak self] in
      self?.inputStream?.remove(from: .current, forMode: .common)
      self?.outputStream?.remove(from: .current, forMode: .common)
    }
    shouldKeepRunning = false
  }
}
