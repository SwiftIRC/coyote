import CoreImage
import Foundation
import ReplayKit

// Encodes each video sample as a half-size JPEG framed as an HTTP message and
// writes it to the socket in chunks. One frame in flight at a time: frames that
// arrive while one is still being written are dropped. Half size and JPEG keep the
// extension under its 50 MB memory limit. Based on the Jitsi Meet sample (Apache-2.0).
final class SampleUploader {
  private static let chunkSize = 10240
  private static let imageContext = CIContext(options: nil)

  private let connection: SocketConnection
  private let queue = DispatchQueue(label: "net.swiftirc.coyote.broadcast.uploader")
  private let lock = NSLock()
  private var ready = false
  private var dataToSend: Data?
  private var byteIndex = 0

  init(connection: SocketConnection) {
    self.connection = connection
    connection.didOpen = { [weak self] in self?.setReady(true) }
    connection.streamHasSpaceAvailable = { [weak self] in
      self?.queue.async {
        guard let self = self else { return }
        let sent = self.sendChunk()
        self.setReady(!sent)
      }
    }
  }

  @discardableResult
  func send(sample buffer: CMSampleBuffer) -> Bool {
    lock.lock()
    guard ready else {
      lock.unlock()
      return false
    }
    ready = false
    lock.unlock()
    let data = prepare(sample: buffer)
    queue.async { [weak self] in
      guard let self = self else { return }
      self.dataToSend = data
      self.byteIndex = 0
      if !self.sendChunk() { self.setReady(true) }
    }
    return true
  }

  private func setReady(_ value: Bool) {
    lock.lock()
    ready = value
    lock.unlock()
  }

  // Writes the next chunk; false when there was nothing (left) to send.
  private func sendChunk() -> Bool {
    guard let data = dataToSend else { return false }
    let left = data.count - byteIndex
    let length = min(left, SampleUploader.chunkSize)
    let written = data[byteIndex..<(byteIndex + length)].withUnsafeBytes { raw -> Int in
      guard let ptr = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
      return connection.writeToStream(buffer: ptr, maxLength: length)
    }
    if written > 0 {
      byteIndex += written
      if byteIndex >= data.count {
        dataToSend = nil
        byteIndex = 0
      }
    }
    return true
  }

  private func prepare(sample buffer: CMSampleBuffer) -> Data? {
    guard let imageBuffer = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }
    let scale: CGFloat = 0.5
    let width = Int(CGFloat(CVPixelBufferGetWidth(imageBuffer)) * scale)
    let height = Int(CGFloat(CVPixelBufferGetHeight(imageBuffer)) * scale)
    let orientation = (CMGetAttachment(buffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value ?? 0
    let image = CIImage(cvPixelBuffer: imageBuffer).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let colorSpace = image.colorSpace,
          let jpeg = SampleUploader.imageContext.jpegRepresentation(
            of: image, colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8])
    else { return nil }
    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }
}
