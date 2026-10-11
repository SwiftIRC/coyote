import React, { useRef, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { PollResult, PollView } from "../../core/polls";
import { CHAT_MAX, type ChatEntry, type SendResult } from "../../core/chat";
import { hhmm } from "../../core/chatText";
import { linkSegments } from "../../shared/web";
import { useChat, usePoll } from "../hooks";
import { colors, radius } from "../theme";
import { PollCard } from "./PollCard";
import { Sheet } from "./Sheet";

const ERRORS: Partial<Record<SendResult, string>> = {
  offline: "Not connected — message not sent.",
  "too-long": `Messages are limited to ${CHAT_MAX} characters.`,
};

type PollActions = { vote(i: number): PollResult; close(): PollResult };

function Line({ e, poll, isOp, polls }: { e: ChatEntry; poll: PollView | null; isOp: boolean; polls: PollActions }) {
  const time = hhmm(e.ts, Date.now());
  if (e.kind === "system") return <Text style={styles.system}>{time} {e.text}</Text>;
  if (e.kind === "poll") {
    return poll
      ? <PollCard poll={poll} isOp={isOp} stale={poll.id !== e.pollId} onVote={polls.vote} onClose={polls.close} />
      : <Text style={styles.system}>Poll</Text>;
  }
  return (
    <Text style={styles.line} selectable>
      <Text style={styles.time}>{time} </Text>
      <Text style={styles.from}>{e.from}: </Text>
      {linkSegments(e.text).map((s, i) =>
        s.href ? (
          <Text key={i} style={styles.link} onPress={() => { Linking.openURL(s.href!).catch(() => {}); }} accessibilityRole="link">{s.text}</Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </Text>
  );
}

export function ChatSheet({ visible, onClose, send, isOp, polls }: {
  visible: boolean; onClose(): void; send(text: string): SendResult; isOp: boolean; polls: PollActions;
}) {
  const chat = useChat();
  const poll = usePoll();
  const [tab, setTab] = useState<"chat" | "poll">("chat");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const list = useRef<FlatList<ChatEntry>>(null);
  const atBottom = useRef(true);

  const submit = () => {
    const r = send(text);
    if (r === "sent") {
      setText("");
      setError("");
      atBottom.current = true;
    } else if (r !== "empty") setError(ERRORS[r] || "");
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.header}>
          {(["chat", "poll"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[styles.tab, { color: tab === t ? colors.text : colors.muted }]}>{t === "chat" ? "Chat" : "Poll"}</Text>
            </Pressable>
          ))}
          <View style={styles.spacer} />
        </View>
        {tab === "poll" ? (
          <ScrollView contentContainerStyle={styles.list}>
            {poll
              ? <PollCard poll={poll} isOp={isOp} onVote={polls.vote} onClose={polls.close} />
              : <Text style={styles.system}>No poll in this room.</Text>}
          </ScrollView>
        ) : (<>
        <FlatList
          ref={list}
          data={chat.entries}
          keyExtractor={(e) => String(e.key)}
          renderItem={({ item }) => <Line e={item} poll={poll} isOp={isOp} polls={polls} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.system}>No messages yet.</Text>}
          onScroll={(ev) => {
            const { contentOffset, contentSize, layoutMeasurement } = ev.nativeEvent;
            atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => { if (atBottom.current) list.current?.scrollToEnd({ animated: false }); }}
          keyboardShouldPersistTaps="handled"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(t) => { setText(t); if (error) setError(""); }}
            placeholder="Message"
            placeholderTextColor={colors.muted}
            maxLength={CHAT_MAX}
            multiline
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={submit}
          />
          <Pressable onPress={submit} style={styles.send} accessibilityRole="button" accessibilityLabel="Send">
            <Text style={styles.sendText}>➤</Text>
          </Pressable>
        </View>
        </>)}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 12, paddingBottom: 6 },
  spacer: { flex: 1 },
  tab: { fontSize: 15, fontWeight: "700" },
  list: { paddingHorizontal: 12, paddingBottom: 8, gap: 4 },
  line: { color: colors.text, fontSize: 15 },
  time: { color: colors.muted, fontSize: 12 },
  from: { fontWeight: "700" },
  link: { color: colors.accent, textDecorationLine: "underline" },
  system: { color: colors.muted, fontSize: 13, fontStyle: "italic" },
  error: { color: colors.danger, paddingHorizontal: 12, paddingBottom: 6 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  input: { flex: 1, maxHeight: 120, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  send: { height: 44, width: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#000", fontSize: 18, fontWeight: "700" },
});
