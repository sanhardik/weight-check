import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, TextInput } from "react-native";
import { router, Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { colors, spacing } from "@/src/theme";
import { toast } from "@/src/ui/Toast";

export default function OfficeLogin() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    if (user.role === "labour") return <Redirect href="/home" />;
    return <Redirect href="/office" />;
  }

  const submit = async () => {
    if (!email || !password) { toast("Email and password required", "error"); return; }
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      toast(e.message || "Login failed", "error");
    } finally {
      setBusy(false);
    }
  };

  // After successful login the Redirect at the top will push to /office automatically.

  const quick = (e: string, p: string) => { setEmail(e); setPassword(p); };

  return (
    <View style={s.root}>
      <View style={s.card} testID="office-login-card">
        <View style={s.hero}>
          <Text style={s.brandMark}>HE</Text>
          <View>
            <Text style={s.brandName}>HEMANT ENTERPRISE</Text>
            <Text style={s.brandSub}>OFFICE PORTAL · ऑफिस पोर्टल</Text>
          </View>
        </View>
        <Text style={s.heading}>Sign in</Text>
        <Text style={s.hint}>Office or admin accounts only. Labour users must use the mobile app.</Text>

        <Text style={s.label}>EMAIL</Text>
        <TextInput
          testID="office-login-email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="office@hemant.com"
          placeholderTextColor={colors.muted}
          style={s.input}
          onSubmitEditing={submit}
        />
        <Text style={s.label}>PASSWORD</Text>
        <TextInput
          testID="office-login-password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••"
          placeholderTextColor={colors.muted}
          style={s.input}
          onSubmitEditing={submit}
        />
        <Pressable testID="office-login-submit" onPress={submit} disabled={busy} style={[s.btn, busy && { opacity: 0.7 }]}>
          <Text style={s.btnTxt}>{busy ? "SIGNING IN..." : "SIGN IN"}</Text>
        </Pressable>

        <View style={s.demo}>
          <Text style={s.demoTitle}>DEMO ACCOUNTS</Text>
          <Pressable testID="office-quick-office" onPress={() => quick("office@steeltrack.com", "office123")} style={s.demoRow}>
            <Text style={s.demoRole}>OFFICE</Text>
            <Text style={s.demoEmail}>office@steeltrack.com</Text>
          </Pressable>
          <Pressable testID="office-quick-admin" onPress={() => quick("admin@steeltrack.com", "admin123")} style={s.demoRow}>
            <Text style={s.demoRole}>ADMIN</Text>
            <Text style={s.demoEmail}>admin@steeltrack.com</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, ...(Platform.OS === "web" ? ({ minHeight: "100vh" } as any) : {}) },
  card: { width: "100%", maxWidth: 420, padding: spacing.xl, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.borderStrong },
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  brandMark: { fontSize: 32, fontWeight: "900", color: colors.onBrand, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, letterSpacing: 1 },
  brandName: { fontSize: 20, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  brandSub: { fontSize: 11, fontWeight: "900", color: colors.muted, letterSpacing: 2 },

  heading: { fontSize: 24, fontWeight: "900", color: colors.onSurface, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.lg },
  label: { fontSize: 11, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1.5, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16, color: colors.onSurface, backgroundColor: colors.surface },
  btn: { marginTop: spacing.lg, paddingVertical: 14, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center" },
  btnTxt: { color: colors.onBrand, fontWeight: "900", fontSize: 14, letterSpacing: 2 },

  demo: { marginTop: spacing.xl, borderTopWidth: 1.5, borderTopColor: colors.border, paddingTop: spacing.md },
  demoTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: 6 },
  demoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, paddingHorizontal: spacing.sm, borderWidth: 1.5, borderColor: colors.border, marginBottom: spacing.xs },
  demoRole: { fontSize: 12, fontWeight: "900", color: colors.brand, letterSpacing: 1 },
  demoEmail: { fontSize: 12, color: colors.muted },
});
