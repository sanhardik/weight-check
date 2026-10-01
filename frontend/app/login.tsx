import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from "react-native";
import { router, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { BInput } from "@/src/ui/BInput";
import { BButton } from "@/src/ui/BButton";
import { toast } from "@/src/ui/Toast";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { user, login } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Redirect href="/home" />;

  const quickLogin = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
  };

  const onSubmit = async () => {
    if (!email || !password) {
      toast(t("invalid_credentials"), "error");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace("/home");
    } catch (e: any) {
      toast(e.message || t("invalid_credentials"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandLine} />
            <Text style={styles.brandTitle}>HEMANT</Text>
            <Text style={styles.brandTitleAccent}>ENTERPRISE</Text>
          </View>
          <Pressable
            testID="lang-toggle"
            onPress={() => setLang(lang === "en" ? "hi" : "en")}
            style={styles.langBtn}
          >
            <Text style={styles.langTxt}>{lang === "en" ? "हिंदी" : "EN"}</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>{t("login")}</Text>

        <View style={styles.form}>
          <BInput
            testID="email-input"
            label={t("email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@steeltrack.com"
          />
          <BInput
            testID="password-input"
            label={t("password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••"
          />
          <View style={{ marginTop: spacing.md }}>
            <BButton
              testID="login-submit-button"
              label={t("sign_in")}
              onPress={onSubmit}
              loading={loading}
              size="lg"
            />
          </View>
        </View>

        <View style={styles.quickBox}>
          <Text style={styles.quickHdr}>DEMO ACCOUNTS</Text>
          <Pressable testID="quick-admin" style={styles.quickBtn} onPress={() => quickLogin("admin@steeltrack.com", "admin123")}>
            <Text style={styles.quickRole}>ADMIN</Text>
            <Text style={styles.quickEmail}>admin@steeltrack.com</Text>
          </Pressable>
          <Pressable testID="quick-office" style={styles.quickBtn} onPress={() => quickLogin("office@steeltrack.com", "office123")}>
            <Text style={styles.quickRole}>OFFICE</Text>
            <Text style={styles.quickEmail}>office@steeltrack.com</Text>
          </Pressable>
          <Pressable testID="quick-labour" style={styles.quickBtn} onPress={() => quickLogin("labour@steeltrack.com", "labour123")}>
            <Text style={styles.quickRole}>LABOUR / वेयरहाउस</Text>
            <Text style={styles.quickEmail}>labour@steeltrack.com</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, flexGrow: 1, backgroundColor: colors.surface },
  topRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  brandBlock: { marginTop: spacing.lg },
  brandLine: { width: 80, height: 6, backgroundColor: colors.brand, marginBottom: spacing.sm },
  brandTitle: { fontSize: 42, fontWeight: "800", color: colors.onSurface, letterSpacing: -1 },
  brandTitleAccent: { fontSize: 32, fontWeight: "800", color: colors.brand, letterSpacing: 0, marginTop: -4 },
  langBtn: { marginTop: spacing.lg, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceInverse },
  langTxt: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 14 },
  subtitle: { marginTop: spacing.xl, fontSize: 14, fontWeight: "900", letterSpacing: 2, color: colors.muted },
  form: { marginTop: spacing.lg },
  quickBox: { marginTop: spacing.xl, borderWidth: 1.5, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surfaceSecondary },
  quickHdr: { fontSize: 11, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: spacing.sm },
  quickBtn: { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginBottom: spacing.sm },
  quickRole: { fontSize: 14, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  quickEmail: { fontSize: 11, color: colors.muted, marginTop: 2 },
});
