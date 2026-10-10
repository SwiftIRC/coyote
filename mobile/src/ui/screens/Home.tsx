import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, type NavigationProp, useNavigation, type RouteProp, useRoute } from "@react-navigation/native";
import { serverVersion } from "../../core/api";
import { DEFAULT_HOST, parseRoomInput } from "../../core/link";
import { recentInput, type RecentRoom } from "../../core/recent";
import { loadRecent } from "../../native/storage";
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
    <View style={styles.root}>
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
          <Pressable style={styles.recent} onPress={() => go(recentInput(item))}>
            <Text style={styles.recentText}>#{item.slug}</Text>
            {item.host !== DEFAULT_HOST ? <Text style={styles.muted}>{item.host}</Text> : null}
          </Pressable>
        )}
      />
      <Text style={styles.about}>Server {DEFAULT_HOST}{version ? ` · ${version}` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 48 },
  title: { color: colors.text, fontSize: 32, fontWeight: "700", marginBottom: 16 },
  message: { color: colors.text, backgroundColor: colors.surface, padding: 12, borderRadius: radius, marginBottom: 12 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16 },
  error: { color: colors.danger, marginTop: 8 },
  button: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
  section: { color: colors.muted, marginTop: 28, marginBottom: 8, textTransform: "uppercase", fontSize: 12 },
  recent: { paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  recentText: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  about: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 12 },
});
