import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { OPTION_MAX, OPTIONS_MAX, OPTIONS_MIN, QUESTION_MAX, type PollResult } from "../../core/polls";
import { colors, radius } from "../theme";
import { Sheet, useSheetList } from "./Sheet";

const ERRORS: Partial<Record<PollResult, string>> = {
  invalid: `Add a question and ${OPTIONS_MIN}–${OPTIONS_MAX} options.`,
  offline: "Not connected — poll not created.",
  "not-op": "Only ops can create polls.",
};

export function PollForm({ visible, onClose, replacing, create }: {
  visible: boolean; onClose(): void; replacing: boolean; create(q: string, opts: string[]): PollResult;
}) {
  const list = useSheetList();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (visible) { setQuestion(""); setOptions(["", ""]); setMsg(""); }
  }, [visible]);
  const submit = () => {
    const r = create(question, options);
    if (r === "sent") onClose();
    else setMsg(ERRORS[r] || "");
  };
  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.75}>
      <ScrollView {...list} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>New poll</Text>
        {replacing ? <Text style={styles.warn}>This replaces the current poll and its votes.</Text> : null}
        <TextInput style={styles.input} placeholder="Question" placeholderTextColor={colors.muted}
          value={question} onChangeText={setQuestion} maxLength={QUESTION_MAX} accessibilityLabel="Question" />
        {options.map((o, i) => (
          <View key={i} style={styles.row}>
            <TextInput style={[styles.input, styles.flex]} placeholder={`Option ${i + 1}`} placeholderTextColor={colors.muted}
              value={o} maxLength={OPTION_MAX} accessibilityLabel={`Option ${i + 1}`}
              onChangeText={(t) => setOptions(options.map((x, j) => (j === i ? t : x)))} />
            {options.length > OPTIONS_MIN ? (
              <Pressable onPress={() => setOptions(options.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove option ${i + 1}`}>
                <Text style={styles.remove}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {options.length < OPTIONS_MAX ? (
          <Pressable onPress={() => setOptions([...options, ""])} accessibilityRole="button">
            <Text style={styles.add}>+ Add option</Text>
          </Pressable>
        ) : null}
        {msg ? <Text style={styles.err}>{msg}</Text> : null}
        <Pressable onPress={submit} style={styles.create} accessibilityRole="button">
          <Text style={styles.createText}>Create poll</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  label: { color: colors.muted, textTransform: "uppercase", fontSize: 12 },
  warn: { color: colors.accent },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 12, fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  remove: { color: colors.muted, fontSize: 22, paddingHorizontal: 6 },
  add: { color: colors.accent, fontWeight: "600" },
  err: { color: colors.danger },
  create: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center" },
  createText: { color: "#000", fontWeight: "700", fontSize: 16 },
});
