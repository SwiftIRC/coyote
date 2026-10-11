import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { NAME_MAX } from "../../core/call";
import { MOD_RESULT_TEXT, type ModResult, type QualityTarget } from "../../core/moderation";
import type { ShareStatus } from "../../core/screenShare";
import { QUALITY_TIERS } from "../../shared/web";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";
import { Toggle } from "./Toggle";

type RenameResult = "sent" | "empty" | "unchanged" | "offline";
const MESSAGES: Partial<Record<RenameResult, string>> = {
  empty: "Enter a name.",
  offline: "Not connected — name not changed.",
};

export function MoreSheet({ visible, onClose, name, rename, isOp, onNewPoll, dataSaver, onDataSaver, hideSelf, onHideSelf, locked, quality, mod, share, onShare, onStopShare }: {
  visible: boolean; onClose(): void; name: string; rename(n: string): RenameResult; isOp: boolean; onNewPoll(): void;
  dataSaver: boolean; onDataSaver(v: boolean): void; hideSelf: boolean; onHideSelf(v: boolean): void;
  locked: boolean; quality: { camera: string; screen: string };
  share: ShareStatus; onShare(): void; onStopShare(): void;
  mod: { lock(pw: string): ModResult; unlock(): ModResult; setQuality(t: QualityTarget, tier: string): ModResult };
}) {
  const [draft, setDraft] = useState(name);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<"main" | "quality">("main");
  const [lockDraft, setLockDraft] = useState<string | null>(null); // null: not editing
  const [modMsg, setModMsg] = useState("");
  useEffect(() => { setView("main"); setLockDraft(null); setModMsg(""); }, [visible]);
  // A room-locked broadcast while the draft is open: the row becomes Unlock room.
  useEffect(() => { if (locked) setLockDraft(null); }, [locked]);
  useEffect(() => { if (!isOp) { setView("main"); setLockDraft(null); } }, [isOp]);
  const show = (r: ModResult) => setModMsg(MOD_RESULT_TEXT[r] || "");
  const submitLock = () => {
    const r = mod.lock(lockDraft ?? "");
    if (r === "sent") { setLockDraft(null); setModMsg(""); } else show(r);
  };
  // Follow the confirmed name (our own or one the server imposed) when not editing.
  useEffect(() => { setDraft(name); setMsg(""); }, [name, visible]);

  // Renames only on keyboard Done or Save; closing the sheet discards the draft (see effect above).
  const canSave = draft.trim() !== "" && draft.trim() !== name;
  const submit = () => {
    const r = rename(draft);
    if (r === "sent") setMsg("Renaming…");
    else setMsg(MESSAGES[r] || "");
  };

  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.55}>
      <ScrollView keyboardShouldPersistTaps="handled">
      {view === "quality" ? (
        <View style={styles.body}>
          <Pressable onPress={() => setView("main")} accessibilityRole="button" accessibilityLabel="Back" style={styles.row2}>
            <Text style={styles.saveText}>‹ Back</Text>
          </Pressable>
          {(["camera", "screen"] as QualityTarget[]).map((target) => (
            <View key={target} style={styles.group}>
              <Text style={styles.label}>{target === "camera" ? "Camera" : "Screen"}</Text>
              {QUALITY_TIERS.map((t: { id: string; label: string }) => {
                const on = quality[target] === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => show(mod.setQuality(target, t.id))}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={styles.tier}
                  >
                    <Text style={styles.tierText}>{on ? "✓ " : "   "}{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {modMsg ? <Text style={styles.msg}>{modMsg}</Text> : null}
        </View>
      ) : (
      <View style={styles.body}>
        <Text style={styles.label}>Name</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.inputFlex]}
            value={draft}
            onChangeText={setDraft}
            maxLength={NAME_MAX}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="Name"
          />
          <Pressable
            onPress={submit}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save name"
            accessibilityState={{ disabled: !canSave }}
            style={[styles.save, !canSave && styles.saveOff]}
          >
            <Text style={[styles.saveText, !canSave && { color: colors.muted }]}>Save</Text>
          </Pressable>
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        <Toggle label="Data saver" value={dataSaver} onChange={onDataSaver} />
        <Text style={styles.msg}>Stops receiving video; audio keeps playing.</Text>
        <Toggle label="Hide self-view" value={hideSelf} onChange={onHideSelf} />
        <Pressable
          onPress={share === "sharing" ? onStopShare : onShare}
          disabled={share === "starting"}
          accessibilityRole="button"
          accessibilityState={{ disabled: share === "starting" }}
          style={styles.row2}
        >
          <Text style={[styles.saveText, share === "starting" && { color: colors.muted }]}>
            {share === "sharing" ? "Stop sharing" : share === "starting" ? "Starting…" : "Share screen"}
          </Text>
        </Pressable>
        {isOp ? (
          <>
            <Pressable onPress={onNewPoll} accessibilityRole="button" style={styles.row2}>
              <Text style={styles.saveText}>New poll…</Text>
            </Pressable>
            {locked ? (
              <Pressable onPress={() => show(mod.unlock())} accessibilityRole="button" style={styles.row2}>
                <Text style={styles.saveText}>Unlock room</Text>
              </Pressable>
            ) : lockDraft === null ? (
              <Pressable onPress={() => { setLockDraft(""); setModMsg(""); }} accessibilityRole="button" style={styles.row2}>
                <Text style={styles.saveText}>Lock room…</Text>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  value={lockDraft}
                  onChangeText={setLockDraft}
                  placeholder="Room password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={submitLock}
                  accessibilityLabel="Room password"
                />
                <Pressable
                  onPress={submitLock}
                  disabled={lockDraft.trim() === ""}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: lockDraft.trim() === "" }}
                  style={[styles.save, lockDraft.trim() === "" && styles.saveOff]}
                >
                  <Text style={styles.saveText}>Lock</Text>
                </Pressable>
                <Pressable onPress={() => setLockDraft(null)} accessibilityRole="button" style={styles.save}>
                  <Text style={styles.saveText}>Cancel</Text>
                </Pressable>
              </View>
            )}
            <Pressable onPress={() => { setView("quality"); setModMsg(""); }} accessibilityRole="button" style={styles.row2}>
              <Text style={styles.saveText}>Quality…</Text>
            </Pressable>
            {modMsg ? <Text style={styles.msg}>{modMsg}</Text> : null}
          </>
        ) : null}
      </View>
      )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 8 },
  label: { color: colors.muted, textTransform: "uppercase", fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 12, fontSize: 16 },
  inputFlex: { flex: 1 },
  save: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  saveOff: { opacity: 0.5 },
  saveText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  row2: { paddingVertical: 12 },
  group: { gap: 2 },
  tier: { paddingVertical: 10 },
  tierText: { color: colors.text, fontSize: 16 },
  msg: { color: colors.muted },
});
