import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";

type Tile = { testID: string; en: string; hi: string; href: string; bg: string; fg: string; sub?: string };

export default function Home() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { t, lang } = useI18n();

  if (!user) return <Redirect href="/login" />;

  const tiles: Tile[] = [];
  if (user.role === "labour" || user.role === "admin") {
    tiles.push({ testID: "tile-inward", en: "INWARD", hi: "आवक", href: "/inward", bg: colors.brand, fg: colors.onBrand, sub: "+ ADD MATERIAL" });
    tiles.push({ testID: "tile-outward", en: "OUTWARD", hi: "जावक", href: "/outward", bg: colors.surfaceInverse, fg: colors.onSurfaceInverse, sub: "- SEND MATERIAL" });
  }
  if (user.role === "admin" || user.role === "office") {
    tiles.push({ testID: "tile-entries", en: "ENTRIES", hi: "एंट्री सूची", href: "/entries", bg: colors.surface, fg: colors.onSurface, sub: "VIEW & EDIT" });
  }
  tiles.push({ testID: "tile-inventory", en: "INVENTORY", hi: "स्टॉक स्थिति", href: "/inventory", bg: colors.surfaceSecondary, fg: colors.onSurface, sub: "LIVE STOCK" });
  if (user.role === "admin") {
    tiles.push({ testID: "tile-users", en: "USERS", hi: "यूज़र", href: "/users", bg: colors.surfaceTertiary, fg: colors.onSurface, sub: "MANAGE ACCESS" });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={t("dashboard")} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }} testID="home-scroll">
        <Text style={s.greet}>HI, {user.name.toUpperCase()}</Text>
        <Text style={s.greetSub}>{t("select_action")}</Text>

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
  grid: { gap: spacing.md },
  tile: {
    minHeight: 110,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: "space-between",
  },
  tileHi: { fontSize: 28, fontWeight: "900", letterSpacing: 0.5 },
  tileEn: { fontSize: 20, fontWeight: "900", letterSpacing: 2, marginTop: 2 },
  tileSub: { fontSize: 11, fontWeight: "700", letterSpacing: 2, marginTop: spacing.sm, opacity: 0.8 },
  logout: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  logoutTxt: { color: colors.error, fontWeight: "900", letterSpacing: 2, fontSize: 14 },
});
