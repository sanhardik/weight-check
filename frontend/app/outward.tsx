import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { EntryForm } from "@/src/screens/EntryForm";

type Group = {
  thickness_mm: number; width_mm: number; length_mm: number;
  grade?: string | null;
  pieces_available: number;
  theoretical_weight_available_kg: number;
  inward_entry_ids: string[];
};

export default function OutwardScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [selected, setSelected] = useState<Group | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch("/inventory", {}, token)
      .then((d) => setGroups(d))
      .catch((e) => setErr(e.message));
  }, [token]);

  if (!user) return <Redirect href="/login" />;

  if (selected) {
    return (
      <EntryForm
        direction="outward"
        prefill={{
          thickness: String(selected.thickness_mm),
          width: String(selected.width_mm),
          length: String(selected.length_mm),
          grade: selected.grade || "",
          source_entry_id: selected.inward_entry_ids?.[0],
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="OUTWARD · जावक" showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Text style={s.title}>{t("select_stock")}</Text>
        <Text style={s.sub}>Choose an item from current stock to send out</Text>
        {err ? <Text style={s.err}>{err}</Text> : null}
        {!groups ? (
          <View style={{ padding: spacing.xl }}><ActivityIndicator color={colors.brand} /></View>
        ) : groups.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTxt}>{t("no_stock")}</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {groups.map((g, i) => (
              <Pressable
                key={`${g.thickness_mm}-${g.width_mm}-${g.length_mm}-${g.grade || ""}`}
                testID={`stock-item-${i}`}
                onPress={() => setSelected(g)}
                style={({ pressed }) => [s.row, { opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.dim}>{g.thickness_mm} × {g.width_mm} × {g.length_mm} mm</Text>
                  {g.grade ? <Text style={s.grade}>GRADE: {g.grade}</Text> : null}
                </View>
                <View style={s.pcsBox}>
                  <Text style={s.pcs}>{g.pieces_available}</Text>
                  <Text style={s.pcsLbl}>PCS</Text>
                </View>
                <View style={s.wtBox}>
                  <Text style={s.wt}>{g.theoretical_weight_available_kg.toFixed(1)}</Text>
                  <Text style={s.wtLbl}>KG</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  sub: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: spacing.md, letterSpacing: 1 },
  err: { color: colors.error, fontWeight: "900", marginBottom: spacing.md },
  emptyBox: { padding: spacing.xl, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  emptyTxt: { fontSize: 16, fontWeight: "900", color: colors.muted, letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  dim: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: "Courier" },
  grade: { fontSize: 11, color: colors.muted, marginTop: 2, letterSpacing: 1 },
  pcsBox: { alignItems: "center", borderLeftWidth: 1.5, borderLeftColor: colors.borderStrong, paddingLeft: spacing.md, minWidth: 60 },
  pcs: { fontSize: 22, fontWeight: "900", color: colors.brand, fontFamily: "Courier" },
  pcsLbl: { fontSize: 10, color: colors.muted, letterSpacing: 2, fontWeight: "900" },
  wtBox: { alignItems: "center", minWidth: 70 },
  wt: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: "Courier" },
  wtLbl: { fontSize: 10, color: colors.muted, letterSpacing: 2, fontWeight: "900" },
});
