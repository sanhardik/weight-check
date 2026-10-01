import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator, Platform, Linking } from "react-native";
import { colors, spacing } from "@/src/theme";
import { useAuth, apiFetch } from "@/src/auth";
import { toast } from "@/src/ui/Toast";
import { BButton } from "@/src/ui/BButton";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function ReportEmailModal({ visible, onClose }: Props) {
  const { user, token } = useAuth();
  const [parties, setParties] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ email: string; download_url: string; entries_count: number } | null>(null);

  useEffect(() => {
    if (!visible || !token) return;
    setResult(null);
    setPicked(null);
    apiFetch("/parties", {}, token).then(setParties).catch(() => setParties([]));
  }, [visible, token]);

  const send = async () => {
    if (!picked) return;
    setSending(true);
    try {
      const res = await apiFetch("/reports/party-statement", {
        method: "POST",
        body: JSON.stringify({ party_name: picked }),
      }, token);
      setResult({ email: res.sent_to, download_url: res.download_url, entries_count: res.entries_count });
      toast(`✉ Sent to ${res.sent_to}`, "success");
    } catch (e: any) {
      toast(e.message || "Report failed", "error");
    } finally {
      setSending(false);
    }
  };

  const openPdf = async () => {
    if (!result?.download_url) return;
    if (Platform.OS === "web") {
      const win = (globalThis as any).window;
      if (win?.open) win.open(result.download_url, "_blank");
      else await Linking.openURL(result.download_url);
    } else {
      await Linking.openURL(result.download_url);
    }
  };

  const shareWhatsApp = async () => {
    if (!result?.download_url || !picked) return;
    const msg =
      `Hi,\n\nHere is the SteelTrack statement for *${picked}* (${result.entries_count} entries).\n\n` +
      `Download PDF: ${result.download_url}\n\n` +
      `Link opens for 24 hours. — Sent via SteelTrack.`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    try {
      if (Platform.OS === "web") {
        const win = (globalThis as any).window;
        if (win?.open) win.open(url, "_blank");
        else await Linking.openURL(url);
      } else {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          toast("WhatsApp not installed", "error");
          return;
        }
        await Linking.openURL(url);
      }
      toast("Opening WhatsApp...", "success");
    } catch (e: any) {
      toast(e.message || "Could not open WhatsApp", "error");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet} testID="report-modal">
          <View style={s.hdr}>
            <Text style={s.title}>📧 EMAIL MONTHLY REPORT</Text>
            <Pressable testID="report-close" onPress={onClose} style={s.closeBtn}>
              <Text style={s.closeTxt}>✕</Text>
            </Pressable>
          </View>

          {result ? (
            <View style={{ paddingVertical: spacing.sm }}>
              <View style={s.successBox}>
                <Text style={s.successTitle}>✓ EMAIL SENT</Text>
                <Text style={s.successDetail}>Delivered to {result.email}</Text>
                <Text style={s.successDetail}>{result.entries_count} entries · PDF attached</Text>
              </View>
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <BButton testID="whatsapp-share-btn" label="SHARE ON WHATSAPP" onPress={shareWhatsApp} size="lg" variant="primary" />
                <BButton testID="open-pdf-btn" label="OPEN PDF" onPress={openPdf} variant="secondary" />
                <BButton label="DONE" variant="ghost" onPress={onClose} />
              </View>
            </View>
          ) : (
            <>
              <Text style={s.hint}>Choose a party. The current-month statement PDF is emailed to <Text style={s.email}>{user?.email}</Text>.</Text>
              {!parties ? (
                <ActivityIndicator color={colors.brand} />
              ) : parties.length === 0 ? (
                <Text style={s.empty}>No parties on file yet. Add a party name to any entry's Office Details first.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: spacing.xs }}>
                  {parties.map((p) => (
                    <Pressable
                      key={p}
                      testID={`party-pick-${p}`}
                      onPress={() => setPicked(p)}
                      style={[s.partyRow, picked === p && s.partyRowActive]}
                    >
                      <Text style={[s.partyName, picked === p && { color: colors.onBrand }]} numberOfLines={1}>{p}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              <View style={{ marginTop: spacing.md }}>
                <BButton
                  testID="send-report-btn"
                  label={sending ? "SENDING..." : "SEND EMAIL"}
                  onPress={send}
                  loading={sending}
                  disabled={!picked}
                  size="lg"
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 1.5, borderColor: colors.borderStrong, padding: spacing.lg, paddingBottom: spacing.xxl },
  hdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { fontSize: 16, fontWeight: "900", letterSpacing: 1, color: colors.onSurface, flex: 1 },
  closeBtn: { width: 32, height: 32, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  closeTxt: { fontSize: 16, fontWeight: "900", color: colors.onSurface },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.md, lineHeight: 18 },
  email: { color: colors.brand, fontWeight: "900", fontFamily: "Courier" },
  empty: { fontSize: 12, color: colors.muted, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1.5, borderColor: colors.borderStrong, textAlign: "center" },
  partyRow: { paddingVertical: 12, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  partyRowActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  partyName: { fontSize: 14, fontWeight: "900", color: colors.onSurface, letterSpacing: 0.5 },
  successBox: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.success, backgroundColor: colors.success },
  successTitle: { color: colors.onSuccess, fontWeight: "900", fontSize: 14, letterSpacing: 2 },
  successDetail: { color: colors.onSuccess, fontSize: 12, fontWeight: "700", marginTop: 4, fontFamily: "Courier" },
});
