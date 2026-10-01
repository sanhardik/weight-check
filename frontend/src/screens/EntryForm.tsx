import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Image, Pressable, ActivityIndicator } from "react-native";
import { router, Redirect, useLocalSearchParams } from "expo-router";import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useAuth, apiFetch, fileUrl } from "@/src/auth";
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

type Props = { direction: "inward" | "outward"; prefill?: any };

export function EntryForm({ direction, prefill }: Props) {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { t } = useI18n();

  const [thickness, setThickness] = useState(prefill?.thickness ?? "");
  const [width, setWidth] = useState(prefill?.width ?? "");
  const [length, setLength] = useState(prefill?.length ?? "");
  const [pieces, setPieces] = useState("");
  const [grade, setGrade] = useState(prefill?.grade ?? "");
  const [vehicle, setVehicle] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehicleHint, setVehicleHint] = useState<string | null>(null);
  const [broker, setBroker] = useState("");
  const [brokers, setBrokers] = useState<string[]>([]);
  const [mukadam, setMukadamName] = useState<string | null>(null);
  const [actualWeight, setActualWeight] = useState("");
  const [remarks, setRemarks] = useState("");

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrText, setOcrText] = useState<string>("");
  const [qrOpen, setQrOpen] = useState(false);

  const nf = (v: string) => parseFloat(v) || 0;
  const theoretical = nf(thickness) * nf(width) * nf(length) * nf(pieces) * 7.85e-6;
  const varianceRaw = actualWeight && theoretical > 0
    ? Math.abs(parseFloat(actualWeight) - theoretical) / theoretical * 100
    : null;
  const flagged = varianceRaw !== null && varianceRaw > 0.35;

  useEffect(() => {
    getMukadam().then(setMukadamName);
    if (direction === "outward") {
      apiFetch("/brokers", {}, token).then((d) => setBrokers((d || []).map((b: any) => b.name))).catch(() => setBrokers([]));
    }
  }, [direction, token]);

  const lookupVehicle = useCallback(async (plate: string) => {
    const trimmed = (plate || "").trim().toUpperCase();
    if (!trimmed || trimmed.length < 4) {
      setVehicleHint(null);
      return;
    }
    try {
      const v = await apiFetch(`/vehicles/${encodeURIComponent(trimmed)}`, {}, token);
      if (v?.last_driver || v?.last_phone) {
        setVehicleHint(`Last: ${v.last_driver || "—"}${v.last_phone ? " · " + v.last_phone : ""}`);
        if (!driverName && v.last_driver) setDriverName(v.last_driver);
        if (!driverPhone && v.last_phone) setDriverPhone(v.last_phone);
      } else {
        setVehicleHint(null);
      }
    } catch {
      setVehicleHint(null);
    }
  }, [token, driverName, driverPhone]);

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
      const form = new FormData();
      const name = `slip-${Date.now()}.jpg`;
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        form.append("file", blob, name);
      } else {
        form.append("file", { uri: asset.uri, name, type: "image/jpeg" } as any);
      }
      const up = await apiFetch("/upload", { method: "POST", body: form }, token);
      setPhotoPath(up.path);
      toast("Photo uploaded", "success");
      // Trigger OCR to auto-fill actual weight
      setOcrLoading(true);
      try {
        const ocr = await apiFetch(
          "/vision/weight",
          { method: "POST", body: JSON.stringify({ slip_photo_path: up.path }) },
          token
        );
        if (ocr?.weight_kg != null) {
          setActualWeight(String(ocr.weight_kg));
          setOcrText(ocr.raw || "");
          toast(`📷 Weight read: ${ocr.weight_kg} kg`, "success");
        } else {
          toast("Could not read weight — enter manually", "warning");
        }
      } catch (e: any) {
        // Non-fatal — user can type weight
        toast(`OCR skipped: ${e.message || "no reading"}`, "warning");
      } finally {
        setOcrLoading(false);
      }
    } catch (e: any) {
      toast(e.message || "Upload failed", "error");
      setPhotoUri(null);
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    if (!thickness || !width || !length || !pieces || !vehicle) {
      toast("Fill all required fields", "error");
      return;
    }
    if (direction === "outward" && !broker) {
      toast("Broker name required", "error");
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        thickness_mm: parseFloat(thickness),
        width_mm: parseFloat(width),
        length_mm: parseFloat(length),
        pieces: parseFloat(pieces),
        grade: grade || null,
        vehicle_number: vehicle.toUpperCase(),
        driver_name: driverName || null,
        driver_phone: driverPhone || null,
        mukadam_name: mukadam || null,
        actual_weight_kg: actualWeight ? parseFloat(actualWeight) : null,
        slip_photo_path: photoPath,
        remarks: remarks || null,
      };
      if (direction === "outward") {
        body.broker_name = broker;
        if (prefill?.source_entry_id) body.source_entry_id = prefill.source_entry_id;
      }
      const res = await apiFetch(`/entries/${direction}`, { method: "POST", body: JSON.stringify(body) }, token);
      toast(`Saved: ${res.entry_number}`, "success");
      router.replace("/home");
    } catch (e: any) {
      toast(e.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const titleHi = direction === "inward" ? "आवक एंट्री" : "जावक एंट्री";
  const titleEn = direction === "inward" ? "INWARD ENTRY" : "OUTWARD ENTRY";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Header title={titleEn} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={s.langBanner}>
          <Text style={s.langHi}>{titleHi}</Text>
          <Text style={s.langEn}>{titleEn}</Text>
        </View>

        {mukadam ? (
          <View style={s.mukadamBadge}>
            <Text style={s.mukadamLbl}>मुकादम · WAREHOUSE KEEPER</Text>
            <Text style={s.mukadamName}>{mukadam}</Text>
          </View>
        ) : (
          <Pressable
            testID="mukadam-missing-cta"
            onPress={() => router.push("/mukadam")}
            style={s.mukadamMissing}
          >
            <Text style={s.mukadamMissingTxt}>⚠ SELECT WAREHOUSE KEEPER FIRST →</Text>
          </Pressable>
        )}

        <Text style={s.section}>1. DIMENSIONS / आकार</Text>
        <VoiceInput
          testID="voice-fill"
          onNumbers={(nums) => {
            if (nums[0] != null) setThickness(String(nums[0]));
            if (nums[1] != null) setWidth(String(nums[1]));
            if (nums[2] != null) setLength(String(nums[2]));
          }}
        />
        <BInput testID="input-thickness" label={t("thickness")} value={String(thickness)} onChangeText={setThickness} keyboardType="decimal-pad" suffix="mm" />
        <BInput testID="input-width" label={t("width")} value={String(width)} onChangeText={setWidth} keyboardType="decimal-pad" suffix="mm" />
        <BInput testID="input-length" label={t("length")} value={String(length)} onChangeText={setLength} keyboardType="decimal-pad" suffix="mm" />
        <BInput testID="input-pieces" label={t("pieces")} value={pieces} onChangeText={setPieces} keyboardType="decimal-pad" />
        <BInput testID="input-grade" label={t("grade")} value={grade} onChangeText={setGrade} />

        <Text style={s.section}>2. VEHICLE / वाहन</Text>
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
          <Pressable
            testID="scan-qr-btn"
            onPress={() => setQrOpen(true)}
            style={({ pressed }) => [s.qrBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={s.qrIcon}>⧈</Text>
            <Text style={s.qrLbl}>QR</Text>
          </Pressable>
        </View>
        {vehicleHint ? (
          <Text style={s.vehicleHint} testID="vehicle-hint">↩ {vehicleHint} — autofilled</Text>
        ) : null}
        <BInput testID="input-driver" label="DRIVER NAME · चालक" value={driverName} onChangeText={setDriverName} />
        <BInput testID="input-driver-phone" label="DRIVER PHONE · फोन" value={driverPhone} onChangeText={setDriverPhone} keyboardType="phone-pad" />
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
        {direction === "outward" && (
          <Dropdown
            testID="broker-dropdown"
            label={t("broker")}
            value={broker || null}
            options={brokers}
            onChange={setBroker}
            placeholder="SELECT BROKER · ब्रोकर चुनें"
          />
        )}

        <Text style={s.section}>3. WEIGHT / वजन</Text>
        <View style={s.weightCard}>
          <Text style={s.weightLabel}>{t("theoretical_weight")}</Text>
          <Text style={s.weightValue} testID="theoretical-weight">{theoretical.toFixed(3)} {t("weight_kg")}</Text>
        </View>
        <BInput testID="input-actual-weight" label={t("actual_weight")} value={actualWeight} onChangeText={setActualWeight} keyboardType="decimal-pad" suffix="kg" />
        {ocrLoading ? (
          <View style={s.ocrBanner}><ActivityIndicator color={colors.onSurfaceInverse} /><Text style={s.ocrTxt}>📷 READING SLIP...</Text></View>
        ) : ocrText ? (
          <View style={[s.ocrBanner, { backgroundColor: colors.success }]}><Text style={[s.ocrTxt, { color: colors.onSuccess }]}>✓ OCR: {ocrText}</Text></View>
        ) : null}
        {varianceRaw !== null && (
          <View style={[s.varianceCard, flagged ? s.varianceBad : s.varianceOk]}>
            <Text style={[s.varianceLabel, { color: flagged ? colors.onError : colors.onSuccess }]}>
              {t("variance")}: {varianceRaw.toFixed(3)}%
            </Text>
            {flagged ? (
              <Text style={[s.varianceFlag, { color: colors.onError }]} testID="variance-flag">
                ⚠ {t("flagged_variance")}
              </Text>
            ) : (
              <Text style={[s.varianceFlag, { color: colors.onSuccess }]}>✓ WITHIN TOLERANCE</Text>
            )}
          </View>
        )}

        <Text style={s.section}>4. SLIP PHOTO / स्लिप</Text>
        {photoUri ? (
          <View style={s.photoBox}>
            <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
            {uploading ? (
              <View style={s.photoOverlay}><ActivityIndicator color={colors.onSurfaceInverse} /></View>
            ) : null}
            <Pressable testID="retake-photo" style={s.retakeBtn} onPress={() => { setPhotoUri(null); setPhotoPath(null); }}>
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
  langBanner: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.brand, marginBottom: spacing.lg },
  langHi: { fontSize: 28, fontWeight: "900", color: colors.onBrand },
  langEn: { fontSize: 14, fontWeight: "900", color: colors.onBrand, opacity: 0.9, letterSpacing: 2 },
  section: { fontSize: 12, fontWeight: "900", letterSpacing: 2, color: colors.muted, marginTop: spacing.md, marginBottom: spacing.sm },
  weightCard: { backgroundColor: colors.surfaceInverse, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  weightLabel: { color: colors.onSurfaceInverse, fontSize: 11, fontWeight: "900", letterSpacing: 2, opacity: 0.7 },
  weightValue: { color: colors.onSurfaceInverse, fontSize: 36, fontWeight: "900", fontFamily: "Courier", marginTop: 4 },
  varianceCard: { padding: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  varianceOk: { backgroundColor: colors.success },
  varianceBad: { backgroundColor: colors.error },
  varianceLabel: { fontSize: 14, fontWeight: "900", letterSpacing: 1, fontFamily: "Courier" },
  varianceFlag: { fontSize: 18, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
  photoBox: { position: "relative", borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  photo: { width: "100%", aspectRatio: 1.3, backgroundColor: colors.surfaceSecondary },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  retakeBtn: { position: "absolute", top: 8, right: 8, backgroundColor: colors.surfaceInverse, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1.5, borderColor: colors.borderStrong },
  retakeTxt: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  ocrBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceInverse,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  ocrTxt: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 11, letterSpacing: 1, flexShrink: 1 },
  vehicleRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end", marginBottom: 0 },
  qrBtn: {
    width: 72,
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  qrIcon: { color: colors.onSurfaceInverse, fontSize: 22, fontWeight: "900" },
  qrLbl: { color: colors.onSurfaceInverse, fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  vehicleHint: { fontSize: 11, fontWeight: "900", color: colors.success, letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: -spacing.sm },
  mukadamBadge: { padding: spacing.sm, backgroundColor: colors.brandTertiary, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  mukadamLbl: { fontSize: 10, fontWeight: "800", letterSpacing: 2, color: colors.muted },
  mukadamName: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  mukadamMissing: { padding: spacing.md, backgroundColor: colors.warning, borderWidth: 1.5, borderColor: colors.borderStrong, marginBottom: spacing.md },
  mukadamMissingTxt: { color: colors.onWarning, fontWeight: "800", letterSpacing: 1, fontSize: 13, textAlign: "center" },
});
