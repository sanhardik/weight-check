import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, Pressable, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, apiFetch, fileUrl } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { BButton } from "@/src/ui/BButton";
import { Dropdown } from "@/src/ui/Dropdown";
import { toast } from "@/src/ui/Toast";

type InvGroup = {
  thickness_mm: number; width_mm: number; length_mm: number; grade: string | null;
  pieces_available: number; last_verified_at: string | null; last_verified_by: string | null;
};

export default function Verifications() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();

  const [today, setToday] = useState<any>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [pendingReview, setPendingReview] = useState(0);
  const [inv, setInv] = useState<InvGroup[]>([]);
  const [pick1, setPick1] = useState<string | null>(null);
  const [pick2, setPick2] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [t_, h, i] = await Promise.all([
        apiFetch("/verifications/today", {}, token),
        apiFetch("/verifications/history?limit=50", {}, token),
        apiFetch("/inventory", {}, token),
      ]);
      setToday(t_);
      setHistory(h.items || []);
      setPendingReview(h.pending_review || 0);
      setInv(i || []);
    } catch (e: any) {
      toast(e.message || "Load failed", "error");
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!user) return <Redirect href="/login" />;
  if (user.role === "labour") return <Redirect href="/verify" />;

  const groupLabel = (g: InvGroup) =>
    `${g.thickness_mm}×${g.width_mm}×${g.length_mm}${g.grade ? ` · ${g.grade}` : ""} (${g.pieces_available} pcs)`;
  const options = inv.map(groupLabel);
  const groupFor = (label: string | null) => inv.find((g) => groupLabel(g) === label) || null;

  const assign = async () => {
    const groups = [groupFor(pick1), groupFor(pick2)].filter(Boolean).map((g: any) => ({
      thickness_mm: g.thickness_mm, width_mm: g.width_mm, length_mm: g.length_mm, grade: g.grade,
    }));
    if (groups.length === 0) { toast("Pick at least one item", "error"); return; }
    setAssigning(true);
    try {
      await apiFetch("/verifications/assign", { method: "POST", body: JSON.stringify({ groups }) }, token);
      toast("Today's tally items assigned", "success");
      setPick1(null); setPick2(null);
      await load();
    } catch (e: any) {
      toast(e.message || "Assign failed", "error");
    } finally { setAssigning(false); }
  };

  const review = async (id: string, action: "approve" | "reject" | "apply_correction") => {
    setReviewing(id + action);
    try {
      const v = await apiFetch(`/verifications/${id}/review`, { method: "POST", body: JSON.stringify({ action }) }, token);
      if (action === "apply_correction" && v.correction_entry_number) {
        toast(`Stock corrected via ${v.correction_entry_number}`, "success");
      } else {
        toast(action === "approve" ? "Approved" : "Rejected", "success");
      }
      await load();
    } catch (e: any) {
      toast(e.message || "Review failed", "error");
    } finally { setReviewing(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={t("verification_log")} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
        {pendingReview > 0 ? (
          <View style={s.pendingPill} testID="pending-review-pill">
            <Text style={s.pendingTxt}>⚠ {pendingReview} MISMATCHED TALLY AWAITING REVIEW</Text>
          </View>
        ) : null}

        {/* Today */}
        <Text style={s.secTitle}>TODAY · {today?.date || "—"} ({today?.done || 0}/{today?.total || 0})</Text>
        {(today?.tasks || []).map((task: any, i: number) => (
          <View key={task.id} style={s.todayRow} testID={`today-task-${i}`}>
            <Text style={s.todayLabel}>{task.group_label}</Text>
            <Text style={[s.todayStatus, { color: task.status === "pending" ? colors.warning : colors.success }]}>
              {task.status === "pending" ? "⏳ PENDING" : "✓ DONE"}
            </Text>
          </View>
        ))}

        {/* Admin assign */}
        {isAdmin ? (
          <View style={s.assignBlock} testID="assign-block">
            <Text style={s.secTitle}>ASSIGN TODAY&apos;S ITEMS · आज की गिनती सेट करें</Text>
            <Text style={s.assignHint}>Overrides today&apos;s pending auto-picks (max 2).</Text>
            <Dropdown testID="assign-pick-1" label="ITEM 1" value={pick1} options={options} onChange={setPick1} placeholder="SELECT FROM STOCK" />
            <Dropdown testID="assign-pick-2" label="ITEM 2" value={pick2} options={options} onChange={setPick2} placeholder="SELECT FROM STOCK" />
            <BButton testID="assign-submit" label={assigning ? t("saving") : "ASSIGN FOR TODAY"} onPress={assign} loading={assigning} size="md" />
          </View>
        ) : null}

        {/* History */}
        <Text style={s.secTitle}>HISTORY · जाँच रिकॉर्ड</Text>
        {!history ? (
          <ActivityIndicator color={colors.brand} />
        ) : history.length === 0 ? (
          <Text style={s.empty}>No verifications yet</Text>
        ) : (
          history.map((v: any, i: number) => (
            <View key={v.id} style={[s.hCard, !v.matched && { borderColor: colors.warning, borderLeftWidth: 6, borderLeftColor: colors.warning }]} testID={`history-card-${i}`}>
              <View style={s.hTop}>
                <Text style={s.hLabel}>{v.group_label}</Text>
                <Text style={s.hDate}>{new Date(v.created_at).toLocaleDateString()}</Text>
              </View>
              <View style={s.hRow}>
                <Text style={s.hMeta}>System: {v.system_pieces} pcs</Text>
                <Text style={[s.hMeta, { fontWeight: "900", color: v.matched ? colors.success : colors.error }]}>
                  Physical: {v.physical_pieces} pcs {v.matched ? "✓" : `(${v.discrepancy_pieces > 0 ? "+" : ""}${v.discrepancy_pieces})`}
                </Text>
              </View>
              <View style={s.hRow}>
                <Text style={s.hMeta}>By: {v.verified_by_name || "—"}</Text>
                <Text style={[s.statusChip, {
                  backgroundColor: v.status === "submitted" ? colors.warning : v.status === "approved" ? colors.success : v.status === "correction_applied" ? colors.brand : colors.error,
                  color: colors.onBrand,
                }]}>{String(v.status).toUpperCase().replace("_", " ")}</Text>
              </View>
              {v.correction_entry_number ? <Text style={s.hMeta}>↳ Correction entry: {v.correction_entry_number}</Text> : null}
              {v.note ? <Text style={s.hMeta}>📝 {v.note}</Text> : null}
              {v.photo_path ? (
                <Image source={{ uri: fileUrl(v.photo_path, token) }} style={s.hPhoto} resizeMode="cover" />
              ) : null}
              {isAdmin && v.status === "submitted" ? (
                <View style={s.reviewRow}>
                  {!v.matched ? (
                    <Pressable testID={`review-correct-${i}`} onPress={() => review(v.id, "apply_correction")} style={[s.reviewBtn, { backgroundColor: colors.brand }]} disabled={!!reviewing}>
                      <Text style={s.reviewBtnTxt}>{reviewing === v.id + "apply_correction" ? "..." : "APPLY STOCK CORRECTION"}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable testID={`review-approve-${i}`} onPress={() => review(v.id, "approve")} style={[s.reviewBtn, { backgroundColor: colors.success }]} disabled={!!reviewing}>
                    <Text style={s.reviewBtnTxt}>APPROVE</Text>
                  </Pressable>
                  <Pressable testID={`review-reject-${i}`} onPress={() => review(v.id, "reject")} style={[s.reviewBtn, { backgroundColor: colors.error }]} disabled={!!reviewing}>
                    <Text style={s.reviewBtnTxt}>REJECT</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  pendingPill: { padding: spacing.md, backgroundColor: colors.warning, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  pendingTxt: { color: colors.onWarning, fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  secTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginTop: spacing.md, marginBottom: spacing.sm },
  todayRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginBottom: spacing.sm },
  todayLabel: { fontSize: 15, fontWeight: "900", color: colors.onSurface, flexShrink: 1 },
  todayStatus: { fontSize: 12, fontWeight: "900", letterSpacing: 1, marginLeft: spacing.sm },
  assignBlock: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandTertiary, marginBottom: spacing.md },
  assignHint: { fontSize: 11, color: colors.muted, marginBottom: spacing.sm, fontStyle: "italic" },
  empty: { textAlign: "center", padding: spacing.xl, color: colors.muted, fontWeight: "700" },
  hCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginBottom: spacing.md },
  hTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  hLabel: { fontSize: 15, fontWeight: "900", color: colors.onSurface, flexShrink: 1 },
  hDate: { fontSize: 11, color: colors.muted, fontWeight: "700" },
  hRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  hMeta: { fontSize: 12, color: colors.muted, fontWeight: "700", marginTop: 2 },
  statusChip: { fontSize: 10, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 4 },
  hPhoto: { width: "100%", aspectRatio: 2, marginTop: spacing.sm, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  reviewRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  reviewBtn: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1.5, borderColor: colors.borderStrong },
  reviewBtnTxt: { color: "#FFFFFF", fontWeight: "900", fontSize: 11, letterSpacing: 1 },
});
