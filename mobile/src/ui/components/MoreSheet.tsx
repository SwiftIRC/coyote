import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { NAME_MAX } from "../../core/call";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";

type RenameResult = "sent" | "empty" | "unchanged" | "offline";
const MESSAGES: Partial<Record<RenameResult, string>> = {
  empty: "Enter a name.",
  offline: "Not connected — name not changed.",
};

export function MoreSheet({ visible, onClose, name, rename }: {
  visible: boolean; onClose(): void; name: string; rename(n: string): RenameResult;
}) {
  const [draft, setDraft] = useState(name);
  const [msg, setMsg] = useState("");
  // Follow the confirmed name (our own or one the server imposed) when not editing.
  useEffect(() => { setDraft(name); setMsg(""); }, [name, visible]);

  const submit = () => {
    const r = rename(draft);
    if (r === "sent") setMsg("Renaming…");
    else setMsg(MESSAGES[r] || "");
  };

  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.35}>
      <View style={styles.body}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          maxLength={NAME_MAX}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          onBlur={() => { if (draft.trim() !== name) submit(); }}
        />
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 8 },
  label: { color: colors.muted, textTransform: "uppercase", fontSize: 12 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 12, fontSize: 16 },
  msg: { color: colors.muted },
});
