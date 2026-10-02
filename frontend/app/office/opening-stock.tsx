import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useI18n } from "@/src/i18n";
import { colors } from "@/src/theme";
import { OpeningStockForm } from "@/src/screens/OpeningStockForm";

export default function OfficeOpeningStock() {
  const { t } = useI18n();
  return (
    <View>
      <Text style={s.pageTitle}>Opening Stock · आरंभिक स्टॉक</Text>
      <Text style={s.pageSub}>Bulk-load your starting inventory — one auditable entry, every item traceable</Text>
      <View style={s.card}>
        <OpeningStockForm onDone={() => router.push("/office/inventory")} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  pageSub: { fontSize: 14, color: colors.muted, marginBottom: 20 },
  card: { maxWidth: 1000 },
});
