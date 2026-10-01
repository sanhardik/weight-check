import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { getMukadam, setMukadam } from "@/src/mukadam";
import { toast } from "@/src/ui/Toast";

export default function MukadamPicker() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [options, setOptions] = useState<string[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    getMukadam().then(setCurrent);
    if (!token) return;
    apiFetch("/mukadams", {}, token)
      .then((d) => setOptions((d || []).map((m: any) => m.name)))
      .catch(() => setOptions([]));
  }, [token]);

  if (!user) return <Redirect href="/login" />;

  const pick = async (name: string) => {
    await setMukadam(name);
    setCurrent(name);
    toast(`${t("mukadam_set")}: ${name}`, "success");
    setTimeout(() => router.back(), 500);
  };

  const clear = async () => {
    await setMukadam(null);
    setCurrent(null);
    toast("Cleared", "info");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={t("mukadam")} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}>
        <Text style={s.heading}>मुकादम · {t("mukadam")}</Text>
        <Text style={s.sub}>{t("select_mukadam")}</Text>

        {current ? (
          <View style={s.currentBox}>
            <Text style={s.currentLbl}>CURRENT · वर्तमान</Text>
            <Text style={s.currentName}>{current}</Text>
          </View>
        ) : (
          <View style={s.noneBox}>
            <Text style={s.noneTxt}>{t("no_mukadam")}</Text>
          </View>
        )}

        {!options ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {options.map((o) => (
              <Pressable
                key={o}
                testID={`pick-mukadam-${o}`}
                onPress={() => pick(o)}
                style={({ pressed }) => [s.option, current === o && s.optionActive, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[s.optionTxt, current === o && { color: colors.onBrand }]}>{o}</Text>
                {current === o ? <Text style={[s.check, { color: colors.onBrand }]}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        )}

        {current ? (
          <Pressable testID="clear-mukadam-btn" onPress={clear} style={s.clearBtn}>
            <Text style={s.clearTxt}>CLEAR SELECTION</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: "800", color: colors.onSurface, letterSpacing: 0.5 },
  sub: { fontSize: 13, color: colors.muted, marginBottom: spacing.md, letterSpacing: 0.5 },
  currentBox: { padding: spacing.md, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  currentLbl: { fontSize: 10, color: colors.onBrand, fontWeight: "800", letterSpacing: 2 },
  currentName: { fontSize: 22, color: colors.onBrand, fontWeight: "800", marginTop: 4 },
  noneBox: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  noneTxt: { fontSize: 13, color: colors.muted, fontWeight: "700", letterSpacing: 1 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  optionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  optionTxt: { fontSize: 18, color: colors.onSurface, fontWeight: "700" },
  check: { fontSize: 20, fontWeight: "800" },
  clearBtn: { marginTop: spacing.lg, paddingVertical: 12, borderWidth: 1.5, borderColor: colors.error, alignItems: "center", backgroundColor: colors.surface },
  clearTxt: { color: colors.error, fontWeight: "800", letterSpacing: 1 },
});
