import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, TextInput, Linking } from "react-native";
import { useAuth, apiFetch } from "@/src/auth";
import { colors, spacing } from "@/src/theme";
import { toast } from "@/src/ui/Toast";

export default function OfficeReports() {
  const { token } = useAuth();
  const [partyName, setPartyName] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const exportCsv = async (direction?: "inward" | "outward") => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL;
      const url = `${base}/api/entries/export.csv${direction ? `?direction=${direction}` : ""}`;
      if (Platform.OS === "web") {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await r.blob();
        const dl = URL.createObjectURL(blob);
        (globalThis as any).window?.open?.(dl, "_blank");
      }
      toast("CSV ready", "success");
    } catch (e: any) { toast(e.message || "Export failed", "error"); }
  };

  const partyStatement = async () => {
    if (!partyName.trim()) { toast("Enter party name", "error"); return; }
    setBusy(true);
    try {
      const r = await apiFetch("/reports/party-statement", {
        method: "POST",
        body: JSON.stringify({ party_name: partyName.trim(), days: parseInt(days) || 30 }),
      }, token);
      setLastUrl(r.download_url);
      if (r.email_error) toast(`PDF ready — email failed (${r.email_error})`, "warning");
      else toast(`✉ Emailed`, "success");
      if (r.download_url) {
        if (Platform.OS === "web") (globalThis as any).window?.open?.(r.download_url, "_blank");
        else Linking.openURL(r.download_url);
      }
    } catch (e: any) { toast(e.message || "Report failed", "error"); }
    finally { setBusy(false); }
  };

  return (
    <View>
      <Text style={s.pageTitle}>Reports · रिपोर्ट</Text>
      <Text style={s.pageSub}>CSV exports and party-statement PDFs</Text>

      <View style={s.twoCol}>
        <View style={s.card}>
          <Text style={s.cardTitle}>CSV export</Text>
          <Text style={s.hint}>Downloads every entry (with office details) as CSV.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Pressable onPress={() => exportCsv()} style={s.primary} testID="export-all"><Text style={s.primaryTxt}>⇩ ALL ENTRIES</Text></Pressable>
            <Pressable onPress={() => exportCsv("inward")} style={s.secondary} testID="export-in"><Text style={s.secondaryTxt}>⇩ INWARD</Text></Pressable>
            <Pressable onPress={() => exportCsv("outward")} style={s.secondary} testID="export-out"><Text style={s.secondaryTxt}>⇩ OUTWARD</Text></Pressable>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Party statement PDF</Text>
          <Text style={s.hint}>Generates a PDF and emails you a signed download link.</Text>
          <Text style={s.lbl}>PARTY NAME</Text>
          <TextInput testID="report-party" value={partyName} onChangeText={setPartyName} placeholder="e.g. Shree Steel Co." placeholderTextColor={colors.muted} style={s.input} />
          <Text style={s.lbl}>LAST N DAYS</Text>
          <TextInput testID="report-days" value={days} onChangeText={setDays} keyboardType="number-pad" style={s.input} />
          <Pressable onPress={partyStatement} disabled={busy} style={[s.primary, { marginTop: 10 }, busy && { opacity: 0.7 }]} testID="report-generate">
            <Text style={s.primaryTxt}>{busy ? "GENERATING..." : "GENERATE & EMAIL PDF"}</Text>
          </Pressable>
          {lastUrl ? <Pressable onPress={() => Platform.OS === "web" ? (globalThis as any).window?.open?.(lastUrl, "_blank") : Linking.openURL(lastUrl)} style={{ marginTop: 8 }}><Text style={{ color: colors.brand, fontWeight: "900", fontSize: 12 }}>↗ Open last PDF</Text></Pressable> : null}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  pageSub: { fontSize: 14, color: colors.muted, marginBottom: spacing.lg },
  twoCol: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  card: { flex: 1, minWidth: 360, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 18, fontWeight: "900", color: colors.onSurface, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  lbl: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1.5, borderColor: colors.border, padding: 10, color: colors.onSurface, backgroundColor: colors.surface, fontSize: 14 },
  primary: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center" },
  primaryTxt: { color: colors.onBrand, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  secondary: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center" },
  secondaryTxt: { color: colors.onSurface, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
});
