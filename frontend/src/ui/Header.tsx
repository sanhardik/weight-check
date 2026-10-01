import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors, spacing } from "../theme";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";

type Props = {
  title: string;
  showBack?: boolean;
  right?: React.ReactNode;
};

export function Header({ title, showBack, right }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, setLang } = useI18n();
  const { user } = useAuth();

  return (
    <View style={[s.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <View style={s.row}>
        {showBack ? (
          <Pressable onPress={() => router.back()} testID="header-back" style={s.backBtn}>
            <Text style={s.backTxt}>{"<"} {t("back")}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}
        <Text numberOfLines={1} style={s.title}>{title}</Text>
        <View style={s.rightWrap}>
          {right}
          <Pressable
            testID="lang-toggle"
            onPress={() => setLang(lang === "en" ? "hi" : "en")}
            style={s.langBtn}
          >
            <Text style={s.langTxt}>{lang === "en" ? "हिंदी" : "EN"}</Text>
          </Pressable>
        </View>
      </View>
      {user ? (
        <Text style={s.sub} numberOfLines={1}>
          {user.name} · {user.role.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.borderStrong,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { color: colors.onSurfaceInverse, fontSize: 22, fontWeight: "900", letterSpacing: 1, flex: 1, textAlign: "center" },
  backBtn: { paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1.5, borderColor: colors.onSurfaceInverse },
  backTxt: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 12 },
  rightWrap: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  langBtn: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brand },
  langTxt: { color: colors.onBrand, fontWeight: "900", fontSize: 12, letterSpacing: 0.5 },
  sub: { color: colors.onSurfaceInverse, opacity: 0.7, fontSize: 11, marginTop: 4, textAlign: "center", fontWeight: "700", letterSpacing: 0.5 },
});
