import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useAuth, apiFetch } from "@/src/auth";
import { colors, spacing } from "@/src/theme";

export default function OfficeInventory() {
  const { token } = useAuth();
  const [data, setData] = useState<any[] | null>(null);
  const [grades, setGrades] = useState<string[]>([]);
  const [grade, setGrade] = useState<string>("ALL");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const r = await apiFetch("/inventory", {}, token);
    setData(r);
    const gs = Array.from(new Set(r.map((x: any) => x.grade).filter(Boolean))) as string[];
    setGrades(gs.sort());
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return null;
    return data.filter((g) => {
      if (grade !== "ALL" && g.grade !== grade) return false;
      const label = `${g.thickness_mm}×${g.width_mm}×${g.length_mm} ${g.grade || ""}`.toLowerCase();
      return !q || label.includes(q.toLowerCase());
    });
  }, [data, grade, q]);

  const totals = useMemo(() => {
    if (!filtered) return null;
    return {
      items: filtered.length,
      pieces: filtered.reduce((a, b) => a + b.pieces_available, 0),
      weight: filtered.reduce((a, b) => a + b.theoretical_weight_available_kg, 0),
    };
  }, [filtered]);

  if (!filtered || !totals) return <View style={{ padding: spacing.xxxl, alignItems: "center" }}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <View>
      <Text style={s.pageTitle}>Inventory · स्टॉक</Text>
      <Text style={s.pageSub}>Live stock aggregated across every inward and outward entry</Text>

      <View style={s.kpiRow}>
        <View style={s.kpi}><Text style={s.kpiL}>Groups</Text><Text style={s.kpiV}>{totals.items}</Text></View>
        <View style={s.kpi}><Text style={s.kpiL}>Available pieces</Text><Text style={s.kpiV}>{totals.pieces}</Text></View>
        <View style={s.kpi}><Text style={s.kpiL}>Available weight</Text><Text style={s.kpiV}>{totals.weight.toFixed(0)} <Text style={{ fontSize: 12 }}>kg</Text></Text></View>
      </View>

      <View style={s.filters}>
        <View style={s.chipRow}>
          <Pressable onPress={() => setGrade("ALL")} style={[s.chip, grade === "ALL" && s.chipActive]}>
            <Text style={[s.chipTxt, grade === "ALL" && s.chipTxtActive]}>ALL</Text>
          </Pressable>
          {grades.map((g) => (
            <Pressable key={g} onPress={() => setGrade(g)} style={[s.chip, grade === g && s.chipActive]} testID={`inv-grade-${g}`}>
              <Text style={[s.chipTxt, grade === g && s.chipTxtActive]}>{g}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput testID="inv-search" value={q} onChangeText={setQ} placeholder="Search size" placeholderTextColor={colors.muted} style={s.search} />
      </View>

      <View style={s.table} testID="inv-table">
        <View style={s.thead}>
          <Text style={[s.th, { flex: 2 }]}>DIMENSIONS (mm)</Text>
          <Text style={[s.th, { width: 90 }]}>GRADE</Text>
          <Text style={[s.th, { width: 70, textAlign: "right" }]}>IN</Text>
          <Text style={[s.th, { width: 70, textAlign: "right" }]}>OUT</Text>
          <Text style={[s.th, { width: 80, textAlign: "right" }]}>AVAIL</Text>
          <Text style={[s.th, { width: 120, textAlign: "right" }]}>WEIGHT</Text>
          <Text style={[s.th, { width: 180 }]}>LAST VERIFIED</Text>
        </View>
        {filtered.map((g, i) => (
          <View key={i} style={s.row}>
            <Text style={[s.td, { flex: 2, fontWeight: "900" }]}>{g.thickness_mm}×{g.width_mm}×{g.length_mm}</Text>
            <Text style={[s.td, { width: 90 }]}>{g.grade || "—"}</Text>
            <Text style={[s.td, { width: 70, textAlign: "right", color: colors.success, fontWeight: "900" }]}>{g.pieces_in}</Text>
            <Text style={[s.td, { width: 70, textAlign: "right", color: colors.error, fontWeight: "900" }]}>{g.pieces_out}</Text>
            <Text style={[s.td, { width: 80, textAlign: "right", color: colors.brand, fontWeight: "900" }]}>{g.pieces_available}</Text>
            <Text style={[s.td, { width: 120, textAlign: "right" }]}>{g.theoretical_weight_available_kg.toFixed(1)} kg</Text>
            <Text style={[s.td, { width: 180, fontSize: 11, color: g.last_verified_at ? colors.success : colors.muted }]}>
              {g.last_verified_at ? `✓ ${new Date(g.last_verified_at).toLocaleDateString()}${g.last_verified_by ? ` · ${g.last_verified_by}` : ""}` : "— never verified"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  pageSub: { fontSize: 14, color: colors.muted, marginBottom: spacing.lg },
  kpiRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg, flexWrap: "wrap" },
  kpi: { minWidth: 180, flexGrow: 1, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kpiL: { fontSize: 11, fontWeight: "900", letterSpacing: 1, color: colors.muted },
  kpiV: { fontSize: 24, fontWeight: "900", color: colors.onSurface, marginTop: 4 },
  filters: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.md },
  chipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { fontSize: 11, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  chipTxtActive: { color: colors.onBrand },
  search: { borderWidth: 1.5, borderColor: colors.border, padding: 10, backgroundColor: colors.surface, color: colors.onSurface, fontSize: 14 },
  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  thead: { flexDirection: "row", padding: 10, backgroundColor: colors.surfaceInverse, gap: spacing.sm },
  th: { fontSize: 10, fontWeight: "900", color: colors.onSurfaceInverse, letterSpacing: 2 },
  row: { flexDirection: "row", padding: 10, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm, alignItems: "center" },
  td: { fontSize: 13, color: colors.onSurface },
});
