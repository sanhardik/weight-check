import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { colors, spacing } from "@/src/theme";
import { toast } from "@/src/ui/Toast";

type Entry = any;

export default function OfficeEntries() {
  const { user, token } = useAuth();
  const params = useLocalSearchParams<{ pending?: string }>();
  const [all, setAll] = useState<Entry[] | null>(null);
  const [direction, setDirection] = useState<"all" | "inward" | "outward">("all");
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(params.pending === "1");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const load = useCallback(async () => {
    const q = direction === "all" ? "" : `?direction=${direction}`;
    const r = await apiFetch(`/entries${q}`, {}, token);
    setAll(r);
  }, [token, direction]);
  useEffect(() => { load(); }, [load]);

  const data = useMemo(() => {
    if (!all) return null;
    const q = search.trim().toLowerCase();
    return all.filter((e: Entry) => {
      if (onlyPending && e.invoice_no) return false;
      if (onlyFlagged && !(e.variance_flagged || e.slip_mismatch_flag)) return false;
      if (!q) return true;
      return (
        (e.entry_number || "").toLowerCase().includes(q) ||
        (e.vehicle_number || "").toLowerCase().includes(q) ||
        (e.invoice_no || "").toLowerCase().includes(q) ||
        (e.party_name || "").toLowerCase().includes(q) ||
        (e.broker_name || "").toLowerCase().includes(q)
      );
    });
  }, [all, search, onlyPending, onlyFlagged]);

  const canExport = user?.role === "admin" || user?.role === "office";
  const exportCsv = async () => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      const url = `${base}/api/entries/export.csv${direction !== "all" ? `?direction=${direction}` : ""}`;
      if (Platform.OS === "web") {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await r.blob();
        const dlUrl = URL.createObjectURL(blob);
        const win: any = (globalThis as any).window;
        if (win?.open) win.open(dlUrl, "_blank");
      }
      toast("CSV ready", "success");
    } catch (e: any) { toast(e.message || "Export failed", "error"); }
  };

  return (
    <View>
      <View style={s.pageHdr}>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>Entries · एंट्री</Text>
          <Text style={s.pageSub}>Add invoice details, correct values, email invoices</Text>
        </View>
        {canExport ? (
          <Pressable onPress={exportCsv} style={s.exportBtn} testID="office-export-csv">
            <Text style={s.exportTxt}>⇩ EXPORT CSV</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.filterBar}>
        <View style={s.chipRow}>
          {(["all", "inward", "outward"] as const).map((d) => (
            <Pressable key={d} testID={`office-filter-${d}`} onPress={() => setDirection(d)} style={[s.chip, direction === d && s.chipActive]}>
              <Text style={[s.chipTxt, direction === d && s.chipTxtActive]}>{d.toUpperCase()}</Text>
            </Pressable>
          ))}
          <Pressable testID="office-filter-pending" onPress={() => setOnlyPending((v) => !v)} style={[s.chip, onlyPending && s.chipActive]}>
            <Text style={[s.chipTxt, onlyPending && s.chipTxtActive]}>⏳ PENDING OFFICE</Text>
          </Pressable>
          <Pressable testID="office-filter-flagged" onPress={() => setOnlyFlagged((v) => !v)} style={[s.chip, onlyFlagged && s.chipActive]}>
            <Text style={[s.chipTxt, onlyFlagged && s.chipTxtActive]}>⚠ FLAGGED</Text>
          </Pressable>
        </View>
        <TextInput
          testID="office-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search · entry no · vehicle · invoice · party · broker"
          placeholderTextColor={colors.muted}
          style={s.search}
        />
      </View>

      {!data ? (
        <View style={{ padding: spacing.xxxl, alignItems: "center" }}><ActivityIndicator color={colors.brand} /></View>
      ) : data.length === 0 ? (
        <Text style={s.empty}>No entries match</Text>
      ) : (
        <View style={s.table} testID="office-entries-table">
          <View style={s.theadRow}>
            <Text style={[s.th, { width: 110 }]}>ENTRY #</Text>
            <Text style={[s.th, { width: 70 }]}>TYPE</Text>
            <Text style={[s.th, { flex: 1 }]}>DIMENSIONS</Text>
            <Text style={[s.th, { width: 60, textAlign: "right" }]}>PCS</Text>
            <Text style={[s.th, { width: 100, textAlign: "right" }]}>WEIGHT</Text>
            <Text style={[s.th, { width: 130 }]}>VEHICLE</Text>
            <Text style={[s.th, { flex: 1 }]}>PARTY</Text>
            <Text style={[s.th, { width: 100 }]}>STATUS</Text>
            <Text style={[s.th, { width: 100 }]}>DATE</Text>
          </View>
          {data.map((e: Entry) => (
            <Pressable
              key={e.id}
              testID={`office-row-${e.entry_number}`}
              onPress={() => router.push({ pathname: "/office/entries/[id]", params: { id: e.id } } as any)}
              style={({ hovered }: any) => [s.trow, hovered && { backgroundColor: colors.brandTertiary }]}
            >
              <Text style={[s.td, { width: 110, fontWeight: "900" }]}>{e.entry_number}</Text>
              <Text style={[s.td, { width: 70, color: e.direction === "inward" ? colors.brand : colors.onSurface, fontWeight: "900" }]}>{e.direction === "inward" ? "IN" : "OUT"}</Text>
              <Text style={[s.td, { flex: 1 }]} numberOfLines={1}>
                {e.thickness_mm}×{e.width_mm}×{e.length_mm}{e.grade ? ` · ${e.grade}` : ""}{e.line_items && e.line_items.length > 1 ? ` +${e.line_items.length - 1}` : ""}
              </Text>
              <Text style={[s.td, { width: 60, textAlign: "right" }]}>{e.pieces}</Text>
              <Text style={[s.td, { width: 100, textAlign: "right" }]}>{e.theoretical_weight_kg?.toFixed(1)} kg</Text>
              <Text style={[s.td, { width: 130 }]} numberOfLines={1}>{e.vehicle_number}</Text>
              <Text style={[s.td, { flex: 1 }]} numberOfLines={1}>{e.party_name || "—"}</Text>
              <View style={{ width: 100, flexDirection: "row", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {e.invoice_no ? <Text style={[s.tag, s.tagOk]}>✓ INV</Text> : <Text style={[s.tag, s.tagWarn]}>⏳</Text>}
                {e.variance_flagged ? <Text style={[s.tag, s.tagErr]}>⚠ VAR</Text> : null}
                {e.slip_mismatch_flag ? <Text style={[s.tag, s.tagErr]}>⚠ SLIP</Text> : null}
              </View>
              <Text style={[s.td, { width: 100, fontSize: 11, color: colors.muted }]}>{new Date(e.entry_date || e.created_at).toLocaleDateString()}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  pageHdr: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.lg, gap: spacing.md },
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  pageSub: { fontSize: 14, color: colors.muted, marginTop: 2 },
  exportBtn: { paddingHorizontal: spacing.md, paddingVertical: 10, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  exportTxt: { fontSize: 12, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },

  filterBar: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.md },
  chipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { fontSize: 11, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  chipTxtActive: { color: colors.onBrand },
  search: { borderWidth: 1.5, borderColor: colors.border, padding: 10, fontSize: 14, color: colors.onSurface, backgroundColor: colors.surface },

  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  theadRow: { flexDirection: "row", padding: 10, backgroundColor: colors.surfaceInverse, gap: spacing.sm },
  th: { fontSize: 10, fontWeight: "900", color: colors.onSurfaceInverse, letterSpacing: 2 },
  trow: { flexDirection: "row", padding: 10, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm, alignItems: "center" },
  td: { fontSize: 13, color: colors.onSurface },
  tag: { fontSize: 10, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 3 },
  tagOk: { backgroundColor: colors.success, color: colors.onSuccess },
  tagWarn: { backgroundColor: colors.warning, color: colors.onWarning },
  tagErr: { backgroundColor: colors.error, color: colors.onError },
  empty: { padding: spacing.xxxl, textAlign: "center", color: colors.muted, fontStyle: "italic" },
});
