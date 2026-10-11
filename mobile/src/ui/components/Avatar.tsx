import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { avatarFor, gravatarUrl } from "../../shared/web";

// Gravatar when the participant has one, else coloured initials (same palette and
// hashing as the web client's avatar.js).
export function Avatar({ name, gravatar, size }: { name: string; gravatar: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const url = gravatar ? gravatarUrl(gravatar, Math.round(size * 2)) : "";
  const { initial, bg, fg } = avatarFor(name);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url && !failed) {
    return <Image source={{ uri: url }} style={box} onError={() => setFailed(true)} accessibilityLabel={name} />;
  }
  return (
    <View style={[styles.initials, box, { backgroundColor: bg }]} accessibilityLabel={name}>
      <Text style={[styles.initial, { color: fg, fontSize: size * 0.45 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: "center", justifyContent: "center" },
  initial: { fontWeight: "600" },
});
