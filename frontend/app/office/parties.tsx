import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform, Linking } from "react-native";
import { useAuth, apiFetch } from "@/src/auth";
import { colors, spacing } from "@/src/theme";

type P = {
  name: string; whatsapp?: string | null; whatsapp_digits?: string | null;
  entries: number; pieces: number; weight: number; invoiced: number; pending_office: number; last_at?: string | null;
};

export default function OfficeParties() {
  const { token } = useAuth();
  const [data, setData] = useState<P[] | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const r = await apiFetch("/parties/ledger", {}, token);
    setData(r);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((p) => (p.name || "").toLowerCase().includes(needle));
  }, [data, q]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      parties: data.length,
      pending: data.reduce((s, p) => s + p.pending_office, 0),
      weight: data.reduce((s, p) => s + p.weight, 0),
      entries: data.reduce((s, p) => s + p.entries, 0),
    };
  }, [data]);

  const openWA = (digits?: string | null) => {
    if (!digits) return;
    const url = `https://wa.me/${digits}`;
    if (Platform.OS === "web") (globalThis as any).window?.open?.(url, "_blank");
    else Linking.openURL(url);
  };

  if (!filtered || !totals) return <View style={{ padding: spacing.xxxl, alignItems: "center" }}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <View>
      <Text style={s.pageTitle}>Parties · पार्टी</Text>
      <Text style={s.pageSub}>Khata summary for every party in the system</Text>

      <View style={s.kpiRow}>
        <View style={s.kpi}><Text style={s.kpiL}>Parties</Text><Text style={s.kpiV}>{totals.parties}</Text></View>
        <View style={s.kpi}><Text style={s.kpiL}>Total entries</Text><Text style={s.kpiV}>{totals.entries}</Text></View>
        <View style={[s.kpi, { backgroundColor: totals.pending ? colors.warning : colors.surface }]}><Text style={[s.kpiL, totals.pending ? { color: colors.onWarning } : null]}>Pending office</Text><Text style={[s.kpiV, totals.pending ? { color: colors.onWarning } : null]}>{totals.pending}</Text></View>
        <View style={s.kpi}><Text style={s.kpiL}>Weight shipped</Text><Text style={s.kpiV}>{totals.weight.toFixed(0)} <Text style={{ fontSize: 12 }}>kg</Text></Text></View>
      </View>

      <TextInput testID="parties-search" value={q} onChangeText={setQ} placeholder="Search party by name" placeholderTextColor={colors.muted} style={s.search} />

      <View style={s.table} testID="parties-table">
        <View style={s.thead}>
          <Text style={[s.th, { flex: 2 }]}>PARTY</Text>
          <Text style={[s.th, { width: 80, textAlign: "right" }]}>ENTRIES</Text>
          <Text style={[s.th, { width: 80, textAlign: "right" }]}>INVOICED</Text>
          <Text style={[s.th, { width: 80, textAlign: "right" }]}>PENDING</Text>
          <Text style={[s.th, { width: 110, textAlign: "right" }]}>WEIGHT</Text>
          <Text style={[s.th, { width: 110 }]}>LAST ACTIVITY</Text>
          <Text style={[s.th, { width: 100 }]}>WHATSAPP</Text>
        </View>
        {filtered.length === 0 ? <Text style={s.empty}>No parties</Text> : null}
        {filtered.map((p, i) => (
          <View key={p.name} style={s.row} testID={`party-row-${i}`}>
            <Text style={[s.td, { flex: 2, fontWeight: "900" }]} numberOfLines={1}>{p.name}</Text>
            <Text style={[s.td, { width: 80, textAlign: "right" }]}>{p.entries}</Text>
            <Text style={[s.td, { width: 80, textAlign: "right" }]}>{p.invoiced}</Text>
            <Text style={[s.td, { width: 80, textAlign: "right", color: p.pending_office > 0 ? colors.error : colors.onSurface, fontWeight: p.pending_office > 0 ? "900" : "400" as any }]}>{p.pending_office}</Text>
            <Text style={[s.td, { width: 110, textAlign: "right" }]}>{p.weight.toFixed(1)} kg</Text>
            <Text style={[s.td, { width: 110, fontSize: 11, color: colors.muted }]}>{p.last_at ? new Date(p.last_at).toLocaleDateString() : "—"}</Text>
            <View style={{ width: 100 }}>
              {p.whatsapp_digits ? (
                <Pressable onPress={() => openWA(p.whatsapp_digits)} style={s.waBtn} testID={`party-wa-${i}`}>
                  <Text style={s.waTxt}>💬 {p.whatsapp}</Text>
                </Pressable>
              ) : (
                <Text style={{ fontSize: 11, color: colors.muted }}>—</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  pageSub: { fontSize: 14, color: colors.muted, marginBottom: spacing.lg },

  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.lg },
  kpi: { minWidth: 180, flexGrow: 1, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kpiL: { fontSize: 11, fontWeight: "900", letterSpacing: 1, color: colors.muted },
  kpiV: { fontSize: 24, fontWeight: "900", color: colors.onSurface, marginTop: 4 },

  search: { borderWidth: 1.5, borderColor: colors.border, padding: 10, backgroundColor: colors.surface, color: colors.onSurface, fontSize: 14, marginBottom: spacing.md },

  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  thead: { flexDirection: "row", padding: 10, backgroundColor: colors.surfaceInverse, gap: spacing.sm },
  th: { fontSize: 10, fontWeight: "900", color: colors.onSurfaceInverse, letterSpacing: 2 },
  row: { flexDirection: "row", padding: 10, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm, alignItems: "center" },
  td: { fontSize: 13, color: colors.onSurface },
  waBtn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.success, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center" },
  waTxt: { color: colors.onSuccess, fontWeight: "900", fontSize: 11, letterSpacing: 0.5 },
  empty: { padding: spacing.xl, textAlign: "center", color: colors.muted, fontStyle: "italic" },
});
