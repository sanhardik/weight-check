import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { OpeningStockForm } from "@/src/screens/OpeningStockForm";

export default function OpeningStockScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useI18n();

  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin") return <Redirect href="/home" />;

  return (
    <View style={styles.root}>
      <Header title={t("opening_stock")} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <OpeningStockForm />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
});
