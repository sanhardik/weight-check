import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { BInput } from "@/src/ui/BInput";
import { BButton } from "@/src/ui/BButton";
import { toast } from "@/src/ui/Toast";

type U = { id: string; email: string; name: string; role: string };

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [users, setUsers] = useState<U[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "office" | "labour">("labour");
  const [adding, setAdding] = useState(false);

  const load = () => apiFetch("/users", {}, token).then(setUsers);
  useEffect(() => { if (token) load().catch(() => setUsers([])); }, [token]);

  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin") return <Redirect href="/home" />;

  const create = async () => {
    if (!name || !email || !password) { toast("Fill all fields", "error"); return; }
    setAdding(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role }),
      }, token);
      toast(`User created: ${email}`, "success");
      setName(""); setEmail(""); setPassword("");
      load();
    } catch (e: any) { toast(e.message, "error"); } finally { setAdding(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Header title={t("users")} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>{t("add_user")}</Text>
        <BInput testID="user-name" label={t("name")} value={name} onChangeText={setName} />
        <BInput testID="user-email" label={t("email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <BInput testID="user-password" label={t("password")} value={password} onChangeText={setPassword} secureTextEntry />
        <Text style={s.lbl}>{t("role")}</Text>
        <View style={s.roleRow}>
          {(["admin", "office", "labour"] as const).map((r) => (
            <Pressable
              key={r}
              testID={`role-${r}`}
              onPress={() => setRole(r)}
              style={[s.rolePill, role === r && s.rolePillActive]}
            >
              <Text style={[s.roleTxt, role === r && s.roleTxtActive]}>{r.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: spacing.md }}>
          <BButton testID="create-user-btn" label={adding ? t("saving") : t("create")} onPress={create} loading={adding} size="lg" />
        </View>

        <Text style={s.section}>{t("users")}</Text>
        {!users ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          users.map((u) => (
            <View key={u.id} style={s.userRow} testID={`user-${u.email}`}>
              <View style={{ flex: 1 }}>
                <Text style={s.userName}>{u.name}</Text>
                <Text style={s.userEmail}>{u.email}</Text>
              </View>
              <Text style={[s.roleBadge, u.role === "admin" && { backgroundColor: colors.brand, color: colors.onBrand }, u.role === "office" && { backgroundColor: colors.surfaceInverse, color: colors.onSurfaceInverse }]}>
                {u.role.toUpperCase()}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 14, fontWeight: "900", letterSpacing: 2, color: colors.onSurface, marginBottom: spacing.sm, marginTop: spacing.lg },
  lbl: { fontSize: 12, fontWeight: "900", letterSpacing: 1, color: colors.onSurface, marginBottom: 6 },
  roleRow: { flexDirection: "row", gap: spacing.sm },
  rolePill: { flex: 1, paddingVertical: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", backgroundColor: colors.surface },
  rolePillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  roleTxt: { fontSize: 12, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  roleTxtActive: { color: colors.onBrand },
  userRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.sm, backgroundColor: colors.surface },
  userName: { fontSize: 16, fontWeight: "900", color: colors.onSurface },
  userEmail: { fontSize: 11, color: colors.muted, marginTop: 2 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: "900", letterSpacing: 1, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, color: colors.onSurface },
});
