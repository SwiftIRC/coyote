#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CoyoteSounds, RCTEventEmitter)
RCT_EXTERN_METHOD(preload:(NSString *)id uri:(NSString *)uri)
RCT_EXTERN_METHOD(play:(NSString *)id)
RCT_EXTERN_METHOD(stop:(NSString *)id)
@end
