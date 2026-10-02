import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator } from "react-native";
import { useAuth, apiFetch, fileUrl } from "@/src/auth";
import { colors, spacing } from "@/src/theme";
import { toast } from "@/src/ui/Toast";

export default function OfficeVerifications() {
  const { user, token } = useAuth();
  const [today, setToday] = useState<any>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [t_, h] = await Promise.all([
        apiFetch("/verifications/today", {}, token),
        apiFetch("/verifications/history?limit=100", {}, token),
      ]);
      setToday(t_); setHistory(h.items || []); setPending(h.pending_review || 0);
    } catch (e: any) { toast(e.message || "Load failed", "error"); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const isAdmin = user?.role === "admin";
  const review = async (id: string, action: "approve" | "reject" | "apply_correction") => {
    setBusy(id + action);
    try {
      const v = await apiFetch(`/verifications/${id}/review`, { method: "POST", body: JSON.stringify({ action }) }, token);
      toast(action === "apply_correction" && v.correction_entry_number ? `Stock corrected via ${v.correction_entry_number}` : action.replace("_", " "), "success");
      await load();
    } catch (e: any) { toast(e.message || "Review failed", "error"); }
    finally { setBusy(null); }
  };

  if (!today || !history) return <View style={{ padding: spacing.xxxl, alignItems: "center" }}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <View>
      <Text style={s.pageTitle}>Verifications · जाँच</Text>
      <Text style={s.pageSub}>Daily physical tally — review mismatches, apply stock corrections</Text>

      {pending > 0 ? (
        <View style={s.pendingBar}><Text style={s.pendingTxt}>⚠ {pending} MISMATCHED TALLY AWAITING REVIEW</Text></View>
      ) : null}

      <View style={s.twoCol}>
        <View style={s.col}>
          <Text style={s.sectionTitle}>Today · {today.date} — {today.done}/{today.total}</Text>
          {(today.tasks || []).map((task: any, i: number) => (
            <View key={task.id} style={s.todayRow} testID={`off-today-${i}`}>
              <View style={{ flex: 1 }}>
                <Text style={s.todayLbl}>{task.group_label}</Text>
                <Text style={s.todaySub}>System: {task.system_pieces} pcs · {String(task.assigned_by).toUpperCase()}</Text>
              </View>
              <Text style={[s.statusChip, task.status === "pending" ? { backgroundColor: colors.warning, color: colors.onWarning } : { backgroundColor: colors.success, color: colors.onSuccess }]}>
                {task.status === "pending" ? "⏳ PENDING" : "✓ DONE"}
              </Text>
            </View>
          ))}
        </View>

        <View style={s.col}>
          <Text style={s.sectionTitle}>Recent verifications</Text>
          {history.length === 0 ? <Text style={s.empty}>No verifications yet</Text> : null}
          {history.slice(0, 30).map((v: any, i: number) => (
            <View key={v.id} style={[s.hCard, !v.matched && { borderLeftColor: colors.warning }]} testID={`off-history-${i}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.hLbl}>{v.group_label}</Text>
                  <Text style={s.hMeta}>By {v.verified_by_name || "—"} · {new Date(v.created_at).toLocaleString()}</Text>
                </View>
                <Text style={[s.statusChip, {
                  backgroundColor: v.status === "submitted" ? colors.warning : v.status === "approved" ? colors.success : v.status === "correction_applied" ? colors.brand : colors.error,
                  color: colors.onBrand,
                }]}>{String(v.status).toUpperCase().replace("_", " ")}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: 4 }}>
                <Text style={s.hMeta}>System: <Text style={{ fontWeight: "900", color: colors.onSurface }}>{v.system_pieces}</Text></Text>
                <Text style={s.hMeta}>Physical: <Text style={{ fontWeight: "900", color: v.matched ? colors.success : colors.error }}>{v.physical_pieces}</Text></Text>
                {!v.matched ? <Text style={s.hMeta}>Diff: <Text style={{ fontWeight: "900", color: colors.error }}>{v.discrepancy_pieces > 0 ? "+" : ""}{v.discrepancy_pieces}</Text></Text> : null}
              </View>
              {v.correction_entry_number ? <Text style={s.hMeta}>↳ {v.correction_entry_number}</Text> : null}
              {v.note ? <Text style={s.hMeta}>📝 {v.note}</Text> : null}
              {v.photo_path ? <Image source={{ uri: fileUrl(v.photo_path, token) }} style={s.hPhoto} resizeMode="cover" /> : null}
              {isAdmin && v.status === "submitted" ? (
                <View style={s.reviewRow}>
                  {!v.matched ? (
                    <Pressable testID={`off-correct-${i}`} onPress={() => review(v.id, "apply_correction")} disabled={!!busy} style={[s.reviewBtn, { backgroundColor: colors.brand }]}>
                      <Text style={s.reviewBtnTxt}>APPLY STOCK CORRECTION</Text>
                    </Pressable>
                  ) : null}
                  <Pressable testID={`off-approve-${i}`} onPress={() => review(v.id, "approve")} disabled={!!busy} style={[s.reviewBtn, { backgroundColor: colors.success }]}>
                    <Text style={s.reviewBtnTxt}>APPROVE</Text>
                  </Pressable>
                  <Pressable testID={`off-reject-${i}`} onPress={() => review(v.id, "reject")} disabled={!!busy} style={[s.reviewBtn, { backgroundColor: colors.error }]}>
                    <Text style={s.reviewBtnTxt}>REJECT</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pageTitle: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  pageSub: { fontSize: 14, color: colors.muted, marginBottom: spacing.lg },
  pendingBar: { padding: spacing.md, backgroundColor: colors.warning, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  pendingTxt: { color: colors.onWarning, fontWeight: "900", letterSpacing: 1 },
  twoCol: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  col: { flex: 1, minWidth: 340, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: spacing.sm },
  todayRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  todayLbl: { fontSize: 14, fontWeight: "900", color: colors.onSurface },
  todaySub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  statusChip: { fontSize: 10, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 4 },
  empty: { fontSize: 12, color: colors.muted, fontStyle: "italic" },
  hCard: { padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.brand, marginBottom: spacing.sm },
  hLbl: { fontSize: 13, fontWeight: "900", color: colors.onSurface },
  hMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  hPhoto: { width: "100%", aspectRatio: 2.2, marginTop: 6, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  reviewRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  reviewBtn: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.borderStrong },
  reviewBtnTxt: { color: "#FFFFFF", fontWeight: "900", fontSize: 10, letterSpacing: 1 },
});
