import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, type NavigationProp, useNavigation, type RouteProp, useRoute } from "@react-navigation/native";
import { serverVersion } from "../../core/api";
import { DEFAULT_HOST, parseRoomInput } from "../../core/link";
import { recentInput, type RecentRoom } from "../../core/recent";
import { forgetRoom, loadRecent } from "../../native/storage";
import type { RootStack } from "../navigation";
import { colors, radius } from "../theme";

export function Home() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const route = useRoute<RouteProp<RootStack, "Home">>();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<RecentRoom[]>([]);
  const [version, setVersion] = useState("");

  useFocusEffect(useCallback(() => {
    loadRecent().then(setRecent);
  }, []));
  useEffect(() => {
    serverVersion(fetch, `https://${DEFAULT_HOST}`).then(setVersion);
  }, []);

  const go = (text: string) => {
    const link = parseRoomInput(text);
    if (!link) {
      setError("That isn't a room name or a Coyote link.");
      return;
    }
    setError("");
    nav.navigate("PreJoin", { link });
  };

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Coyote</Text>
      {route.params?.message ? <Text style={styles.message}>{route.params.message}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder={`Room name or link (${DEFAULT_HOST})`}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        value={input}
        onChangeText={setInput}
        onSubmitEditing={() => go(input)}
        returnKeyType="go"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={() => go(input)} accessibilityRole="button">
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
      <Text style={styles.section}>Recent</Text>
      <FlatList
        data={recent}
        keyExtractor={(r) => `${r.host}/${r.slug}`}
        ListEmptyComponent={<Text style={styles.muted}>Rooms you join appear here.</Text>}
        renderItem={({ item }) => (
          <View style={styles.recentRow}>
            <Pressable style={styles.recent} onPress={() => go(recentInput(item))} accessibilityRole="button" accessibilityLabel={`Join #${item.slug}`}>
              <Text style={styles.recentText}>#{item.slug}</Text>
              {item.host !== DEFAULT_HOST ? <Text style={styles.muted}>{item.host}</Text> : null}
            </Pressable>
            <Pressable
              onPress={() => { forgetRoom(item).then(setRecent).catch((e) => console.warn("forget room failed", e)); }}
              style={styles.forget}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove #${item.slug} from recent rooms`}
            >
              <Text style={styles.forgetText}>×</Text>
            </Pressable>
          </View>
        )}
      />
      <Text style={styles.about}>Server {DEFAULT_HOST}{version ? ` · ${version}` : ""}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 28 },
  title: { color: colors.text, fontSize: 32, fontWeight: "700", marginBottom: 16 },
  message: { color: colors.text, backgroundColor: colors.surface, padding: 12, borderRadius: radius, marginBottom: 12 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16 },
  error: { color: colors.danger, marginTop: 8 },
  button: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
  section: { color: colors.muted, marginTop: 28, marginBottom: 8, textTransform: "uppercase", fontSize: 12 },
  recentRow: { flexDirection: "row", alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  recent: { flex: 1, paddingVertical: 12 },
  recentText: { color: colors.text, fontSize: 16 },
  forget: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  forgetText: { color: colors.muted, fontSize: 22 },
  muted: { color: colors.muted },
  about: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 12 },
});
