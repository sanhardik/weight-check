import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions, Platform } from "react-native";
import { Slot, router, usePathname, Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing, appFontFamily } from "@/src/theme";

type NavItem = { href: string; label: string; icon: string };

const NAV: NavItem[] = [
  { href: "/office", label: "Dashboard", icon: "▦" },
  { href: "/office/entries", label: "Entries", icon: "≣" },
  { href: "/office/opening-stock", label: "Opening Stock", icon: "⬆" },
  { href: "/office/parties", label: "Parties", icon: "⊕" },
  { href: "/office/inventory", label: "Inventory", icon: "□" },
  { href: "/office/verifications", label: "Verifications", icon: "✓" },
  { href: "/office/reports", label: "Reports", icon: "⇩" },
];

/**
 * Desktop-first shell for the Office portal. Shows a sidebar when the viewport
 * is wide, collapses to a top-bar on narrower screens. Labour users are redirected
 * away; office/admin may use this URL freely.
 */
export default function OfficeLayout() {
  const { user, logout, lang, setLang } = useAuthSafe();
  const { t: _t } = useI18n();
  const pathname = usePathname() || "";
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  // Allow /office/login without auth
  if (pathname === "/office/login") {
    return (
      <View style={s.root}>
        <Slot />
      </View>
    );
  }

  if (!user) return <Redirect href="/office/login" />;
  if (user.role === "labour") return <Redirect href="/home" />;

  const SideNav = () => (
    <View style={[s.side, wide ? s.sideWide : s.sideCompact]}>
      <View style={wide ? s.brandRow : s.brandRowCompact}>
        <Text style={s.brandMark}>HE</Text>
        {wide ? (
          <View>
            <Text style={s.brandName}>HEMANT</Text>
            <Text style={s.brandSub}>ENTERPRISE · OFFICE</Text>
          </View>
        ) : null}
      </View>
      <View style={wide ? { paddingVertical: spacing.md } : s.navRowCompact}>
        {NAV.map((n) => {
          const active = pathname === n.href || (n.href !== "/office" && pathname.startsWith(n.href));
          return (
            <Pressable
              key={n.href}
              testID={`office-nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
              onPress={() => router.push(n.href as any)}
              style={({ pressed }) => [
                wide ? s.navItem : s.navItemCompact,
                active && (wide ? s.navItemActive : s.navItemActiveCompact),
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[s.navIcon, active && s.navTxtActive]}>{n.icon}</Text>
              <Text style={[s.navTxt, active && s.navTxtActive]}>{n.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {wide ? (
        <View style={s.sideFooter}>
          <View style={s.userRow}>
            <Text style={s.userName}>{user.name}</Text>
            <Text style={s.userRole}>{String(user.role).toUpperCase()}</Text>
          </View>
          <Pressable onPress={() => setLang(lang === "en" ? "hi" : "en")} style={s.langBtn} testID="office-lang-toggle">
            <Text style={s.langTxt}>{lang === "en" ? "हिंदी" : "EN"}</Text>
          </Pressable>
          <Pressable onPress={() => { logout(); router.replace("/office/login"); }} style={s.logoutBtn} testID="office-logout">
            <Text style={s.logoutTxt}>LOG OUT</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => { logout(); router.replace("/office/login"); }} style={s.logoutBtnCompact} testID="office-logout">
          <Text style={s.logoutTxt}>{user.name.split(" ")[0]} · LOGOUT</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <View style={[s.app, wide ? s.appWide : s.appCompact]}>
        <SideNav />
        <ScrollView
          style={s.content}
          contentContainerStyle={s.contentInner}
          testID="office-scroll"
        >
          <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
            <Slot />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

// Safe wrapper — avoids crashing if auth hook isn't ready on first render
function useAuthSafe() {
  const auth = useAuth();
  const i18n = useI18n();
  return { ...auth, lang: i18n.lang, setLang: i18n.setLang };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary, ...(Platform.OS === "web" ? ({ minHeight: "100vh" } as any) : {}) },
  app: { flex: 1 },
  appWide: { flexDirection: "row" },
  appCompact: { flexDirection: "column" },

  side: { backgroundColor: colors.surface, borderColor: colors.border },
  sideWide: { width: 240, borderRightWidth: 1.5, paddingVertical: spacing.xl, justifyContent: "space-between" },
  sideCompact: { borderBottomWidth: 1.5, paddingBottom: 4 },

  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  brandRowCompact: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  brandMark: { fontSize: 22, fontWeight: "900", color: colors.onBrand, backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 4, letterSpacing: 1 },
  brandName: { fontSize: 18, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  brandSub: { fontSize: 10, fontWeight: "900", color: colors.muted, letterSpacing: 2 },

  navRowCompact: { flexDirection: "row", flexWrap: "wrap", gap: 4, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  navItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10, paddingHorizontal: spacing.lg, borderLeftWidth: 3, borderLeftColor: "transparent" },
  navItemActive: { borderLeftColor: colors.brand, backgroundColor: colors.brandTertiary },
  navItemCompact: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1.5, borderColor: "transparent" },
  navItemActiveCompact: { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
  navIcon: { fontSize: 15, fontWeight: "900", color: colors.muted },
  navTxt: { fontSize: 14, fontWeight: "700", color: colors.muted, letterSpacing: 0.3 },
  navTxtActive: { color: colors.brand, fontWeight: "900" },

  sideFooter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  userRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  userName: { fontSize: 13, fontWeight: "900", color: colors.onSurface },
  userRole: { fontSize: 10, fontWeight: "900", color: colors.muted, letterSpacing: 2, marginTop: 2 },
  langBtn: { borderWidth: 1.5, borderColor: colors.borderStrong, paddingVertical: 8, alignItems: "center" },
  langTxt: { fontSize: 12, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  logoutBtn: { borderWidth: 1.5, borderColor: colors.error, paddingVertical: 10, alignItems: "center" },
  logoutBtnCompact: { marginHorizontal: spacing.md, marginBottom: spacing.sm, borderWidth: 1.5, borderColor: colors.error, paddingVertical: 8, alignItems: "center" },
  logoutTxt: { color: colors.error, fontWeight: "900", fontSize: 12, letterSpacing: 1 },

  content: { flex: 1, backgroundColor: colors.surfaceSecondary },
  contentInner: { padding: spacing.xl, paddingBottom: spacing.xxxl, fontFamily: appFontFamily("en") as any },
});
