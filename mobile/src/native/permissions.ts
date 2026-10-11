import { PermissionsAndroid, Platform, type Permission } from "react-native";

// Android runtime permissions, asked on the pre-join screen. iOS prompts on first
// capture, using the Info.plist usage strings. A denial is not an error here: the
// call controller joins with that device off and says so.
export async function requestCallPermissions(wantCamera: boolean): Promise<void> {
  if (Platform.OS !== "android") return;
  const P = PermissionsAndroid.PERMISSIONS;
  const list: Permission[] = [P.RECORD_AUDIO];
  if (wantCamera) list.push(P.CAMERA);
  if (Number(Platform.Version) >= 33) list.push(P.POST_NOTIFICATIONS);
  if (Number(Platform.Version) >= 31) list.push(P.BLUETOOTH_CONNECT);
  await PermissionsAndroid.requestMultiple(list);
}
