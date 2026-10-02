import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Image, Platform, Pressable, ActivityIndicator,
} from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useAuth, apiFetch, fileUrl, uploadImageAsset } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { BInput } from "@/src/ui/BInput";
import { BButton } from "@/src/ui/BButton";
import { toast } from "@/src/ui/Toast";

type Task = {
  id: string;
  group_label: string;
  system_pieces: number | null;
  assigned_by: string;
  status: string;
  verification: any;
};

export default function Verify() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photoUri, setPhotoUri] = useState<Record<string, string>>({});
  const [photoPath, setPhotoPath] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await apiFetch("/verifications/today", {}, token);
      setTasks(d.tasks || []);
      setDone(d.done || 0);
      setTotal(d.total || 0);
    } catch (e: any) {
      toast(e.message || "Load failed", "error");
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!user) return <Redirect href="/login" />;

  const pickPhoto = async (taskId: string, fromCamera: boolean) => {
    try {
      let res;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { toast("Camera permission denied", "error"); return; }
        res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { toast("Gallery permission denied", "error"); return; }
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      }
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setPhotoUri((p) => ({ ...p, [taskId]: asset.uri }));
      setBusy((b) => ({ ...b, [taskId]: true }));
      const up = await uploadImageAsset(asset, token);
      setPhotoPath((p) => ({ ...p, [taskId]: up.path }));
      toast("Photo uploaded", "success");
    } catch (e: any) {
      toast(e.message || "Upload failed", "error");
      setPhotoUri((p) => ({ ...p, [taskId]: "" }));
    } finally {
      setBusy((b) => ({ ...b, [taskId]: false }));
    }
  };

  const submit = async (task: Task) => {
    const p = (pieces[task.id] || "").trim();
    if (!p) { toast(t("physical_pieces") + " — required", "error"); return; }
    if (!photoPath[task.id]) { toast("Photo proof required · फोटो ज़रूरी है", "error"); return; }
    setBusy((b) => ({ ...b, [task.id]: true }));
    try {
      const v = await apiFetch(`/verifications/${task.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          physical_pieces: parseFloat(p),
          photo_path: photoPath[task.id],
          note: notes[task.id] || null,
        }),
      }, token);
      if (v.matched) toast("✓ Count matches system stock", "success");
      else toast(`⚠ Mismatch: system ${v.system_pieces} vs your ${v.physical_pieces} — sent for admin review`, "warning");
      await load();
    } catch (e: any) {
      toast(e.message || "Submit failed", "error");
    } finally {
      setBusy((b) => ({ ...b, [task.id]: false }));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={t("daily_tally")} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={[s.progress, { backgroundColor: done >= total && total > 0 ? colors.success : colors.warning }]} testID="tally-progress">
          <Text style={s.progressTxt}>
            {done >= total && total > 0 ? "✓" : "⏳"} {t("daily_tally")} — {done}/{total} DONE
          </Text>
          <Text style={s.progressSub}>Physically count these items · इन आइटम की असली गिनती करें</Text>
        </View>

        {!tasks ? (
          <View style={{ padding: spacing.xl }}><ActivityIndicator color={colors.brand} /></View>
        ) : tasks.length === 0 ? (
          <Text style={s.empty}>No stock available to verify today.</Text>
        ) : (
          tasks.map((task, idx) => (
            <View key={task.id} style={s.card} testID={`tally-task-${idx}`}>
              <View style={s.cardHdr}>
                <Text style={s.cardTitle}>#{idx + 1} · {task.group_label}</Text>
                <Text style={[s.assignTag, { backgroundColor: task.assigned_by === "admin" ? colors.brand : colors.surfaceTertiary, color: task.assigned_by === "admin" ? colors.onBrand : colors.onSurface }]}>
                  {task.assigned_by === "admin" ? "ADMIN" : "AUTO"}
                </Text>
              </View>

              {task.verification ? (
                <View>
                  <View style={[s.resultBanner, { backgroundColor: task.verification.matched ? colors.success : colors.warning }]} testID={`tally-result-${idx}`}>
                    <Text style={[s.resultTxt, { color: task.verification.matched ? colors.onSuccess : colors.onWarning }]}>
                      {task.verification.matched
                        ? `✓ MATCHED — ${task.verification.physical_pieces} pcs confirmed`
                        : `⚠ MISMATCH — system ${task.verification.system_pieces} vs physical ${task.verification.physical_pieces} pcs`}
                    </Text>
                    {!task.verification.matched ? (
                      <Text style={[s.resultSub, { color: task.verification.matched ? colors.onSuccess : colors.onWarning }]}>
                        Status: {String(task.verification.status).toUpperCase().replace("_", " ")}
                        {task.verification.correction_entry_number ? ` · ${task.verification.correction_entry_number}` : ""}
                      </Text>
                    ) : null}
                  </View>
                  {task.verification.photo_path ? (
                    <Image source={{ uri: fileUrl(task.verification.photo_path, token) }} style={s.photo} resizeMode="cover" />
                  ) : null}
                  {task.verification.note ? <Text style={s.noteTxt}>📝 {task.verification.note}</Text> : null}
                </View>
              ) : (
                <View>
                  <BInput
                    testID={`tally-pieces-${idx}`}
                    label={t("physical_pieces")}
                    value={pieces[task.id] || ""}
                    onChangeText={(v) => setPieces((p) => ({ ...p, [task.id]: v }))}
                    keyboardType="decimal-pad"
                  />
                  <BInput
                    testID={`tally-note-${idx}`}
                    label={t("tally_note")}
                    value={notes[task.id] || ""}
                    onChangeText={(v) => setNotes((n) => ({ ...n, [task.id]: v }))}
                  />
                  {photoUri[task.id] ? (
                    <View style={s.photoBox}>
                      <Image source={{ uri: photoUri[task.id] }} style={s.photo} resizeMode="cover" />
                      {busy[task.id] ? <View style={s.photoOverlay}><ActivityIndicator color={colors.onSurfaceInverse} /></View> : null}
                      <Pressable testID={`tally-retake-${idx}`} style={s.retakeBtn} onPress={() => { setPhotoUri((p) => ({ ...p, [task.id]: "" })); setPhotoPath((p) => ({ ...p, [task.id]: "" })); }}>
                        <Text style={s.retakeTxt}>{t("retake")}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                      <BButton testID={`tally-camera-${idx}`} label={t("take_photo_item")} onPress={() => pickPhoto(task.id, true)} variant="secondary" size="md" />
                      <BButton testID={`tally-gallery-${idx}`} label={t("pick_photo")} onPress={() => pickPhoto(task.id, false)} variant="ghost" size="md" />
                    </View>
                  )}
                  <BButton
                    testID={`tally-submit-${idx}`}
                    label={busy[task.id] ? t("saving") : t("submit_tally")}
                    onPress={() => submit(task)}
                    loading={busy[task.id]}
                    disabled={!!busy[task.id]}
                    size="lg"
                  />
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  progress: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.lg },
  progressTxt: { fontSize: 16, fontWeight: "900", color: colors.onWarning, letterSpacing: 1 },
  progressSub: { fontSize: 11, fontWeight: "700", color: colors.onWarning, marginTop: 4, opacity: 0.85 },
  empty: { textAlign: "center", padding: spacing.xxl, color: colors.muted, fontWeight: "700" },
  card: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginBottom: spacing.md },
  cardHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  cardTitle: { fontSize: 17, fontWeight: "900", color: colors.onSurface, flexShrink: 1 },
  assignTag: { fontSize: 10, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 4 },
  resultBanner: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.sm },
  resultTxt: { fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  resultSub: { fontSize: 11, fontWeight: "700", marginTop: 4, opacity: 0.9 },
  noteTxt: { fontSize: 12, color: colors.muted, fontWeight: "700", marginTop: 4 },
  photoBox: { position: "relative", borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  photo: { width: "100%", aspectRatio: 1.3, backgroundColor: colors.surfaceSecondary },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  retakeBtn: { position: "absolute", top: 8, right: 8, backgroundColor: colors.surfaceInverse, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1.5, borderColor: colors.borderStrong },
  retakeTxt: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
});
