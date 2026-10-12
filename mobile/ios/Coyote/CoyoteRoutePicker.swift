import AVKit
import React

// Apple's output picker button with its icon hidden. JS lays it over the call's
// audio button, which draws the label; a tap opens the system output sheet.
@objc(CoyoteRoutePickerManager)
class CoyoteRoutePickerManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  override func view() -> UIView! {
    let picker = AVRoutePickerView()
    picker.prioritizesVideoDevices = false
    picker.tintColor = .clear
    picker.activeTintColor = .clear
    picker.backgroundColor = .clear
    return picker
  }
}
