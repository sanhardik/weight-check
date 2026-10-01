import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { BButton } from "@/src/ui/BButton";
import { toast } from "@/src/ui/Toast";

type Kind = "mukadams" | "brokers" | "grades" | "thicknesses" | "widths" | "lengths";

const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "mukadams", label: "WAREHOUSE KEEPERS · मुकादम", hint: "People who log entries from the warehouse floor" },
  { kind: "brokers", label: "BROKERS", hint: "Sales/outward broker names" },
  { kind: "grades", label: "GRADES", hint: "Steel grades: IS2062, E350..." },
  { kind: "thicknesses", label: "THICKNESS (mm)", hint: "Allowed thickness values" },
  { kind: "widths", label: "WIDTH (mm)", hint: "Allowed width values" },
  { kind: "lengths", label: "LENGTH (mm)", hint: "Allowed length values" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>("mukadams");
  const [items, setItems] = useState<string[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setItems(null);
    try {
      const d = await apiFetch(`/catalog/${kind}`, {}, token);
      setItems((d || []).map((x: any) => String(x.value)));
    } catch { setItems([]); }
  }, [kind, token]);

  useEffect(() => { load(); }, [load]);

  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin" && user.role !== "office") return <Redirect href="/home" />;

  const activeDef = KINDS.find((k) => k.kind === kind)!;

  const add = async () => {
    const v = addValue.trim();
    if (!v) return;
    setBusy(true);
    try {
      await apiFetch(`/catalog/${kind}`, { method: "POST", body: JSON.stringify({ value: v }) }, token);
      toast("Added", "success");
      setAddValue("");
      setAddOpen(false);
      load();
    } catch (e: any) { toast(e.message || "Add failed", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (val: string) => {
    if (user.role !== "admin") { toast("Only admin can remove", "error"); return; }
    try {
      await apiFetch(`/catalog/${kind}/${encodeURIComponent(val)}`, { method: "DELETE" }, token);
      toast("Removed", "success");
      load();
    } catch (e: any) { toast(e.message || "Remove failed", "error"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="SETTINGS · CATALOG" showBack />
      <View style={s.kindRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" }}>
          {KINDS.map((k) => (
            <Pressable
              key={k.kind}
              testID={`settings-tab-${k.kind}`}
              onPress={() => setKind(k.kind)}
              style={[s.chip, kind === k.kind && s.chipActive]}
            >
              <Text style={[s.chipTxt, kind === k.kind && { color: colors.onBrand }]} numberOfLines={1}>{k.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}>
        <Text style={s.hint}>{activeDef.hint}</Text>
        <BButton testID="settings-add-btn" label={`+ ADD ${activeDef.label.split(" · ")[0]}`} onPress={() => setAddOpen(true)} size="lg" />

        {!items ? (
          <ActivityIndicator color={colors.brand} />
        ) : items.length === 0 ? (
          <Text style={s.empty}>No items yet. Tap ADD above.</Text>
        ) : (
          items.map((v) => (
            <View key={v} style={s.row} testID={`settings-row-${v}`}>
              <Text style={s.rowVal}>{v}</Text>
              <Pressable testID={`settings-remove-${v}`} onPress={() => remove(v)} style={s.removeBtn} disabled={user.role !== "admin"}>
                <Text style={[s.removeTxt, user.role !== "admin" && { opacity: 0.4 }]}>REMOVE</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.backdrop}>
          <View style={s.sheet} testID="settings-add-modal">
            <Text style={s.sheetTitle}>ADD TO {activeDef.label}</Text>
            <Text style={s.sheetHint}>{activeDef.hint}</Text>
            <TextInput
              testID="settings-add-input"
              value={addValue}
              onChangeText={setAddValue}
              placeholder={activeDef.kind.includes("ness") || activeDef.kind === "widths" || activeDef.kind === "lengths" ? "e.g. 15" : "e.g. S275JR"}
              placeholderTextColor={colors.muted}
              style={s.sheetInput}
              autoFocus
            />
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <BButton testID="settings-add-save" label={busy ? "SAVING..." : "ADD"} onPress={add} loading={busy} size="lg" />
              <BButton label="CANCEL" variant="ghost" onPress={() => { setAddOpen(false); setAddValue(""); }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  kindRow: { height: 56, borderBottomWidth: 1.5, borderBottomColor: colors.borderStrong, justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chip: { height: 36, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { fontSize: 11, fontWeight: "800", color: colors.onSurface, letterSpacing: 1 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  empty: { fontSize: 13, color: colors.muted, padding: spacing.xl, textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  rowVal: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  removeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderColor: colors.error },
  removeTxt: { color: colors.error, fontWeight: "800", fontSize: 11, letterSpacing: 1 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.borderStrong },
  sheetTitle: { fontSize: 14, fontWeight: "800", letterSpacing: 2, color: colors.onSurface, marginBottom: spacing.xs },
  sheetHint: { fontSize: 11, color: colors.muted, marginBottom: spacing.md },
  sheetInput: { borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 18, fontWeight: "700", color: colors.onSurface },
});
