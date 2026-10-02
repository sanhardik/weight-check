import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { colors, spacing } from "@/src/theme";

export default function OfficeDashboard() {
  const { user, token } = useAuth();
  const [a, setA] = useState<any>(null);
  const [verif, setVerif] = useState<{ pending_review: number }>({ pending_review: 0 });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [an, vh] = await Promise.all([
        apiFetch("/analytics/summary?days=7", {}, token),
        apiFetch("/verifications/history?limit=1", {}, token).catch(() => ({ pending_review: 0 })),
      ]);
      setA(an);
      setVerif({ pending_review: vh.pending_review || 0 });
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (!a) return <View style={s.loading}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <View>
      <Text style={s.pageTitle}>Dashboard</Text>
      <Text style={s.pageSub}>Welcome back, {user?.name} — today at a glance</Text>

      <View style={s.kpiGrid}>
        <View style={[s.kpi, { borderLeftColor: colors.brand }]} testID="kpi-inward-today">
          <Text style={s.kpiLabel}>Inward · आवक today</Text>
          <Text style={s.kpiVal}>{a.totals_today.inward_kg.toFixed(1)} <Text style={s.kpiUnit}>kg</Text></Text>
          <Text style={s.kpiSub}>{a.totals_today.inward_pcs} pieces</Text>
        </View>
        <View style={[s.kpi, { borderLeftColor: colors.surfaceInverse }]} testID="kpi-outward-today">
          <Text style={s.kpiLabel}>Outward · जावक today</Text>
          <Text style={s.kpiVal}>{a.totals_today.outward_kg.toFixed(1)} <Text style={s.kpiUnit}>kg</Text></Text>
          <Text style={s.kpiSub}>{a.totals_today.outward_pcs} pieces</Text>
        </View>
        <Pressable onPress={() => router.push("/office/entries?pending=1")} style={[s.kpi, { borderLeftColor: colors.warning, cursor: "pointer" as any }]} testID="kpi-pending">
          <Text style={s.kpiLabel}>Pending office</Text>
          <Text style={s.kpiVal}>{a.pending_office}</Text>
          <Text style={[s.kpiSub, { color: colors.warning, fontWeight: "900" }]}>Click to review →</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/office/verifications")} style={[s.kpi, { borderLeftColor: colors.error, cursor: "pointer" as any }]} testID="kpi-tally">
          <Text style={s.kpiLabel}>Tally mismatches</Text>
          <Text style={s.kpiVal}>{verif.pending_review}</Text>
          <Text style={[s.kpiSub, { color: colors.error, fontWeight: "900" }]}>Awaiting review →</Text>
        </Pressable>
      </View>

      <View style={s.twoCol}>
        <View style={s.col}>
          <Text style={s.sectionTitle}>Top parties · 7D</Text>
          {a.top_parties.length === 0 ? <Text style={s.empty}>No invoiced outward in last 7 days</Text> : null}
          {a.top_parties.slice(0, 5).map((p: any, i: number) => (
            <View key={p.name} style={s.row} testID={`dash-top-party-${i}`}>
              <Text style={s.rank}>#{i + 1}</Text>
              <Text style={s.rowName}>{p.name}</Text>
              <Text style={s.rowVal}>{p.weight.toFixed(0)} kg</Text>
            </View>
          ))}
        </View>

        <View style={s.col}>
          <Text style={s.sectionTitle}>Low stock</Text>
          {a.low_stock.length === 0 ? <Text style={s.empty}>All items above threshold</Text> : null}
          {a.low_stock.slice(0, 5).map((ls: any, i: number) => (
            <View key={i} style={s.row} testID={`dash-low-${i}`}>
              <Text style={[s.rowName, { color: colors.error }]}>{ls.thickness_mm}×{ls.width_mm}×{ls.length_mm}{ls.grade ? ` · ${ls.grade}` : ""}</Text>
              <Text style={[s.rowVal, { color: colors.error }]}>{ls.pieces_available} pcs</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  loading: { paddingVertical: spacing.xxxl, alignItems: "center" },
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface, marginBottom: 4 },
  pageSub: { fontSize: 14, color: colors.muted, marginBottom: spacing.xl },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.xl },
  kpi: { minWidth: 220, flexGrow: 1, flexBasis: 220, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4 },
  kpiLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 1 },
  kpiVal: { fontSize: 32, fontWeight: "900", color: colors.onSurface, marginTop: 4 },
  kpiUnit: { fontSize: 14, fontWeight: "700", color: colors.muted },
  kpiSub: { fontSize: 12, color: colors.muted, marginTop: 4 },

  twoCol: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  col: { flex: 1, minWidth: 320, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 13, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: spacing.sm },
  empty: { fontSize: 12, color: colors.muted, fontStyle: "italic" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  rank: { fontSize: 13, fontWeight: "900", color: colors.brand, width: 32 },
  rowName: { flex: 1, fontSize: 13, color: colors.onSurface, fontWeight: "700" },
  rowVal: { fontSize: 13, fontWeight: "900", color: colors.onSurface },
});
