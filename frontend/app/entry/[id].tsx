import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, KeyboardAvoidingView, Platform, ActivityIndicator, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, Redirect } from "expo-router";
import { useAuth, apiFetch, fileUrl } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { BInput } from "@/src/ui/BInput";
import { BButton } from "@/src/ui/BButton";
import { toast } from "@/src/ui/Toast";

type Entry = any;

export default function EntryDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [invoice, setInvoice] = useState("");
  const [party, setParty] = useState("");
  const [rate, setRate] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Correction fields
  const [corrWeight, setCorrWeight] = useState("");
  const [corrPieces, setCorrPieces] = useState("");
  const [corrVehicle, setCorrVehicle] = useState("");
  const [corrDriver, setCorrDriver] = useState("");
  const [corrPhone, setCorrPhone] = useState("");
  const [correcting, setCorrecting] = useState(false);

  const [invoicing, setInvoicing] = useState(false);

  useEffect(() => {
    if (!token || !id) return;
    apiFetch(`/entries/${id}`, {}, token).then((e) => {
      setEntry(e);
      setInvoice(e.invoice_no || "");
      setParty(e.party_name || "");
      setRate(e.rate ? String(e.rate) : "");
      setTerms(e.payment_terms || "");
      setNote(e.office_remarks || "");
      setCorrWeight(e.actual_weight_kg != null ? String(e.actual_weight_kg) : "");
      setCorrPieces(String(e.pieces));
      setCorrVehicle(e.vehicle_number || "");
      setCorrDriver(e.driver_name || "");
      setCorrPhone(e.driver_phone || "");
    });
  }, [id, token]);

  if (!user) return <Redirect href="/login" />;

  const canEdit = user.role === "admin" || user.role === "office";

  const onSave = async () => {
    setSaving(true);
    try {
      const body: any = {
        invoice_no: invoice || null,
        party_name: party || null,
        rate: rate ? parseFloat(rate) : null,
        payment_terms: terms || null,
        office_remarks: note || null,
      };
      const upd = await apiFetch(`/entries/${id}/office`, { method: "PATCH", body: JSON.stringify(body) }, token);
      setEntry(upd);
      toast("Details updated", "success");
    } catch (e: any) {
      toast(e.message || "Update failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const onCorrect = async () => {
    setCorrecting(true);
    try {
      const body: any = {};
      if (corrWeight && parseFloat(corrWeight) !== entry.actual_weight_kg) body.actual_weight_kg = parseFloat(corrWeight);
      if (corrPieces && parseFloat(corrPieces) !== entry.pieces) body.pieces = parseFloat(corrPieces);
      if (corrVehicle && corrVehicle.toUpperCase() !== entry.vehicle_number) body.vehicle_number = corrVehicle.toUpperCase();
      if (corrDriver !== (entry.driver_name || "")) body.driver_name = corrDriver || null;
      if (corrPhone !== (entry.driver_phone || "")) body.driver_phone = corrPhone || null;
      if (Object.keys(body).length === 0) { toast("Nothing to update", "warning"); return; }
      const upd = await apiFetch(`/entries/${id}/correction`, { method: "PATCH", body: JSON.stringify(body) }, token);
      setEntry(upd);
      toast("Correction logged in history", "success");
    } catch (e: any) {
      toast(e.message || "Correction failed", "error");
    } finally {
      setCorrecting(false);
    }
  };

  const emailInvoicePdf = async () => {
    if (!entry?.invoice_no || !entry?.party_name) {
      toast("Add Invoice No. and Party Name first", "error");
      return;
    }
    setInvoicing(true);
    try {
      const res = await apiFetch(`/entries/${id}/invoice-pdf`, { method: "POST" }, token);
      if (res.email_error) {
        toast(`PDF ready — email failed (${res.email_error})`, "warning");
      } else {
        toast(`✉ Invoice sent to ${res.sent_to}`, "success");
      }
      if (res.download_url) {
        if (Platform.OS === "web") {
          const win = (globalThis as any).window;
          if (win?.open) win.open(res.download_url, "_blank");
        } else {
          Linking.openURL(res.download_url);
        }
      }
    } catch (e: any) {
      toast(e.message || "Invoice failed", "error");
    } finally {
      setInvoicing(false);
    }
  };

  if (!entry) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <Header title={t("details")} showBack />
        <View style={{ padding: spacing.xl }}><ActivityIndicator color={colors.brand} /></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Header title={entry.entry_number} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={[s.banner, { backgroundColor: entry.direction === "inward" ? colors.brand : colors.surfaceInverse }]}>
          <Text style={[s.bannerTitle, { color: entry.direction === "inward" ? colors.onBrand : colors.onSurfaceInverse }]}>
            {entry.direction === "inward" ? "INWARD · आवक" : "OUTWARD · जावक"}
          </Text>
          <Text style={[s.bannerNo, { color: entry.direction === "inward" ? colors.onBrand : colors.onSurfaceInverse }]}>
            {entry.entry_number}
          </Text>
        </View>

        <View style={s.kv}><Text style={s.k}>DATE</Text><Text style={s.v}>{new Date(entry.entry_date || entry.created_at).toLocaleDateString()}</Text></View>
        <View style={s.kv}><Text style={s.k}>VEHICLE</Text><Text style={s.v}>{entry.vehicle_number}</Text></View>
        {entry.driver_name ? <View style={s.kv}><Text style={s.k}>DRIVER</Text><Text style={s.v}>{entry.driver_name}</Text></View> : null}
        {entry.driver_phone ? <View style={s.kv}><Text style={s.k}>DRIVER PHONE</Text><Text style={s.v}>{entry.driver_phone}</Text></View> : null}
        {entry.mukadam_name ? <View style={s.kv}><Text style={s.k}>MUKADAM</Text><Text style={s.v}>{entry.mukadam_name}</Text></View> : null}
        {entry.broker_name ? <View style={s.kv}><Text style={s.k}>BROKER</Text><Text style={s.v}>{entry.broker_name}</Text></View> : null}

        {entry.line_items && entry.line_items.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={s.secTitle}>PRODUCTS · {entry.line_items.length} LINE{entry.line_items.length > 1 ? "S" : ""}</Text>
            {entry.line_items.map((li: any, i: number) => (
              <View key={i} style={s.kv} testID={`detail-line-${i}`}>
                <Text style={s.k}>#{i + 1} · {li.grade || "—"}</Text>
                <Text style={s.v}>{li.thickness_mm}×{li.width_mm}×{li.length_mm} · {li.pieces} pcs · {Number(li.theoretical_weight_kg).toFixed(2)} kg</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[s.kv, s.kvHl]}>
          <Text style={[s.k, { color: colors.onSurfaceInverse }]}>THEORETICAL WT</Text>
          <Text style={[s.v, { color: colors.onSurfaceInverse }]}>{entry.theoretical_weight_kg} kg</Text>
        </View>
        {entry.actual_weight_kg != null ? (
          <>
            <View style={s.kv}><Text style={s.k}>ACTUAL WT</Text><Text style={s.v}>{entry.actual_weight_kg} kg</Text></View>
            {entry.variance_pct != null && (
              <View style={[s.kv, { backgroundColor: entry.variance_flagged ? colors.error : colors.success }]}>
                <Text style={[s.k, { color: colors.onError }]}>VARIANCE</Text>
                <Text style={[s.v, { color: colors.onError }]}>{entry.variance_pct}% {entry.variance_flagged ? "⚠ FLAGGED" : "✓ OK"}</Text>
              </View>
            )}
          </>
        ) : null}

        {entry.slip_photo_path ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={s.secTitle}>SLIP PHOTO</Text>
            {Platform.OS === "web" ? (
              <Image source={{ uri: fileUrl(entry.slip_photo_path, token) }} style={s.slip} resizeMode="contain" />
            ) : (
              <Image
                source={{ uri: fileUrl(entry.slip_photo_path, null), headers: { Authorization: `Bearer ${token}` } }}
                style={s.slip}
                resizeMode="contain"
              />
            )}
          </View>
        ) : null}

        {entry.slip_mismatch_flag ? (
          <View style={s.mismatchBlock} testID="slip-mismatch-banner">
            <Text style={s.mismatchTitle}>⚠ {t("slip_mismatch")}</Text>
            {(entry.slip_mismatch_details || []).map((d: string, i: number) => (
              <Text key={i} style={s.mismatchTxt}>• {d}</Text>
            ))}
            {canEdit ? (
              <Text style={s.mismatchHint}>Correct the entry below — the flag clears automatically once it matches the slip.</Text>
            ) : null}
          </View>
        ) : entry.slip_ocr_vehicle_number || entry.slip_ocr_weight_kg != null ? (
          <View style={[s.kv, { backgroundColor: colors.surfaceTertiary }]}>
            <Text style={s.k}>SLIP OCR · {t("slip_match_ok")} ✓</Text>
            <Text style={s.v}>
              {entry.slip_ocr_vehicle_number || ""}{entry.slip_ocr_vehicle_number && entry.slip_ocr_weight_kg != null ? " · " : ""}{entry.slip_ocr_weight_kg != null ? `${entry.slip_ocr_weight_kg} kg` : ""}
            </Text>
          </View>
        ) : null}

        <View style={s.kv}><Text style={s.k}>CREATED BY</Text><Text style={s.v}>{entry.created_by_name}</Text></View>
        <View style={s.kv}><Text style={s.k}>DATE</Text><Text style={s.v}>{new Date(entry.created_at).toLocaleString()}</Text></View>
        {entry.remarks ? <View style={s.kv}><Text style={s.k}>REMARKS</Text><Text style={s.v}>{entry.remarks}</Text></View> : null}

        <View style={s.officeBlock}>
          <Text style={s.secTitle}>OFFICE DETAILS</Text>
          {canEdit ? (
            <>
              <BInput testID="input-invoice" label={t("invoice_no")} value={invoice} onChangeText={setInvoice} />
              <BInput testID="input-party" label={t("party_name")} value={party} onChangeText={setParty} />
              <BInput testID="input-rate" label={t("rate")} value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
              <BInput testID="input-terms" label={t("payment_terms")} value={terms} onChangeText={setTerms} />
              <BInput testID="input-office-remarks" label={t("office_remarks")} value={note} onChangeText={setNote} multiline />
              <BButton testID="save-office-btn" label={saving ? t("saving") : t("update_details")} onPress={onSave} loading={saving} size="lg" />
              <View style={{ height: spacing.sm }} />
              <BButton
                testID="email-invoice-btn"
                label={invoicing ? "GENERATING..." : "📧 EMAIL INVOICE PDF"}
                onPress={emailInvoicePdf}
                loading={invoicing}
                disabled={!entry.invoice_no || !entry.party_name}
                variant="secondary"
                size="md"
              />
            </>
          ) : (
            <>
              <View style={s.kv}><Text style={s.k}>{t("invoice_no")}</Text><Text style={s.v}>{entry.invoice_no || "—"}</Text></View>
              <View style={s.kv}><Text style={s.k}>{t("party_name")}</Text><Text style={s.v}>{entry.party_name || "—"}</Text></View>
              {user.role !== "labour" ? (
                <View style={s.kv}><Text style={s.k}>{t("rate")}</Text><Text style={s.v}>{entry.rate ?? "—"}</Text></View>
              ) : null}
              <View style={s.kv}><Text style={s.k}>{t("payment_terms")}</Text><Text style={s.v}>{entry.payment_terms || "—"}</Text></View>
            </>
          )}
        </View>

        {canEdit ? (
          <View style={s.correctionBlock} testID="correction-block">
            <Text style={s.secTitle}>CORRECT ENTRY · सुधार</Text>
            <Text style={s.correctionHint}>Every change here is logged in the audit trail below.</Text>
            <BInput testID="corr-actual-wt" label={t("actual_weight")} value={corrWeight} onChangeText={setCorrWeight} keyboardType="decimal-pad" suffix="kg" />
            <BInput testID="corr-pieces" label={t("pieces")} value={corrPieces} onChangeText={setCorrPieces} keyboardType="decimal-pad" />
            <BInput testID="corr-vehicle" label={t("vehicle")} value={corrVehicle} onChangeText={setCorrVehicle} autoCapitalize="characters" />
            <BInput testID="corr-driver" label="DRIVER NAME" value={corrDriver} onChangeText={setCorrDriver} />
            <BInput testID="corr-driver-phone" label="DRIVER PHONE" value={corrPhone} onChangeText={setCorrPhone} keyboardType="phone-pad" />
            <BButton testID="save-correction-btn" label={correcting ? "SAVING..." : "SAVE CORRECTION"} onPress={onCorrect} loading={correcting} variant="danger" size="md" />
          </View>
        ) : null}

        {canEdit && entry.history && entry.history.length > 0 ? (
          <View style={s.historyBlock} testID="history-block">
            <Text style={s.secTitle}>EDIT HISTORY · पिछले बदलाव</Text>
            {entry.history.slice().reverse().map((h: any, i: number) => (
              <View key={i} style={s.historyRow} testID={`history-row-${i}`}>
                <View style={s.historyTop}>
                  <Text style={s.historyField}>{String(h.field).toUpperCase()}</Text>
                  <Text style={s.historyDate}>{new Date(h.at).toLocaleString()}</Text>
                </View>
                <View style={s.historyDiff}>
                  <Text style={s.historyOld} numberOfLines={1}>WAS: {h.old === null || h.old === undefined || h.old === "" ? "—" : String(h.old)}</Text>
                  <Text style={s.historyArrow}>→</Text>
                  <Text style={s.historyNew} numberOfLines={1}>NOW: {h.new === null || h.new === undefined || h.new === "" ? "—" : String(h.new)}</Text>
                </View>
                <Text style={s.historyBy}>{h.by_name || "User"} · {String(h.by_role || "").toUpperCase()}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  banner: { padding: spacing.lg, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  bannerTitle: { fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  bannerNo: { fontSize: 24, fontWeight: "900", marginTop: 4 },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, borderBottomWidth: 0, backgroundColor: colors.surface },
  kvHl: { backgroundColor: colors.surfaceInverse },
  k: { fontSize: 11, fontWeight: "900", color: colors.muted, letterSpacing: 1 },
  v: { fontSize: 16, fontWeight: "900", color: colors.onSurface, flexShrink: 1, textAlign: "right", marginLeft: spacing.sm },
  slip: { width: "100%", aspectRatio: 1.3, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  mismatchBlock: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.error },
  mismatchTitle: { fontSize: 13, fontWeight: "900", letterSpacing: 1, color: colors.onError },
  mismatchTxt: { fontSize: 12, fontWeight: "700", color: colors.onError, marginTop: 4 },
  mismatchHint: { fontSize: 11, color: colors.onError, marginTop: 8, fontStyle: "italic", opacity: 0.9 },
  secTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginTop: spacing.lg, marginBottom: spacing.sm },
  officeBlock: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandTertiary },

  correctionBlock: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.error, backgroundColor: colors.surface },
  correctionHint: { fontSize: 11, color: colors.muted, marginBottom: spacing.sm, fontStyle: "italic" },

  historyBlock: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  historyField: { fontSize: 11, fontWeight: "900", letterSpacing: 2, color: colors.onSurface },
  historyDate: { fontSize: 10, color: colors.muted },
  historyDiff: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  historyOld: { fontSize: 12, color: colors.muted, textDecorationLine: "line-through", flexShrink: 1 },
  historyArrow: { fontSize: 14, fontWeight: "900", color: colors.brand },
  historyNew: { fontSize: 12, color: colors.onSurface, fontWeight: "900", flexShrink: 1 },
  historyBy: { fontSize: 10, color: colors.muted, marginTop: 4, letterSpacing: 1 },
});
