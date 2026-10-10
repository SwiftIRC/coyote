import React, { useEffect, useRef } from "react";
import { Alert, StatusBar } from "react-native";
import { NavigationContainer, type NavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { parseRoomInput } from "../core/link";
import { initialUrl, watchUrls } from "../native/linking";
import { CallProvider, useCall } from "./CallContext";
import type { RootStack } from "./navigation";
import { Call } from "./screens/Call";
import { Home } from "./screens/Home";
import { PreJoin } from "./screens/PreJoin";
import { colors } from "./theme";

const Stack = createNativeStackNavigator<RootStack>();

// Opens tapped room links: valid links go to PreJoin (asking first if a call is
// live), anything else to Home.
function LinkHandler({ nav }: { nav: React.RefObject<NavigationContainerRef<RootStack> | null> }) {
  const { state, busy, switchTo } = useCall();
  // Refs, so the effect below runs once: re-running it would re-open the cold-start link.
  const live = useRef(false);
  const current = useRef("");
  const switchRef = useRef(switchTo);
  live.current = busy;
  current.current = state?.slug || "";
  switchRef.current = switchTo;

  useEffect(() => {
    const open = (url: string | null, tries = 0) => {
      if (!url) return;
      if (!nav.current?.isReady()) {
        // A cold-start link can resolve before the navigator mounts.
        if (tries < 20) setTimeout(() => open(url, tries + 1), 100);
        return;
      }
      const link = parseRoomInput(url);
      if (!link) {
        if (!live.current) nav.current.navigate("Home");
        return;
      }
      if (!live.current) {
        nav.current.navigate("PreJoin", { link });
        return;
      }
      Alert.alert("Switch rooms?", `Leave #${current.current} and join #${link.slug}?`, [
        { text: "Stay", style: "cancel" },
        { text: "Switch", style: "destructive", onPress: () => {
          // The Call screen, when mounted, opens PreJoin itself once the call has ended.
          const onCall = nav.current?.getCurrentRoute()?.name === "Call";
          switchRef.current(link);
          if (!onCall) nav.current?.navigate("PreJoin", { link });
        } },
      ]);
    };
    initialUrl().then((u) => open(u)).catch((e) => console.warn("initial url failed", e));
    return watchUrls((u) => open(u));
  }, [nav]);
  return null;
}

export default function App() {
  const nav = useRef<NavigationContainerRef<RootStack>>(null);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <CallProvider>
        <NavigationContainer ref={nav}>
          <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
            <Stack.Screen name="PreJoin" component={PreJoin} options={{ title: "Join" }} />
            <Stack.Screen name="Call" component={Call} options={{ headerShown: false, gestureEnabled: false }} />
          </Stack.Navigator>
        </NavigationContainer>
        <LinkHandler nav={nav} />
      </CallProvider>
    </SafeAreaProvider>
  );
}
