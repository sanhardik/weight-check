import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";

type Group = {
  thickness_mm: number; width_mm: number; length_mm: number;
  grade?: string | null;
  pieces_in: number; pieces_out: number; pieces_available: number;
  theoretical_weight_available_kg: number;
};

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const d = await apiFetch("/inventory", {}, token);
    setGroups(d);
  }, [token]);

  useEffect(() => { if (token) load().catch(() => setGroups([])); }, [token, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  if (!user) return <Redirect href="/login" />;

  const totalItems = groups?.reduce((a, g) => a + g.pieces_available, 0) ?? 0;
  const totalWeight = groups?.reduce((a, g) => a + g.theoretical_weight_available_kg, 0) ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={t("inventory")} showBack />
      <View style={s.summary}>
        <View style={s.summaryCell}>
          <Text style={s.summaryLbl}>{t("total_items")}</Text>
          <Text style={s.summaryVal} testID="summary-items">{totalItems}</Text>
        </View>
        <View style={s.summaryDivider} />
        <View style={s.summaryCell}>
          <Text style={s.summaryLbl}>{t("total_weight")}</Text>
          <Text style={s.summaryVal} testID="summary-weight">{totalWeight.toFixed(1)} kg</Text>
        </View>
      </View>
      <View style={s.header}>
        <Text style={[s.hCell, { flex: 2 }]}>DIMENSIONS (mm)</Text>
        <Text style={s.hCell}>IN</Text>
        <Text style={s.hCell}>OUT</Text>
        <Text style={[s.hCell, { color: colors.brand }]}>AVL</Text>
        <Text style={[s.hCell, { flex: 1.2 }]}>WT(kg)</Text>
      </View>
      {!groups ? (
        <View style={{ padding: spacing.xl }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          testID="inventory-list"
          data={groups}
          keyExtractor={(g, i) => `${g.thickness_mm}-${g.width_mm}-${g.length_mm}-${g.grade || ""}-${i}`}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={<Text style={s.empty}>{t("no_stock")}</Text>}
          renderItem={({ item: g }) => (
            <View style={s.row}>
              <View style={{ flex: 2 }}>
                <Text style={s.dim}>{g.thickness_mm}×{g.width_mm}×{g.length_mm}</Text>
                {g.grade ? <Text style={s.grade}>{g.grade}</Text> : null}
              </View>
              <Text style={s.cell}>{g.pieces_in}</Text>
              <Text style={s.cell}>{g.pieces_out}</Text>
              <Text style={[s.cell, { color: colors.brand, fontWeight: "900" }]}>{g.pieces_available}</Text>
              <Text style={[s.cell, { flex: 1.2 }]}>{g.theoretical_weight_available_kg.toFixed(1)}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  summary: { flexDirection: "row", padding: spacing.md, borderBottomWidth: 1.5, borderBottomColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  summaryCell: { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1.5, backgroundColor: colors.borderStrong, marginHorizontal: spacing.sm },
  summaryLbl: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.muted },
  summaryVal: { fontSize: 24, fontWeight: "900", color: colors.onSurface, fontFamily: "Courier", marginTop: 2 },
  header: { flexDirection: "row", padding: spacing.sm, backgroundColor: colors.surfaceInverse, borderBottomWidth: 1.5, borderBottomColor: colors.borderStrong },
  hCell: { flex: 1, fontSize: 10, fontWeight: "900", letterSpacing: 1, color: colors.onSurfaceInverse, textAlign: "center" },
  row: { flexDirection: "row", padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: "center" },
  dim: { fontFamily: "Courier", fontSize: 14, fontWeight: "900", color: colors.onSurface },
  grade: { fontSize: 10, color: colors.muted, letterSpacing: 1 },
  cell: { flex: 1, textAlign: "center", fontFamily: "Courier", fontSize: 14, fontWeight: "700", color: colors.onSurface },
  empty: { textAlign: "center", padding: spacing.xl, color: colors.muted, fontWeight: "900", letterSpacing: 1 },
});
