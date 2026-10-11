import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PollResult, PollView } from "../../core/polls";
import { tallyPercents, totalVotes } from "../../shared/web";
import { colors, radius } from "../theme";

const ERRORS: Partial<Record<PollResult, string>> = {
  offline: "Not connected — vote not sent.",
  closed: "This poll is closed.",
  "not-op": "Only ops can close polls.",
};

export function PollCard({ poll, isOp, stale = false, onVote, onClose }: {
  poll: PollView; isOp: boolean; stale?: boolean; onVote(i: number): PollResult; onClose(): PollResult;
}) {
  const [msg, setMsg] = useState("");
  if (stale) return <Text style={styles.stale}>This poll was replaced.</Text>;
  const pct = tallyPercents(poll.tallies);
  const total = totalVotes(poll.tallies);
  const max = Math.max(0, ...poll.tallies);
  const act = (r: PollResult) => setMsg(r === "sent" ? "" : ERRORS[r] || "");
  return (
    <View style={styles.card}>
      <Text style={styles.question}>{poll.question}</Text>
      <Text style={styles.meta}>{poll.open ? `Poll by ${poll.by}` : "Closed"} · {total} vote{total === 1 ? "" : "s"}</Text>
      {poll.options.map((o, i) => {
        const mine = poll.yourVote === i;
        const winner = !poll.open && total > 0 && poll.tallies[i] === max;
        return (
          <Pressable key={i} disabled={!poll.open} onPress={() => act(onVote(i))} accessibilityRole="button"
            accessibilityLabel={`${o}, ${poll.tallies[i] ?? 0} votes${mine ? ", your vote" : ""}`} style={[styles.option, mine && styles.mine, winner && styles.winner]}>
            <View style={[styles.bar, { width: `${pct[i] ?? 0}%` }]} />
            <Text style={styles.optText} numberOfLines={2}>{o}</Text>
            <Text style={styles.count}>{poll.tallies[i] ?? 0} · {pct[i] ?? 0}%</Text>
          </Pressable>
        );
      })}
      {isOp && poll.open ? (
        <Pressable onPress={() => act(onClose())} style={styles.close} accessibilityRole="button">
          <Text style={styles.closeText}>Close poll</Text>
        </Pressable>
      ) : null}
      {msg ? <Text style={styles.err}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: 12, gap: 6, marginVertical: 4 },
  question: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12 },
  option: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 8 },
  mine: { borderColor: colors.accent },
  winner: { borderColor: colors.text },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(232,131,58,0.25)" },
  optText: { flex: 1, color: colors.text },
  count: { color: colors.muted, fontVariant: ["tabular-nums"] },
  close: { alignSelf: "flex-start", paddingVertical: 6 },
  closeText: { color: colors.accent, fontWeight: "600" },
  err: { color: colors.danger },
  stale: { color: colors.muted, fontStyle: "italic" },
});
