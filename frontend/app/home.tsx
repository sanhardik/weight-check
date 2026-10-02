import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { router, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";

type Tile = { testID: string; en: string; hi: string; href: string; bg: string; fg: string; sub?: string };

type Analytics = {
  totals_today: { inward_pcs: number; outward_pcs: number; inward_kg: number; outward_kg: number };
  totals_window: { inward_pcs: number; outward_pcs: number; inward_kg: number; outward_kg: number };
  pending_office: number;
  total_entries: number;
  daily: { day: string; inward_kg: number; outward_kg: number; inward_count: number; outward_count: number }[];
  top_parties: { name: string; pieces: number; weight: number; count: number }[];
  top_brokers: { name: string; pieces: number; weight: number; count: number }[];
  low_stock_threshold_pcs: number;
  low_stock: { thickness_mm: number; width_mm: number; length_mm: number; grade: string | null; pieces_available: number; theoretical_weight_available_kg: number; avg_weekly_pcs: number; weeks_remaining: number | null; suggested_reorder_pcs: number }[];
};

export default function Home() {
  const insets = useSafeAreaInsets();
  const { user, token, logout } = useAuth();
  const { t, lang } = useI18n();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [tally, setTally] = useState<{ done: number; total: number } | null>(null);

  const showAnalytics = user && (user.role === "admin" || user.role === "office");
  const showTally = user && (user.role === "labour" || user.role === "admin");

  useEffect(() => {
    if (!showAnalytics || !token) return;
    apiFetch("/analytics/summary?days=7", {}, token).then(setAnalytics).catch(() => setAnalytics(null));
  }, [showAnalytics, token]);

  useEffect(() => {
    if (!showTally || !token) return;
    apiFetch("/verifications/today", {}, token)
      .then((d) => setTally({ done: d.done || 0, total: d.total || 0 }))
      .catch(() => setTally(null));
  }, [showTally, token]);

  if (!user) return <Redirect href="/login" />;

  const tiles: Tile[] = [];
  if (user.role === "labour" || user.role === "admin") {
    tiles.push({ testID: "tile-mukadam", en: "WAREHOUSE KEEPER", hi: "मुकादम", href: "/mukadam", bg: colors.brandTertiary, fg: colors.onSurface, sub: "SELECT YOUR NAME" });
    tiles.push({ testID: "tile-tally", en: "DAILY TALLY", hi: "आज की गिनती", href: "/verify", bg: colors.surfaceTertiary, fg: colors.onSurface, sub: "PHYSICAL VERIFICATION + PHOTO" });
    tiles.push({ testID: "tile-entries-labour", en: "MY ENTRIES", hi: "मेरी एंट्री", href: "/entries", bg: colors.surfaceSecondary, fg: colors.onSurface, sub: "ADD SLIP PHOTO LATER" });
    tiles.push({ testID: "tile-inward", en: "INWARD", hi: "आवक", href: "/inward", bg: colors.brand, fg: colors.onBrand, sub: "+ ADD MATERIAL" });
    tiles.push({ testID: "tile-outward", en: "OUTWARD", hi: "जावक", href: "/outward", bg: colors.surfaceInverse, fg: colors.onSurfaceInverse, sub: "- SEND MATERIAL" });
  }
  if (user.role === "admin" || user.role === "office") {
    tiles.push({ testID: "tile-entries", en: "ENTRIES", hi: "एंट्री सूची", href: "/entries", bg: colors.surface, fg: colors.onSurface, sub: "VIEW · EDIT · EXPORT" });
    tiles.push({ testID: "tile-verifications", en: "VERIFICATION LOG", hi: "जाँच रजिस्टर", href: "/verifications", bg: colors.surface, fg: colors.onSurface, sub: "TALLY HISTORY · REVIEW · ASSIGN" });
    tiles.push({ testID: "tile-settings", en: "SETTINGS · CATALOG", hi: "सेटिंग्स", href: "/settings", bg: colors.surfaceSecondary, fg: colors.onSurface, sub: "BROKERS · MUKADAMS · GRADES · DIMENSIONS" });
  }
  tiles.push({ testID: "tile-inventory", en: "INVENTORY", hi: "स्टॉक स्थिति", href: "/inventory", bg: colors.surfaceSecondary, fg: colors.onSurface, sub: "LIVE STOCK" });
  if (user.role === "admin") {
    tiles.push({ testID: "tile-users", en: "USERS", hi: "यूज़र", href: "/users", bg: colors.surfaceTertiary, fg: colors.onSurface, sub: "MANAGE ACCESS" });
  }

  const maxDay = analytics ? Math.max(1, ...analytics.daily.map((d) => Math.max(d.inward_kg, d.outward_kg))) : 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={t("dashboard")} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }} testID="home-scroll">
        <Text style={s.greet}>HI, {user.name.toUpperCase()}</Text>
        <Text style={s.greetSub}>{t("select_action")}</Text>

        {showTally && tally && tally.total > 0 ? (
          <Pressable
            testID="tally-card"
            onPress={() => router.push("/verify")}
            style={[s.tallyCard, { backgroundColor: tally.done >= tally.total ? colors.success : colors.warning }]}
          >
            <Text style={s.tallyTitle}>
              {tally.done >= tally.total ? "✓" : "📋"} {t("daily_tally")} · आज की गिनती — {tally.done}/{tally.total} DONE
            </Text>
            <Text style={s.tallySub}>
              {tally.done >= tally.total ? "All items physically verified today" : "Tap to physically count & upload photo proof →"}
            </Text>
          </Pressable>
        ) : null}

        {showAnalytics ? (
          <View testID="analytics-card" style={s.analytics}>
            <View style={s.analyticsHdr}>
              <Text style={s.analyticsTitle}>TODAY · आज</Text>
              <Text style={s.analyticsHint}>{analytics ? "7-DAY TREND" : ""}</Text>
            </View>
            {!analytics ? (
              <View style={{ paddingVertical: spacing.lg }}><ActivityIndicator color={colors.brand} /></View>
            ) : (
              <>
                <View style={s.statRow}>
                  <View style={[s.statCell, { backgroundColor: colors.brand }]}>
                    <Text style={[s.statLbl, { color: colors.onBrand }]}>IN · आवक</Text>
                    <Text style={[s.statVal, { color: colors.onBrand }]} testID="today-inward-kg">{analytics.totals_today.inward_kg.toFixed(1)}</Text>
                    <Text style={[s.statUnit, { color: colors.onBrand }]}>KG · {analytics.totals_today.inward_pcs} PCS</Text>
                  </View>
                  <View style={[s.statCell, { backgroundColor: colors.surfaceInverse }]}>
                    <Text style={[s.statLbl, { color: colors.onSurfaceInverse }]}>OUT · जावक</Text>
                    <Text style={[s.statVal, { color: colors.onSurfaceInverse }]} testID="today-outward-kg">{analytics.totals_today.outward_kg.toFixed(1)}</Text>
                    <Text style={[s.statUnit, { color: colors.onSurfaceInverse }]}>KG · {analytics.totals_today.outward_pcs} PCS</Text>
                  </View>
                </View>

                <View style={s.chartWrap}>
                  {analytics.daily.map((d, i) => {
                    const inH = Math.round((d.inward_kg / maxDay) * 60);
                    const outH = Math.round((d.outward_kg / maxDay) * 60);
                    const dayLabel = d.day.slice(5); // MM-DD
                    return (
                      <View key={d.day} style={s.barCol} testID={`bar-${i}`}>
                        <View style={s.barStack}>
                          <View style={[s.barIn, { height: inH }]} />
                          <View style={[s.barOut, { height: outH }]} />
                        </View>
                        <Text style={s.barLbl}>{dayLabel}</Text>
                      </View>
                    );
                  })}
                </View>
                <View style={s.legendRow}>
                  <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.brand }]} /><Text style={s.legendTxt}>INWARD</Text></View>
                  <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.surfaceInverse }]} /><Text style={s.legendTxt}>OUTWARD</Text></View>
                  <View style={{ flex: 1 }} />
                  <Text style={s.legendTxt}>7D: {analytics.totals_window.inward_kg.toFixed(0)}↓ · {analytics.totals_window.outward_kg.toFixed(0)}↑</Text>
                </View>

                {analytics.low_stock && analytics.low_stock.length > 0 ? (
                  <Pressable
                    testID="low-stock-card"
                    onPress={() => router.push("/inventory")}
                    style={s.lowStockCard}
                  >
                    <View style={s.lowStockHdr}>
                      <Text style={s.lowStockTitle}>⚠ LOW STOCK · कम स्टॉक</Text>
                      <Text style={s.lowStockHint}>≤ {analytics.low_stock_threshold_pcs} PCS</Text>
                    </View>
                    {analytics.low_stock.slice(0, 4).map((ls, i) => (
                      <View key={`${ls.thickness_mm}-${ls.width_mm}-${ls.length_mm}-${ls.grade}-${i}`} style={s.lowStockRow} testID={`low-stock-${i}`}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.lowStockDim}>
                            {ls.thickness_mm}×{ls.width_mm}×{ls.length_mm}
                            {ls.grade ? ` · ${ls.grade}` : ""}
                          </Text>
                          {ls.avg_weekly_pcs > 0 ? (
                            <Text style={s.lowStockConsume}>
                              {ls.avg_weekly_pcs} PCS/WK
                              {ls.weeks_remaining != null ? ` · ${ls.weeks_remaining}WK LEFT` : ""}
                              {ls.suggested_reorder_pcs > 0 ? ` · ORDER ${ls.suggested_reorder_pcs}` : ""}
                            </Text>
                          ) : (
                            <Text style={s.lowStockConsume}>NO RECENT OUTWARD · REORDER {ls.suggested_reorder_pcs}</Text>
                          )}
                        </View>
                        <Text style={s.lowStockPcs}>{ls.pieces_available}</Text>
                      </View>
                    ))}
                    {analytics.low_stock.length > 4 ? (
                      <Text style={s.lowStockMore}>+ {analytics.low_stock.length - 4} more → VIEW INVENTORY</Text>
                    ) : null}
                  </Pressable>
                ) : null}

                {analytics.pending_office > 0 ? (
                  <Pressable
                    testID="pending-office-pill"
                    onPress={() => router.push("/entries")}
                    style={s.pendingPill}
                  >
                    <Text style={s.pendingTxt}>⏳ {analytics.pending_office} ENTRIES PENDING OFFICE DETAILS →</Text>
                  </Pressable>
                ) : null}

                {analytics.top_parties.length > 0 ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={s.sectionTitle}>TOP PARTIES · 7D</Text>
                    {analytics.top_parties.slice(0, 3).map((p, i) => (
                      <View key={p.name} style={s.topRow} testID={`top-party-${i}`}>
                        <Text style={s.topRank}>#{i + 1}</Text>
                        <Text style={s.topName} numberOfLines={1}>{p.name}</Text>
                        <Text style={s.topWeight}>{p.weight.toFixed(0)} kg</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {analytics.top_brokers.length > 0 ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={s.sectionTitle}>TOP BROKERS · 7D</Text>
                    {analytics.top_brokers.slice(0, 3).map((b, i) => (
                      <View key={b.name} style={s.topRow} testID={`top-broker-${i}`}>
                        <Text style={s.topRank}>#{i + 1}</Text>
                        <Text style={s.topName} numberOfLines={1}>{b.name}</Text>
                        <Text style={s.topWeight}>{b.weight.toFixed(0)} kg</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        <View style={s.grid}>
          {tiles.map((tile) => (
            <Pressable
              key={tile.href}
              testID={tile.testID}
              onPress={() => router.push(tile.href as any)}
              style={({ pressed }) => [s.tile, { backgroundColor: tile.bg, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[s.tileHi, { color: tile.fg }]}>{tile.hi}</Text>
              <Text style={[s.tileEn, { color: tile.fg }]}>{tile.en}</Text>
              {tile.sub ? <Text style={[s.tileSub, { color: tile.fg }]}>{tile.sub}</Text> : null}
            </Pressable>
          ))}
        </View>

        <Pressable testID="logout-btn" onPress={logout} style={s.logout}>
          <Text style={s.logoutTxt}>{t("logout").toUpperCase()}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  greet: { fontSize: 24, fontWeight: "900", color: colors.onSurface, letterSpacing: 1, marginTop: spacing.sm },
  greetSub: { fontSize: 12, fontWeight: "900", color: colors.muted, letterSpacing: 2, marginBottom: spacing.md },

  analytics: { borderWidth: 1.5, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface, marginBottom: spacing.sm },
  analyticsHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  analyticsTitle: { fontSize: 14, fontWeight: "900", letterSpacing: 2, color: colors.onSurface },
  analyticsHint: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.muted },

  statRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  statCell: { flex: 1, padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong },
  statLbl: { fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  statVal: { fontSize: 28, fontWeight: "900", marginTop: 4 },
  statUnit: { fontSize: 10, fontWeight: "700", letterSpacing: 1, marginTop: 2, opacity: 0.9 },

  chartWrap: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 80, borderBottomWidth: 1.5, borderBottomColor: colors.borderStrong, paddingBottom: 4 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barStack: { flexDirection: "row", gap: 2, alignItems: "flex-end", height: 65 },
  barIn: { width: 7, backgroundColor: colors.brand },
  barOut: { width: 7, backgroundColor: colors.surfaceInverse },
  barLbl: { fontSize: 8, fontWeight: "900", letterSpacing: 0.5, color: colors.muted, marginTop: 2 },

  legendRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, gap: spacing.md, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 10, height: 10, borderWidth: 1, borderColor: colors.borderStrong },
  legendTxt: { fontSize: 10, fontWeight: "900", letterSpacing: 1, color: colors.muted },

  pendingPill: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.warning, borderWidth: 1.5, borderColor: colors.borderStrong },
  pendingTxt: { color: colors.onWarning, fontWeight: "900", letterSpacing: 1, fontSize: 12 },

  lowStockCard: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.error, backgroundColor: colors.surface },
  lowStockHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  lowStockTitle: { fontSize: 13, fontWeight: "900", letterSpacing: 1, color: colors.error },
  lowStockHint: { fontSize: 10, fontWeight: "900", letterSpacing: 1, color: colors.muted },
  lowStockRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  lowStockDim: { flex: 1, fontSize: 13, fontWeight: "900", color: colors.onSurface },
  lowStockConsume: { fontSize: 10, color: colors.muted, fontWeight: "900", letterSpacing: 1, marginTop: 2 },
  lowStockPcs: { fontSize: 20, fontWeight: "900", color: colors.error, marginLeft: spacing.sm },
  lowStockMore: { fontSize: 10, fontWeight: "900", color: colors.muted, letterSpacing: 1, marginTop: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: spacing.xs },
  topRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  topRank: { fontSize: 13, fontWeight: "900", color: colors.brand, width: 24 },
  topName: { flex: 1, fontSize: 13, fontWeight: "900", color: colors.onSurface },
  topWeight: { fontSize: 13, fontWeight: "900", color: colors.onSurface },

  grid: { gap: spacing.md, marginTop: spacing.sm },
  tallyCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.xs },
  tallyTitle: { fontSize: 14, fontWeight: "900", letterSpacing: 1, color: colors.onWarning },
  tallySub: { fontSize: 11, fontWeight: "700", color: colors.onWarning, marginTop: 4, opacity: 0.9 },
  tile: { minHeight: 110, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.borderStrong, justifyContent: "space-between" },
  tileHi: { fontSize: 28, fontWeight: "900", letterSpacing: 0.5 },
  tileEn: { fontSize: 20, fontWeight: "900", letterSpacing: 2, marginTop: 2 },
  tileSub: { fontSize: 11, fontWeight: "700", letterSpacing: 2, marginTop: spacing.sm, opacity: 0.8 },
  logout: { marginTop: spacing.lg, paddingVertical: spacing.md, borderWidth: 1.5, borderColor: colors.error, alignItems: "center", backgroundColor: colors.surface },
  logoutTxt: { color: colors.error, fontWeight: "900", letterSpacing: 2, fontSize: 14 },
});
