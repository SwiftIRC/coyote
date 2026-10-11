#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <WebRTC/RTCVideoFrame.h>
#if __has_include(<react-native-webrtc/ProcessorProvider.h>)
#import <react-native-webrtc/ProcessorProvider.h>
#elif __has_include(<react_native_webrtc/ProcessorProvider.h>)
#import <react_native_webrtc/ProcessorProvider.h>
#else
#import "ProcessorProvider.h"
#endif
#import "Coyote-Swift.h"

@interface RCT_EXTERN_MODULE(CoyoteBackground, RCTEventEmitter)
RCT_EXTERN_METHOD(setEffect:(NSDictionary *)effect resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

// The camera-frame hook react-native-webrtc calls for tracks with the
// "coyote-background" effect. It must always return a frame: react-native-webrtc
// hands the result straight to the video source.
@interface CoyoteBackgroundProcessor : NSObject <VideoFrameProcessorDelegate>
@end

@implementation CoyoteBackgroundProcessor

+ (void)load {
  [ProcessorProvider addProcessor:[CoyoteBackgroundProcessor new] forName:@"coyote-background"];
}

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
  if (![frame.buffer isKindOfClass:[RTCCVPixelBuffer class]]) return frame;
  CVPixelBufferRef src = ((RTCCVPixelBuffer *)frame.buffer).pixelBuffer;
  CVPixelBufferRef out = [[CoyoteBackgroundEngine shared] process:src rotation:(NSInteger)frame.rotation];
  if (out == NULL) return frame;
  RTCCVPixelBuffer *buffer = [[RTCCVPixelBuffer alloc] initWithPixelBuffer:out];
  return [[RTCVideoFrame alloc] initWithBuffer:buffer rotation:RTCVideoRotation_0 timeStampNs:frame.timeStampNs];
}

@end
