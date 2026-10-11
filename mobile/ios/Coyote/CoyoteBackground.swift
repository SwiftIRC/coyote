import CoreImage
import CoreVideo
import CryptoKit
import Foundation
import QuartzCore
import React
import Vision

// A pool of pixel buffers of one size and format, rebuilt when either changes.
private final class PixelPool {
  private var pool: CVPixelBufferPool?
  private var key = ""

  func make(_ width: Int, _ height: Int, _ format: OSType) -> CVPixelBuffer? {
    let k = "\(width)x\(height)/\(format)"
    if pool == nil || key != k {
      let attrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: format,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
      ]
      var created: CVPixelBufferPool?
      CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &created)
      pool = created
      key = k
    }
    guard let pool = pool else { return nil }
    var out: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &out)
    return out
  }
}

// Background effects for the camera. Segments the person with Vision and composites
// them over a blurred copy of the frame or a scene with Core Image, all upright. The
// ObjC processor in CoyoteBackground.m calls `process` for every camera frame; nil
// means "pass the frame through" (no effect, or the breaker has tripped).
@objc(CoyoteBackgroundEngine)
final class CoyoteBackgroundEngine: NSObject {
  @objc static let shared = CoyoteBackgroundEngine()

  enum Effect {
    case blur(Double) // fraction of the short side
    case scene(CIImage)
  }

  // Called on the main queue with "slow" or "failed".
  var onTrip: ((String) -> Void)?

  private static let budgetMs = 45.0
  private static let warmup: CFTimeInterval = 2
  private static let slowFor: CFTimeInterval = 3
  private static let segmentEvery: CFTimeInterval = 1.0 / 15
  private static let segmentHeight: CGFloat = 384

  private let lock = NSLock()
  private var effect: Effect?
  private var tripped = false
  private var armedAt: CFTimeInterval = 0
  private var avgMs = 0.0
  private var slowSince: CFTimeInterval?
  private var mask: CIImage?
  private var maskAt: CFTimeInterval = 0
  private var maskExtent = CGRect.zero // the upright frame the mask was made for

  private let context = CIContext(options: [.cacheIntermediates: false])
  private let request: VNGeneratePersonSegmentationRequest = {
    let r = VNGeneratePersonSegmentationRequest()
    r.qualityLevel = .balanced
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return r
  }()
  private let sequence = VNSequenceRequestHandler()
  private let outPool = PixelPool()
  private let segPool = PixelPool()

  // nil turns the effect off. Re-arms the breaker.
  func configure(_ next: Effect?) {
    lock.lock()
    effect = next
    tripped = false
    armedAt = CACurrentMediaTime()
    avgMs = 0
    slowSince = nil
    mask = nil
    lock.unlock()
  }

  @objc(process:rotation:)
  func process(_ src: CVPixelBuffer, rotation: Int) -> CVPixelBuffer? {
    lock.lock()
    defer { lock.unlock() }
    guard let effect = effect, !tripped else { return nil }
    let t0 = CACurrentMediaTime()
    let oriented = CIImage(cvPixelBuffer: src).oriented(Self.orientation(for: rotation))
    let frame = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.origin.x, y: -oriented.extent.origin.y))
    let extent = frame.extent
    if extent.size != maskExtent.size { mask = nil } // rotated or resized: segment again now
    if mask == nil || t0 - maskAt >= Self.segmentEvery {
      guard let fresh = segment(frame) else {
        trip("failed")
        return nil
      }
      mask = fresh
      maskAt = t0
      maskExtent = extent
    }
    guard let mask = mask,
          let out = outPool.make(Int(extent.width), Int(extent.height), CVPixelBufferGetPixelFormatType(src))
    else {
      trip("failed")
      return nil
    }
    let fitted = mask
      .transformed(by: CGAffineTransform(scaleX: extent.width / mask.extent.width, y: extent.height / mask.extent.height))
      .clampedToExtent()
      .applyingGaussianBlur(sigma: 2)
      .cropped(to: extent)
    let background: CIImage
    switch effect {
    case .blur(let radius):
      background = frame.clampedToExtent()
        .applyingGaussianBlur(sigma: radius * Double(min(extent.width, extent.height)))
        .cropped(to: extent)
    case .scene(let image):
      let s = max(extent.width / image.extent.width, extent.height / image.extent.height)
      let scaled = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
      background = scaled.transformed(by: CGAffineTransform(
        translationX: (extent.width - scaled.extent.width) / 2 - scaled.extent.origin.x,
        y: (extent.height - scaled.extent.height) / 2 - scaled.extent.origin.y
      )).cropped(to: extent)
    }
    let composite = frame.applyingFilter("CIBlendWithMask", parameters: [
      kCIInputBackgroundImageKey: background,
      kCIInputMaskImageKey: fitted,
    ])
    context.render(composite, to: out)
    watch(since: t0)
    return out
  }

  // The person mask for an upright frame, from a downscaled upright copy.
  private func segment(_ frame: CIImage) -> CIImage? {
    let scale = min(1, Self.segmentHeight / frame.extent.height)
    let w = Int((frame.extent.width * scale).rounded())
    let h = Int((frame.extent.height * scale).rounded())
    guard w > 0, h > 0, let small = segPool.make(w, h, kCVPixelFormatType_32BGRA) else { return nil }
    context.render(frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale)), to: small)
    do {
      try sequence.perform([request], on: small, orientation: .up)
    } catch {
      NSLog("[CoyoteBackground] segmentation failed: \(error)")
      return nil
    }
    guard let pb = request.results?.first?.pixelBuffer else { return nil }
    return CIImage(cvPixelBuffer: pb)
  }

  // Rolling average of the per-frame cost; trips after slowFor seconds over budget.
  private func watch(since t0: CFTimeInterval) {
    let now = CACurrentMediaTime()
    let ms = (now - t0) * 1000
    avgMs = avgMs == 0 ? ms : avgMs * 0.8 + ms * 0.2
    if now - armedAt < Self.warmup { return }
    if avgMs > Self.budgetMs {
      if let since = slowSince {
        if now - since >= Self.slowFor { trip("slow") }
      } else {
        slowSince = now
      }
    } else {
      slowSince = nil
    }
  }

  // Called with the lock held.
  private func trip(_ reason: String) {
    tripped = true
    let callback = onTrip
    DispatchQueue.main.async { callback?(reason) }
  }

  // RTCVideoRotation (degrees clockwise to display upright) → image orientation.
  private static func orientation(for rotation: Int) -> CGImagePropertyOrientation {
    switch rotation {
    case 90: return .right
    case 180: return .down
    case 270: return .left
    default: return .up
    }
  }
}

// Configures the shared engine from JS and reports trips. Exported methods hop to
// the main queue; the latest setEffect wins even if an earlier scene download
// finishes after it.
@objc(CoyoteBackground)
class CoyoteBackground: RCTEventEmitter {
  private var listening = false
  private var token = 0

  override init() {
    super.init()
    CoyoteBackgroundEngine.shared.onTrip = { [weak self] reason in
      guard let self = self, self.listening else { return }
      self.sendEvent(withName: "CoyoteBackgroundTripped", body: ["reason": reason])
    }
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteBackgroundTripped"] }
  override func startObserving() { DispatchQueue.main.async { [weak self] in self?.listening = true } }
  override func stopObserving() { DispatchQueue.main.async { [weak self] in self?.listening = false } }

  @objc(setEffect:resolver:rejecter:)
  func setEffect(_ effect: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      self.token += 1
      let mine = self.token
      switch effect["kind"] as? String {
      case "blur":
        let radius = (effect["radius"] as? NSNumber)?.doubleValue ?? 0.012
        CoyoteBackgroundEngine.shared.configure(.blur(radius))
        resolve(nil)
      case "scene":
        guard let s = effect["url"] as? String, let url = URL(string: s) else {
          reject("bad_effect", "scene without a url", nil)
          return
        }
        self.loadScene(url) { image in
          DispatchQueue.main.async {
            guard let image = image else {
              reject("scene_failed", "Couldn't load \(s)", nil)
              return
            }
            if self.token == mine { CoyoteBackgroundEngine.shared.configure(.scene(image)) }
            resolve(nil)
          }
        }
      default:
        reject("bad_effect", "unknown effect kind", nil)
      }
    }
  }

  // Nothing uses the effect: drop the scene image and mask. Bumping the token keeps a
  // scene download still in flight from installing itself afterwards.
  @objc(clear)
  func clear() {
    DispatchQueue.main.async {
      self.token += 1
      CoyoteBackgroundEngine.shared.configure(nil)
    }
  }

  // Decode once into a bitmap so the per-frame composite doesn't re-decode the file.
  private static func rasterize(_ file: URL) -> CIImage? {
    guard let lazy = CIImage(contentsOf: file),
          let cg = CIContext().createCGImage(lazy, from: lazy.extent)
    else { return nil }
    return CIImage(cgImage: cg)
  }

  // Cached under Caches/backgrounds by a hash of the URL (the server version-stamps
  // scene URLs, so a changed image has a new URL).
  private func loadScene(_ url: URL, done: @escaping (CIImage?) -> Void) {
    let fm = FileManager.default
    let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("backgrounds", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let name = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    let file = dir.appendingPathComponent(name + ".webp")
    if fm.fileExists(atPath: file.path) {
      if let image = Self.rasterize(file) {
        done(image)
        return
      }
      try? fm.removeItem(at: file)
    }
    URLSession.shared.downloadTask(with: url) { tmp, response, error in
      guard let tmp = tmp, error == nil,
            let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
      else {
        done(nil)
        return
      }
      try? fm.removeItem(at: file)
      do {
        try fm.moveItem(at: tmp, to: file)
      } catch {
        done(nil)
        return
      }
      guard let image = Self.rasterize(file) else {
        try? fm.removeItem(at: file)
        done(nil)
        return
      }
      // Only the newest scene is kept; older ones are stale versions or other choices.
      if let others = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
        for other in others where other.lastPathComponent != file.lastPathComponent {
          try? fm.removeItem(at: other)
        }
      }
      done(image)
    }.resume()
  }
}
