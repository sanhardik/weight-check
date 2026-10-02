import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Image, Platform, Linking } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth, apiFetch, fileUrl } from "@/src/auth";
import { colors, spacing } from "@/src/theme";
import { toast } from "@/src/ui/Toast";

export default function OfficeEntryDetail() {
  const { user, token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [e, setE] = useState<any>(null);
  const [invoice, setInvoice] = useState("");
  const [party, setParty] = useState("");
  const [rate, setRate] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [corrWeight, setCorrWeight] = useState("");
  const [corrPieces, setCorrPieces] = useState("");
  const [corrVehicle, setCorrVehicle] = useState("");
  const [corrDriver, setCorrDriver] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [invoicing, setInvoicing] = useState(false);

  const load = useCallback(async () => {
    if (!id || !token) return;
    const r = await apiFetch(`/entries/${id}`, {}, token);
    setE(r);
    setInvoice(r.invoice_no || ""); setParty(r.party_name || "");
    setRate(r.rate ? String(r.rate) : ""); setTerms(r.payment_terms || "");
    setNote(r.office_remarks || "");
    setCorrWeight(r.actual_weight_kg != null ? String(r.actual_weight_kg) : "");
    setCorrPieces(String(r.pieces));
    setCorrVehicle(r.vehicle_number || "");
    setCorrDriver(r.driver_name || "");
  }, [id, token]);
  useEffect(() => { load(); }, [load]);

  if (!e) return <View style={{ padding: spacing.xxxl, alignItems: "center" }}><ActivityIndicator color={colors.brand} /></View>;

  const saveOffice = async () => {
    setSaving(true);
    try {
      const upd = await apiFetch(`/entries/${id}/office`, {
        method: "PATCH",
        body: JSON.stringify({
          invoice_no: invoice || null, party_name: party || null,
          rate: rate ? parseFloat(rate) : null, payment_terms: terms || null, office_remarks: note || null,
        }),
      }, token);
      setE(upd);
      toast("Office details saved", "success");
    } catch (err: any) { toast(err.message || "Save failed", "error"); }
    finally { setSaving(false); }
  };

  const saveCorrection = async () => {
    setCorrecting(true);
    try {
      const body: any = {};
      if (corrWeight && parseFloat(corrWeight) !== e.actual_weight_kg) body.actual_weight_kg = parseFloat(corrWeight);
      if (corrPieces && parseFloat(corrPieces) !== e.pieces) body.pieces = parseFloat(corrPieces);
      if (corrVehicle && corrVehicle.toUpperCase() !== e.vehicle_number) body.vehicle_number = corrVehicle.toUpperCase();
      if (corrDriver !== (e.driver_name || "")) body.driver_name = corrDriver || null;
      if (Object.keys(body).length === 0) { toast("No changes", "warning"); return; }
      const upd = await apiFetch(`/entries/${id}/correction`, { method: "PATCH", body: JSON.stringify(body) }, token);
      setE(upd);
      toast("Correction logged in history", "success");
    } catch (err: any) { toast(err.message || "Correction failed", "error"); }
    finally { setCorrecting(false); }
  };

  const emailInvoice = async () => {
    if (!e.invoice_no || !e.party_name) { toast("Set invoice & party first", "error"); return; }
    setInvoicing(true);
    try {
      const r = await apiFetch(`/entries/${id}/invoice-pdf`, { method: "POST" }, token);
      if (r.email_error) toast(`PDF ready — email failed (${r.email_error})`, "warning");
      else toast(`✉ Sent to ${r.sent_to}`, "success");
      if (r.download_url && Platform.OS === "web") (globalThis as any).window?.open?.(r.download_url, "_blank");
      else if (r.download_url) Linking.openURL(r.download_url);
    } catch (err: any) { toast(err.message || "Invoice failed", "error"); }
    finally { setInvoicing(false); }
  };

  return (
    <View>
      <Pressable onPress={() => router.push("/office/entries")} style={s.back} testID="office-back-entries">
        <Text style={s.backTxt}>← Back to Entries</Text>
      </Pressable>

      <View style={[s.hdr, { borderLeftColor: e.direction === "inward" ? colors.brand : colors.surfaceInverse }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.hdrDir}>{e.direction === "inward" ? "INWARD · आवक" : "OUTWARD · जावक"}</Text>
          <Text style={s.hdrNo}>{e.entry_number}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {e.invoice_no ? <Text style={[s.badge, { backgroundColor: colors.success, color: colors.onSuccess }]}>✓ INVOICED</Text> : <Text style={[s.badge, { backgroundColor: colors.warning, color: colors.onWarning }]}>⏳ PENDING</Text>}
          {e.variance_flagged ? <Text style={[s.badge, { backgroundColor: colors.error, color: colors.onError }]}>⚠ VARIANCE {e.variance_pct?.toFixed(2)}%</Text> : null}
          {e.slip_mismatch_flag ? <Text style={[s.badge, { backgroundColor: colors.error, color: colors.onError }]}>⚠ SLIP MISMATCH</Text> : null}
        </View>
      </View>

      {e.slip_mismatch_flag ? (
        <View style={s.mismatch} testID="office-slip-mismatch">
          <Text style={s.mismatchTitle}>⚠ SLIP MISMATCH — correct in the correction block below, flag clears automatically</Text>
          {(e.slip_mismatch_details || []).map((d: string, i: number) => <Text key={i} style={s.mismatchLine}>• {d}</Text>)}
        </View>
      ) : null}

      <View style={s.twoCol}>
        {/* LEFT: facts */}
        <View style={s.col}>
          <Text style={s.sectionTitle}>Facts · जानकारी</Text>
          <KV k="Date" v={new Date(e.entry_date || e.created_at).toLocaleDateString()} />
          <KV k="Vehicle" v={e.vehicle_number} />
          <KV k="Driver" v={e.driver_name || "—"} suffix={e.driver_phone} />
          <KV k="Mukadam" v={e.mukadam_name || "—"} />
          {e.broker_name ? <KV k="Broker" v={e.broker_name} /> : null}
          <KV k="Theoretical weight" v={`${e.theoretical_weight_kg} kg`} />
          {e.actual_weight_kg != null ? <KV k="Actual weight" v={`${e.actual_weight_kg} kg`} /> : null}
          {e.variance_pct != null ? <KV k="Variance" v={`${e.variance_pct}%`} /> : null}
          <KV k="Created by" v={e.created_by_name || "—"} />

          {e.line_items && e.line_items.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={s.sectionTitle}>Line items · {e.line_items.length}</Text>
              <View style={s.liTable}>
                <View style={s.liHead}>
                  <Text style={[s.liTh, { flex: 1 }]}>SIZE / GRADE</Text>
                  <Text style={[s.liTh, { width: 60, textAlign: "right" }]}>PCS</Text>
                  <Text style={[s.liTh, { width: 90, textAlign: "right" }]}>WEIGHT</Text>
                </View>
                {e.line_items.map((li: any, i: number) => (
                  <View key={i} style={s.liRow}>
                    <Text style={[s.liTd, { flex: 1 }]}>{li.thickness_mm}×{li.width_mm}×{li.length_mm}{li.grade ? ` · ${li.grade}` : ""}</Text>
                    <Text style={[s.liTd, { width: 60, textAlign: "right" }]}>{li.pieces}</Text>
                    <Text style={[s.liTd, { width: 90, textAlign: "right" }]}>{Number(li.theoretical_weight_kg).toFixed(1)} kg</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {e.slip_photo_path ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={s.sectionTitle}>Weighment slip</Text>
              <Image source={{ uri: fileUrl(e.slip_photo_path, token) }} style={s.slip} resizeMode="contain" />
            </View>
          ) : null}
        </View>

        {/* RIGHT: editable */}
        <View style={s.col}>
          <Text style={s.sectionTitle}>Office details · ऑफिस विवरण</Text>
          <OfficeField label="Invoice No." value={invoice} onChangeText={setInvoice} testID="office-invoice" />
          <OfficeField label="Party name" value={party} onChangeText={setParty} testID="office-party" />
          <OfficeField label="Rate (₹)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" testID="office-rate" />
          <OfficeField label="Payment terms" value={terms} onChangeText={setTerms} testID="office-terms" />
          <OfficeField label="Office remarks" value={note} onChangeText={setNote} testID="office-remarks" multiline />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable onPress={saveOffice} disabled={saving} style={[s.primary, saving && { opacity: 0.7 }]} testID="office-save-details">
              <Text style={s.primaryTxt}>{saving ? "SAVING..." : "SAVE DETAILS"}</Text>
            </Pressable>
            <Pressable onPress={emailInvoice} disabled={invoicing || !e.invoice_no || !e.party_name} style={[s.secondary, (invoicing || !e.invoice_no || !e.party_name) && { opacity: 0.4 }]} testID="office-email-invoice">
              <Text style={s.secondaryTxt}>{invoicing ? "..." : "✉ EMAIL INVOICE PDF"}</Text>
            </Pressable>
          </View>

          <Text style={[s.sectionTitle, { marginTop: spacing.xl, color: colors.error }]}>Correct entry · सुधार</Text>
          <Text style={s.hint}>Every change here is audit-logged.</Text>
          <OfficeField label="Actual weight (kg)" value={corrWeight} onChangeText={setCorrWeight} keyboardType="decimal-pad" testID="office-corr-weight" />
          <OfficeField label="Pieces" value={corrPieces} onChangeText={setCorrPieces} keyboardType="decimal-pad" testID="office-corr-pieces" />
          <OfficeField label="Vehicle number" value={corrVehicle} onChangeText={setCorrVehicle} autoCapitalize="characters" testID="office-corr-vehicle" />
          <OfficeField label="Driver name" value={corrDriver} onChangeText={setCorrDriver} testID="office-corr-driver" />
          <Pressable onPress={saveCorrection} disabled={correcting} style={[s.danger, correcting && { opacity: 0.7 }]} testID="office-save-correction">
            <Text style={s.dangerTxt}>{correcting ? "SAVING..." : "SAVE CORRECTION"}</Text>
          </Pressable>

          {e.history && e.history.length > 0 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={s.sectionTitle}>Edit history · पिछले बदलाव</Text>
              {e.history.slice().reverse().slice(0, 20).map((h: any, i: number) => (
                <View key={i} style={s.histRow} testID={`office-history-${i}`}>
                  <View style={s.histTop}>
                    <Text style={s.histField}>{String(h.field).toUpperCase()}</Text>
                    <Text style={s.histAt}>{new Date(h.at).toLocaleString()}</Text>
                  </View>
                  <Text style={s.histDiff} numberOfLines={2}>WAS: {String(h.old ?? "—")} → NOW: {String(h.new ?? "—")}</Text>
                  <Text style={s.histBy}>{h.by_name || "User"} · {String(h.by_role || "").toUpperCase()}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {user ? null : null}
    </View>
  );
}

function KV({ k, v, suffix }: { k: string; v: string; suffix?: string | null }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={s.kvV}>{v}{suffix ? ` · ${suffix}` : ""}</Text>
    </View>
  );
}

function OfficeField({ label, testID, multiline, ...rest }: any) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.fieldLbl}>{label.toUpperCase()}</Text>
      <TextInput {...rest} testID={testID} placeholderTextColor={colors.muted} multiline={multiline} style={[s.input, multiline && { minHeight: 72 }]} />
    </View>
  );
}

const s = StyleSheet.create({
  back: { marginBottom: spacing.sm },
  backTxt: { color: colors.brand, fontWeight: "900", fontSize: 13 },
  hdr: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 6, marginBottom: spacing.md },
  hdrDir: { fontSize: 11, fontWeight: "900", color: colors.muted, letterSpacing: 2 },
  hdrNo: { fontSize: 22, fontWeight: "900", color: colors.onSurface, marginTop: 4 },
  badge: { fontSize: 10, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 4 },
  mismatch: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.error, backgroundColor: colors.error, marginBottom: spacing.md },
  mismatchTitle: { color: colors.onError, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  mismatchLine: { color: colors.onError, fontSize: 12, marginTop: 4 },

  twoCol: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  col: { flex: 1, minWidth: 340, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: spacing.sm },
  hint: { fontSize: 11, color: colors.muted, fontStyle: "italic", marginBottom: 8 },

  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  kvK: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  kvV: { fontSize: 13, color: colors.onSurface, fontWeight: "700", flexShrink: 1, textAlign: "right" },

  liTable: { borderWidth: 1, borderColor: colors.border },
  liHead: { flexDirection: "row", padding: 8, backgroundColor: colors.surfaceInverse },
  liTh: { fontSize: 10, fontWeight: "900", color: colors.onSurfaceInverse, letterSpacing: 1 },
  liRow: { flexDirection: "row", padding: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  liTd: { fontSize: 12, color: colors.onSurface },

  slip: { width: "100%", aspectRatio: 1.3, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },

  fieldLbl: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginBottom: 4 },
  input: { borderWidth: 1.5, borderColor: colors.border, padding: 10, fontSize: 14, color: colors.onSurface, backgroundColor: colors.surface },
  primary: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center" },
  primaryTxt: { color: colors.onBrand, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  secondary: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surfaceInverse, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", flex: 1 },
  secondaryTxt: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  danger: { marginTop: 8, paddingVertical: 12, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center" },
  dangerTxt: { color: colors.onError, fontWeight: "900", fontSize: 12, letterSpacing: 1 },

  histRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  histTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  histField: { fontSize: 11, fontWeight: "900", color: colors.onSurface, letterSpacing: 1 },
  histAt: { fontSize: 10, color: colors.muted },
  histDiff: { fontSize: 11, color: colors.onSurface, marginTop: 2 },
  histBy: { fontSize: 10, color: colors.muted, marginTop: 2, letterSpacing: 1 },
});
