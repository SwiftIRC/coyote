import { AppRegistry } from "react-native";
import { installDebugCapture } from "./src/native/debug";
import App from "./src/ui/App";
import { name as appName } from "./app.json";

installDebugCapture();
AppRegistry.registerComponent(appName, () => App);
