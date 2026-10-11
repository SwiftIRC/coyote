import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { RTCView } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { peekInvite, peekRoom } from "../../core/api";
import { gravatarHash } from "../../core/gravatar";
import { nickFromToken } from "../../core/token";
import type { StreamLike, TrackLike } from "../../core/types";
import { requestCallPermissions } from "../../native/permissions";
import { loadPrefs, rememberRoom, savePrefs } from "../../native/storage";
import { media } from "../../native/webrtc";
import { useCall } from "../CallContext";
import type { RootStack } from "../navigation";
import { colors, radius } from "../theme";

const PEEK_MS = 3000;

export function PreJoin() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const { params } = useRoute<RouteProp<RootStack, "PreJoin">>();
  const { link } = params;
  const { join } = useCall();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const window = useWindowDimensions();
  // Portrait preview sized to the screen, so the form fits and Join stays pinned below it.
  const previewHeight = Math.round(Math.min((window.width - 40) * 4 / 3, window.height * 0.3));
  const [name, setName] = useState("");
  const [lockedName, setLockedName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [room, setRoom] = useState<{ count: number; locked: boolean } | null>(null);
  const [error, setError] = useState(params.error || "");
  const [joining, setJoining] = useState(false);
  const [preview, setPreview] = useState<StreamLike | null>(null);
  const previewTrack = useRef<TrackLike | null>(null);

  // React Navigation reuses an open PreJoin for a new link, so drop the previous
  // room's locked name, password and occupancy first.
  useEffect(() => {
    let live = true;
    setLockedName("");
    setPassword("");
    setRoom(null);
    loadPrefs().then((p) => {
      setName((n) => n || p.name);
      setEmail(p.email);
      setMic(p.mic);
      setCamera(p.camera);
    });
    if (link.invite) {
      peekInvite(fetch, link).then((r) => {
        if (!live) return;
        if (r.status === "ok" && r.name) {
          setLockedName(r.name);
        } else if (r.status === "invalid") setError("Your invite link is invalid.");
      });
    } else if (link.token) {
      const nick = nickFromToken(link.token);
      if (nick) setLockedName(nick);
    }
    return () => {
      live = false;
    };
  }, [link]);

  // Keyed on the params object: every navigation creates a new one, so a repeated
  // identical error (e.g. bad-password twice) is shown again.
  useEffect(() => {
    setError(params.error || "");
  }, [params]);

  // Occupancy and lock state, polled while this screen is focused.
  useFocusEffect(useCallback(() => {
    let live = true;
    const tick = () => peekRoom(fetch, link).then((r) => live && r && setRoom(r));
    tick();
    const id = setInterval(tick, PEEK_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [link]));

  // Camera preview while focused; released before joining (the call acquires its own).
  const stopPreview = useCallback(() => {
    previewTrack.current?.stop();
    previewTrack.current = null;
    setPreview(null);
  }, []);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (camera) {
      requestCallPermissions(true).then(() => media.getCamera("user")).then((t) => {
        if (cancelled || !t) {
          t?.stop();
          return;
        }
        previewTrack.current = t;
        setPreview(media.createStream([t]));
      });
    }
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [camera, stopPreview]));

  const onJoin = async () => {
    const finalName = (lockedName || name).trim();
    if (!finalName) {
      setError("Enter a display name.");
      return;
    }
    setJoining(true);
    setError("");
    try {
      stopPreview();
      try {
        await requestCallPermissions(camera);
      } catch (e) {
        console.warn("permission request failed", e);
        setError("Couldn't get microphone or camera permission.");
        return;
      }
      try {
        await savePrefs({ name: lockedName ? name : finalName, email, mic, camera });
        await rememberRoom(link);
      } catch (e) {
        console.warn("saving prefs or recent room failed", e);
      }
      const joined = join({ link, name: finalName, password, gravatar: gravatarHash(email), mic, camera });
      nav.navigate("Call"); // after join() has synchronously cleared the previous call's state
      await joined;
    } catch (e) {
      console.warn("join failed", e);
      setError("Couldn't join the call.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>#{link.slug}</Text>
        <Text style={styles.muted}>
          {room ? `${room.count} in call${room.locked ? " · password required" : ""}` : link.host}
        </Text>
        <View style={[styles.preview, { height: previewHeight }]}>
          {camera && preview?.toURL ? (
            <RTCView streamURL={preview.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror />
          ) : (
            <Text style={styles.muted}>Camera off</Text>
          )}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Microphone</Text>
          <Switch value={mic} onValueChange={setMic} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Camera</Text>
          <Switch value={camera} onValueChange={setCamera} />
        </View>
        <TextInput
          style={[styles.input, lockedName ? styles.locked : null]}
          placeholder="Display name"
          placeholderTextColor={colors.muted}
          value={lockedName || name}
          editable={!lockedName}
          onChangeText={setName}
          maxLength={64}
        />
        <TextInput
          style={styles.input}
          placeholder="Email for Gravatar (optional, stays on this device)"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        {/* Always shown: if the occupancy poll fails, a locked room must still be joinable. */}
        <TextInput
          style={styles.input}
          placeholder="Room password (if locked)"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="join"
          onSubmitEditing={() => !joining && onJoin()}
        />
      </ScrollView>
      {/* Outside the scroll view so Join is always on screen, above the keyboard on iOS. */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={onJoin} disabled={joining} accessibilityRole="button">
          {joining ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Join</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 24 },
  title: { color: colors.text, fontSize: 28, fontWeight: "700" },
  muted: { color: colors.muted },
  preview: { aspectRatio: 3 / 4, alignSelf: "center", backgroundColor: colors.surface, borderRadius: radius, overflow: "hidden", alignItems: "center", justifyContent: "center", marginVertical: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  label: { color: colors.text, fontSize: 16 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16, marginTop: 12 },
  locked: { opacity: 0.7 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: colors.bg },
  error: { color: colors.danger, marginBottom: 12 },
  button: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center" },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
});
