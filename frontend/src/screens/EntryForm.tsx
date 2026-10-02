import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Image, Pressable, ActivityIndicator, TextInput,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useAuth, apiFetch, uploadImageAsset } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { Header } from "@/src/ui/Header";
import { BInput } from "@/src/ui/BInput";
import { BButton } from "@/src/ui/BButton";
import { toast } from "@/src/ui/Toast";
import { VoiceInput } from "@/src/ui/VoiceInput";
import { QRScanner } from "@/src/ui/QRScanner";
import { Dropdown } from "@/src/ui/Dropdown";
import { getMukadam } from "@/src/mukadam";

type Props = { direction: "inward" | "outward" };

type LineItem = {
  id: string;
  thickness_mm: string;
  width_mm: string;
  length_mm: string;
  pieces: string;
  grade: string;
};

function newLine(): LineItem {
  return { id: Math.random().toString(36).slice(2), thickness_mm: "", width_mm: "", length_mm: "", pieces: "", grade: "" };
}

const DENSITY = 7.85e-6;

export function EntryForm({ direction }: Props) {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();

  const canAddCatalog = user?.role === "admin" || user?.role === "office";

  // Catalog state
  const [thicknesses, setThicknesses] = useState<number[]>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const [lengths, setLengths] = useState<number[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [brokers, setBrokers] = useState<string[]>([]);

  const refreshCatalog = useCallback(async () => {
    if (!token) return;
    try {
      const [t_, w, l, g, b] = await Promise.all([
        apiFetch("/catalog/thicknesses", {}, token),
        apiFetch("/catalog/widths", {}, token),
        apiFetch("/catalog/lengths", {}, token),
        apiFetch("/catalog/grades", {}, token),
        direction === "outward" ? apiFetch("/catalog/brokers", {}, token) : Promise.resolve([]),
      ]);
      setThicknesses((t_ || []).map((x: any) => Number(x.value)));
      setWidths((w || []).map((x: any) => Number(x.value)));
      setLengths((l || []).map((x: any) => Number(x.value)));
      setGrades((g || []).map((x: any) => String(x.value)));
      setBrokers((b || []).map((x: any) => String(x.value)));
    } catch { /* ignore */ }
  }, [token, direction]);

  useEffect(() => { refreshCatalog(); }, [refreshCatalog]);

  // Form state
  const [vehicle, setVehicle] = useState("");
  const [vehicleHint, setVehicleHint] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLine()]);
  const [broker, setBroker] = useState("");
  const [mukadam, setMukadamName] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [actualWeight, setActualWeight] = useState("");
  const [remarks, setRemarks] = useState("");

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrText, setOcrText] = useState<string>("");
  const [ocrWeight, setOcrWeight] = useState<number | null>(null);
  const [ocrVehicle, setOcrVehicle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getMukadam().then(setMukadamName); }, []);

  const totals = useMemo(() => {
    let tw = 0;
    let pcs = 0;
    for (const li of lineItems) {
      const t = parseFloat(li.thickness_mm) || 0;
      const w = parseFloat(li.width_mm) || 0;
      const l = parseFloat(li.length_mm) || 0;
      const p = parseFloat(li.pieces) || 0;
      tw += t * w * l * p * DENSITY;
      pcs += p;
    }
    return { tw, pcs };
  }, [lineItems]);
  const variance = actualWeight && totals.tw > 0 ? Math.abs(parseFloat(actualWeight) - totals.tw) / totals.tw * 100 : null;
  const flagged = variance !== null && variance > 0.35;

  // Cross-check labour entry against what OCR read from the weighment slip
  const normPlate = (v: string) => (v || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const slipWarnings: string[] = [];
  if (ocrVehicle && vehicle && normPlate(ocrVehicle) !== normPlate(vehicle))
    slipWarnings.push(`${t("slip_vehicle_differs")}: ${ocrVehicle}`);
  if (ocrWeight != null && actualWeight && Math.abs(parseFloat(actualWeight) - ocrWeight) / ocrWeight * 100 > 0.35)
    slipWarnings.push(`${t("slip_weight_differs")}: ${ocrWeight} kg`);

  const lookupVehicle = useCallback(async (plate: string) => {
    const p = (plate || "").trim().toUpperCase();
    if (!p || p.length < 4) { setVehicleHint(null); return; }
    try {
      const v = await apiFetch(`/vehicles/${encodeURIComponent(p)}`, {}, token);
      if (v?.last_driver || v?.last_phone) {
        setVehicleHint(`Last: ${v.last_driver || "—"}${v.last_phone ? " · " + v.last_phone : ""}`);
        if (!driverName && v.last_driver) setDriverName(v.last_driver);
        if (!driverPhone && v.last_phone) setDriverPhone(v.last_phone);
      } else setVehicleHint(null);
    } catch { setVehicleHint(null); }
  }, [token, driverName, driverPhone]);

  const addCatalogValue = async (kind: "thicknesses" | "widths" | "lengths" | "grades" | "brokers", value: string) => {
    if (!canAddCatalog) return;
    try {
      await apiFetch(`/catalog/${kind}`, { method: "POST", body: JSON.stringify({ value }) }, token);
      toast(`Added to ${kind}`, "success");
      refreshCatalog();
    } catch (e: any) { toast(e.message || "Add failed", "error"); }
  };

  const updateLine = (idx: number, patch: Partial<LineItem>) =>
    setLineItems((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const removeLine = (idx: number) =>
    setLineItems((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  const addLine = () => setLineItems((prev) => [...prev, newLine()]);

  const pickPhoto = async (fromCamera: boolean) => {
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
      setPhotoUri(asset.uri);
      setUploading(true);
      const up = await uploadImageAsset(asset, token);
      setPhotoPath(up.path);
      toast("Photo uploaded", "success");
      setOcrLoading(true);
      try {
        // JSON path-based variant — FormData is broken under expo/fetch on native
        const ocr = await apiFetch("/vision/weight/path", { method: "POST", body: JSON.stringify({ slip_photo_path: up.path }) }, token);
        if (ocr?.weight_kg != null) {
          setActualWeight(String(ocr.weight_kg));
          setOcrWeight(Number(ocr.weight_kg));
          setOcrText(ocr.raw || "");
          toast(`📷 Weight: ${ocr.weight_kg} kg`, "success");
        } else toast("Could not read weight", "warning");
        if (ocr?.vehicle_number) {
          setOcrVehicle(String(ocr.vehicle_number));
          toast(`📷 Slip vehicle: ${ocr.vehicle_number}`, "success");
        }
      } catch (e: any) { toast(`OCR skipped: ${e.message}`, "warning"); }
      setOcrLoading(false);
    } catch (e: any) {
      toast(e.message || "Upload failed", "error");
      setPhotoUri(null);
    } finally { setUploading(false); }
  };

  const onSave = async () => {
    if (!vehicle) { toast("Vehicle number required", "error"); return; }
    const valid = lineItems.filter((li) => li.thickness_mm && li.width_mm && li.length_mm && li.pieces);
    if (valid.length === 0) { toast("Add at least one product line", "error"); return; }
    if (direction === "outward" && !broker) { toast("Broker required", "error"); return; }
    setSaving(true);
    try {
      const body: any = {
        vehicle_number: vehicle.toUpperCase(),
        driver_name: driverName || null,
        driver_phone: driverPhone || null,
        mukadam_name: mukadam || null,
        line_items: valid.map((li) => ({
          thickness_mm: parseFloat(li.thickness_mm),
          width_mm: parseFloat(li.width_mm),
          length_mm: parseFloat(li.length_mm),
          pieces: parseFloat(li.pieces),
          grade: li.grade || null,
        })),
        entry_date: entryDate ? new Date(entryDate + "T00:00:00").toISOString() : null,
        actual_weight_kg: actualWeight ? parseFloat(actualWeight) : null,
        slip_photo_path: photoPath,
        slip_ocr_weight_kg: ocrWeight,
        slip_ocr_vehicle_number: ocrVehicle,
        remarks: remarks || null,
      };
      if (direction === "outward") body.broker_name = broker;
      const res = await apiFetch(`/entries/${direction}`, { method: "POST", body: JSON.stringify(body) }, token);
      if (res?.slip_mismatch_flag) {
        toast(t("slip_flagged_saved"), "warning");
      } else {
        toast(`Saved: ${res.entry_number}`, "success");
      }
      router.replace("/home");
    } catch (e: any) { toast(e.message || "Save failed", "error"); }
    finally { setSaving(false); }
  };

  const titleHi = direction === "inward" ? "आवक एंट्री" : "जावक एंट्री";
  const titleEn = direction === "inward" ? "INWARD ENTRY" : "OUTWARD ENTRY";

  const labourLocked = user?.role === "labour";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Header title={titleEn} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={s.banner}>
          <Text style={s.bannerHi}>{titleHi}</Text>
          <Text style={s.bannerEn}>{titleEn}</Text>
        </View>

        {mukadam ? (
          <View style={s.mukadamBadge}>
            <Text style={s.mukadamLbl}>मुकादम · WAREHOUSE KEEPER</Text>
            <Text style={s.mukadamName}>{mukadam}</Text>
          </View>
        ) : (
          <Pressable testID="mukadam-missing-cta" onPress={() => router.push("/mukadam")} style={s.mukadamMissing}>
            <Text style={s.mukadamMissingTxt}>⚠ SELECT WAREHOUSE KEEPER FIRST →</Text>
          </Pressable>
        )}

        <Text style={s.section}>1. VEHICLE / वाहन</Text>
        <View style={s.vehicleRow}>
          <View style={{ flex: 1 }}>
            <BInput
              testID="input-vehicle"
              label={t("vehicle")}
              value={vehicle}
              onChangeText={(v) => { setVehicle(v); setVehicleHint(null); }}
              onBlur={() => lookupVehicle(vehicle)}
              autoCapitalize="characters"
              placeholder="MH12 AB 1234"
            />
          </View>
          <Pressable testID="scan-qr-btn" onPress={() => setQrOpen(true)} style={({ pressed }) => [s.qrBtn, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={s.qrIcon}>⧈</Text>
            <Text style={s.qrLbl}>QR</Text>
          </Pressable>
        </View>
        {vehicleHint ? <Text style={s.vehicleHint} testID="vehicle-hint">↩ {vehicleHint} — autofilled</Text> : null}
        <BInput testID="input-driver" label="DRIVER NAME · चालक" value={driverName} onChangeText={setDriverName} />
        <BInput testID="input-driver-phone" label="DRIVER PHONE · फोन" value={driverPhone} onChangeText={setDriverPhone} keyboardType="phone-pad" />
        {direction === "outward" ? (
          <Dropdown
            testID="broker-dropdown"
            label={t("broker")}
            value={broker || null}
            options={brokers}
            onChange={setBroker}
            placeholder="SELECT BROKER · ब्रोकर चुनें"
          />
        ) : null}

        <QRScanner
          visible={qrOpen}
          onClose={() => setQrOpen(false)}
          onScanned={(data) => {
            const code = data.toUpperCase().slice(0, 32);
            setVehicle(code);
            toast(`QR: ${data}`, "success");
            setQrOpen(false);
            lookupVehicle(code);
          }}
        />

        <Text style={s.section}>2. PRODUCTS / सामान</Text>
        <View>
          <VoiceInput
            testID="voice-fill"
            onNumbers={(nums) => {
              updateLine(0, {
                thickness_mm: nums[0] != null ? String(nums[0]) : lineItems[0].thickness_mm,
                width_mm: nums[1] != null ? String(nums[1]) : lineItems[0].width_mm,
                length_mm: nums[2] != null ? String(nums[2]) : lineItems[0].length_mm,
              });
            }}
          />
        </View>

        {lineItems.map((li, idx) => (
          <View key={li.id} style={s.lineCard} testID={`line-${idx}`}>
            <View style={s.lineHdr}>
              <Text style={s.lineHdrTxt}>LINE {idx + 1}</Text>
              {lineItems.length > 1 ? (
                <Pressable testID={`line-remove-${idx}`} onPress={() => removeLine(idx)} style={s.lineRemove}>
                  <Text style={s.lineRemoveTxt}>REMOVE</Text>
                </Pressable>
              ) : null}
            </View>
            <Dropdown
              testID={`line-${idx}-thickness`}
              label={t("thickness")}
              value={li.thickness_mm || null}
              options={thicknesses.map(String)}
              onChange={(v) => updateLine(idx, { thickness_mm: v })}
              placeholder="SELECT · mm"
            />
            <Dropdown
              testID={`line-${idx}-width`}
              label={t("width")}
              value={li.width_mm || null}
              options={widths.map(String)}
              onChange={(v) => updateLine(idx, { width_mm: v })}
              placeholder="SELECT · mm"
            />
            <Dropdown
              testID={`line-${idx}-length`}
              label={t("length")}
              value={li.length_mm || null}
              options={lengths.map(String)}
              onChange={(v) => updateLine(idx, { length_mm: v })}
              placeholder="SELECT · mm"
            />
            <BInput
              testID={`line-${idx}-pieces`}
              label={t("pieces")}
              value={li.pieces}
              onChangeText={(v) => updateLine(idx, { pieces: v })}
              keyboardType="decimal-pad"
            />
            <Dropdown
              testID={`line-${idx}-grade`}
              label={t("grade")}
              value={li.grade || null}
              options={grades}
              onChange={(v) => updateLine(idx, { grade: v })}
              placeholder="SELECT GRADE"
            />
          </View>
        ))}

        <Pressable testID="add-line-btn" onPress={addLine} style={s.addLine}>
          <Text style={s.addLineTxt}>+ ADD ANOTHER PRODUCT · एक और जोड़ें</Text>
        </Pressable>

        {canAddCatalog ? (
          <Text style={s.catalogHint} testID="catalog-hint">
            Office / Admin: dimensions missing from the dropdowns? Add them in Settings → Catalog.
          </Text>
        ) : (
          <Text style={s.catalogHint}>
            Choose only from the dropdowns. Ask Office to add any missing size or grade.
          </Text>
        )}

        <Text style={s.section}>3. DATE / तारीख</Text>
        <BInput
          testID="input-entry-date"
          label="ENTRY DATE (YYYY-MM-DD)"
          value={entryDate}
          onChangeText={setEntryDate}
          placeholder={new Date().toISOString().slice(0, 10)}
        />

        <Text style={s.section}>4. WEIGHT / वजन</Text>
        <View style={s.weightCard}>
          <Text style={s.weightLbl}>TOTAL THEORETICAL</Text>
          <Text style={s.weightVal} testID="theoretical-weight">{totals.tw.toFixed(3)} kg</Text>
          <Text style={s.weightSub}>{totals.pcs} pieces across {lineItems.length} line(s)</Text>
        </View>
        <BInput
          testID="input-actual-weight"
          label={t("actual_weight")}
          value={actualWeight}
          onChangeText={setActualWeight}
          keyboardType="decimal-pad"
          suffix="kg"
        />
        {ocrLoading ? (
          <View style={s.ocrBanner}><ActivityIndicator color={colors.onSurfaceInverse} /><Text style={s.ocrTxt}>📷 READING SLIP...</Text></View>
        ) : ocrText ? (
          <View style={[s.ocrBanner, { backgroundColor: colors.success }]}><Text style={[s.ocrTxt, { color: colors.onSuccess }]}>✓ OCR: {ocrText}{ocrVehicle ? ` · 🚚 ${ocrVehicle}` : ""}</Text></View>
        ) : null}
        {slipWarnings.length > 0 ? (
          <View style={s.slipWarn} testID="slip-mismatch-warning">
            {slipWarnings.map((w, i) => (
              <Text key={i} style={s.slipWarnTxt}>⚠ {w}</Text>
            ))}
            <Text style={s.slipWarnSub}>{t("slip_warn_save")}</Text>
          </View>
        ) : null}
        {variance != null ? (
          <View style={[s.varianceCard, flagged ? { backgroundColor: colors.error } : { backgroundColor: colors.success }]}>
            <Text style={[s.varianceLbl, { color: flagged ? colors.onError : colors.onSuccess }]}>VARIANCE: {variance.toFixed(3)}%</Text>
            <Text style={[s.varianceFlag, { color: flagged ? colors.onError : colors.onSuccess }]}>{flagged ? `⚠ ${t("flagged_variance")}` : "✓ WITHIN TOLERANCE"}</Text>
          </View>
        ) : null}

        <Text style={s.section}>5. SLIP PHOTO / स्लिप</Text>
        {photoUri ? (
          <View style={s.photoBox}>
            <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
            {uploading ? <View style={s.photoOverlay}><ActivityIndicator color={colors.onSurfaceInverse} /></View> : null}
            <Pressable testID="retake-photo" style={s.retakeBtn} onPress={() => { setPhotoUri(null); setPhotoPath(null); setOcrText(""); setOcrWeight(null); setOcrVehicle(null); }}>
              <Text style={s.retakeTxt}>{t("retake")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <BButton testID="take-photo-btn" label={t("take_photo")} onPress={() => pickPhoto(true)} variant="secondary" size="lg" loading={uploading} />
            <BButton testID="pick-photo-btn" label={t("pick_photo")} onPress={() => pickPhoto(false)} variant="ghost" />
          </View>
        )}

        <BInput testID="input-remarks" label={t("remarks")} value={remarks} onChangeText={setRemarks} multiline />

        <View style={{ marginTop: spacing.lg }}>
          <BButton
            testID="save-entry-btn"
            label={saving ? t("saving") : t("save_entry")}
            onPress={onSave}
            loading={saving}
            disabled={uploading}
            size="xl"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  banner: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.brand, marginBottom: spacing.lg },
  bannerHi: { fontSize: 24, fontWeight: "800", color: colors.onBrand },
  bannerEn: { fontSize: 12, fontWeight: "800", color: colors.onBrand, opacity: 0.9, letterSpacing: 2 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 2, color: colors.muted, marginTop: spacing.md, marginBottom: spacing.sm },

  mukadamBadge: { padding: spacing.sm, backgroundColor: colors.brandTertiary, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  mukadamLbl: { fontSize: 10, fontWeight: "800", letterSpacing: 2, color: colors.muted },
  mukadamName: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  mukadamMissing: { padding: spacing.md, backgroundColor: colors.warning, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  mukadamMissingTxt: { color: colors.onWarning, fontWeight: "800", letterSpacing: 1, fontSize: 13, textAlign: "center" },

  vehicleRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  qrBtn: { width: 72, height: 52, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceInverse, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  qrIcon: { color: colors.onSurfaceInverse, fontSize: 22, fontWeight: "800" },
  qrLbl: { color: colors.onSurfaceInverse, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  vehicleHint: { fontSize: 11, fontWeight: "800", color: colors.success, marginBottom: spacing.sm, marginTop: -spacing.sm },

  lineCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginBottom: spacing.md },
  lineHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  lineHdrTxt: { fontSize: 12, fontWeight: "800", color: colors.brand, letterSpacing: 2 },
  lineRemove: { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1.5, borderColor: colors.error },
  lineRemoveTxt: { color: colors.error, fontWeight: "800", fontSize: 10, letterSpacing: 1 },
  addLine: { paddingVertical: 14, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandTertiary, alignItems: "center", marginBottom: spacing.sm },
  addLineTxt: { color: colors.onSurface, fontWeight: "800", fontSize: 13, letterSpacing: 1 },
  catalogHint: { fontSize: 11, color: colors.muted, fontStyle: "italic", marginBottom: spacing.md, textAlign: "center" },

  weightCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceInverse, marginBottom: spacing.md },
  weightLbl: { fontSize: 10, color: colors.onSurfaceInverse, fontWeight: "800", letterSpacing: 2, opacity: 0.7 },
  weightVal: { fontSize: 32, color: colors.onSurfaceInverse, fontWeight: "800", marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  weightSub: { fontSize: 11, color: colors.onSurfaceInverse, opacity: 0.8, marginTop: 4 },

  varianceCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  varianceLbl: { fontSize: 14, fontWeight: "800", letterSpacing: 1 },
  varianceFlag: { fontSize: 16, fontWeight: "800", marginTop: 4, letterSpacing: 1 },

  ocrBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceInverse, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  ocrTxt: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 11, letterSpacing: 1, flexShrink: 1 },

  slipWarn: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.warning, marginBottom: spacing.md },
  slipWarnTxt: { color: colors.onWarning, fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  slipWarnSub: { color: colors.onSurface, fontSize: 11, marginTop: 4, fontStyle: "italic" },

  photoBox: { position: "relative", borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  photo: { width: "100%", aspectRatio: 1.3, backgroundColor: colors.surfaceSecondary },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  retakeBtn: { position: "absolute", top: 8, right: 8, backgroundColor: colors.surfaceInverse, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1.5, borderColor: colors.borderStrong },
  retakeTxt: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
});
