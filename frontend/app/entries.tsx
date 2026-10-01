import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator, RefreshControl, Platform, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { toast } from "@/src/ui/Toast";

type Entry = {
  id: string;
  entry_number: string;
  direction: "inward" | "outward";
  thickness_mm: number; width_mm: number; length_mm: number;
  pieces: number; grade?: string | null;
  vehicle_number: string; broker_name?: string | null;
  theoretical_weight_kg: number; actual_weight_kg?: number | null;
  variance_pct?: number | null; variance_flagged?: boolean | null;
  created_by_name?: string; created_at: string;
  invoice_no?: string | null; party_name?: string | null;
};

const FILTERS = [
  { id: "all", label: "ALL" },
  { id: "inward", label: "INWARD" },
  { id: "outward", label: "OUTWARD" },
  { id: "pending", label: "PENDING OFFICE" },
];

export default function EntriesScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState<Entry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const q = filter === "inward" || filter === "outward" ? `?direction=${filter}` : "";
    const d: Entry[] = await apiFetch(`/entries${q}`, {}, token);
    const filtered = filter === "pending" ? d.filter((e) => !e.invoice_no) : d;
    setData(filtered);
  }, [filter, token]);

  useEffect(() => { if (token) load().catch(() => setData([])); }, [token, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  if (!user) return <Redirect href="/login" />;

  const canExport = user.role === "admin" || user.role === "office";
  const exportCsv = async () => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      const qp = filter === "inward" || filter === "outward" ? `&direction=${filter}` : "";
      const url = `${base}/api/entries.csv?token=${encodeURIComponent(token || "")}${qp}`;
      if (Platform.OS === "web") {
        // Trigger browser download
        const a = (globalThis as any).document?.createElement("a");
        if (a) {
          a.href = url;
          a.download = "steeltrack-entries.csv";
          a.click();
          toast("CSV downloaded", "success");
        } else {
          await Linking.openURL(url);
        }
      } else {
        await Linking.openURL(url);
        toast("CSV opening in browser", "success");
      }
    } catch (e: any) {
      toast(e.message || "Export failed", "error");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header
        title={t("entries")}
        showBack
        right={canExport ? (
          <Pressable testID="export-csv-btn" onPress={exportCsv} style={styles2.exportBtn}>
            <Text style={styles2.exportTxt}>CSV</Text>
          </Pressable>
        ) : undefined}
      />
      <View style={s.chipHeader}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              testID={`filter-${f.id}`}
              onPress={() => setFilter(f.id)}
              style={[s.chip, filter === f.id && s.chipActive]}
            >
              <Text style={[s.chipTxt, filter === f.id && s.chipTxtActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {!data ? (
        <View style={{ padding: spacing.xl }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          testID="entries-list"
          data={data}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={<Text style={s.empty}>{t("no_entries")}</Text>}
          renderItem={({ item: e }) => (
            <Pressable
              testID={`entry-${e.entry_number}`}
              style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1, borderLeftColor: e.direction === "inward" ? colors.brand : colors.surfaceInverse }]}
              onPress={() => router.push({ pathname: "/entry/[id]", params: { id: e.id } })}
            >
              <View style={s.cardTop}>
                <Text style={[s.badge, { backgroundColor: e.direction === "inward" ? colors.brand : colors.surfaceInverse, color: colors.onBrand }]}>
                  {e.direction === "inward" ? "IN · आवक" : "OUT · जावक"}
                </Text>
                <Text style={s.entryNo}>{e.entry_number}</Text>
                {e.variance_flagged ? <Text style={s.flag}>⚠ {e.variance_pct?.toFixed(2)}%</Text> : null}
              </View>
              <Text style={s.dim}>{e.thickness_mm}×{e.width_mm}×{e.length_mm} mm · {e.pieces} pcs</Text>
              <View style={s.cardRow}>
                <Text style={s.meta}>🚚 {e.vehicle_number}</Text>
                <Text style={s.meta}>{e.theoretical_weight_kg.toFixed(1)} kg</Text>
              </View>
              {e.broker_name ? <Text style={s.meta}>Broker: {e.broker_name}</Text> : null}
              <View style={s.cardFooter}>
                {e.invoice_no ? (
                  <Text style={[s.statusTag, { backgroundColor: colors.success, color: colors.onSuccess }]}>✓ INV {e.invoice_no}</Text>
                ) : (
                  <Text style={[s.statusTag, { backgroundColor: colors.warning, color: colors.onWarning }]}>⏳ {t("pending_office")}</Text>
                )}
                <Text style={s.by}>{e.created_by_name}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  chipHeader: { height: 56, borderBottomWidth: 1.5, borderBottomColor: colors.borderStrong, justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipRow: { paddingHorizontal: spacing.md, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { fontSize: 11, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  chipTxtActive: { color: colors.onBrand },
  empty: { textAlign: "center", padding: spacing.xxl, color: colors.muted, fontWeight: "900", letterSpacing: 1 },
  card: { padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.borderStrong, borderLeftWidth: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  badge: { fontSize: 11, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 4 },
  entryNo: { fontSize: 13, fontWeight: "900", color: colors.onSurface, fontFamily: "Courier" },
  flag: { fontSize: 11, fontWeight: "900", color: colors.error, marginLeft: "auto" },
  dim: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: "Courier", marginTop: 6 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  meta: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, flexWrap: "wrap", gap: spacing.sm },
  statusTag: { fontSize: 10, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 4 },
  by: { fontSize: 11, color: colors.muted, fontWeight: "700" },
});

const styles2 = StyleSheet.create({
  exportBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderColor: colors.onSurfaceInverse,
    backgroundColor: colors.success,
  },
  exportTxt: { color: colors.onSuccess, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
});
