import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Linking } from "react-native";
import { colors, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
};

export function QRScanner({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const { lang } = useI18n();

  const handleScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScanned((data || "").trim());
    setTimeout(() => setScanned(false), 500);
  };

  const close = () => {
    setScanned(false);
    onClose();
  };

  if (!visible) return null;

  // Web: no camera support
  if (Platform.OS === "web") {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View style={s.backdrop}>
          <View style={s.sheet} testID="qr-scanner-modal">
            <Text style={s.title}>QR SCAN · मोबाइल</Text>
            <Text style={s.hint}>
              {lang === "hi"
                ? "QR स्कैन सिर्फ़ मोबाइल ऐप में काम करता है। Expo Go में फोन से खोलें।"
                : "QR scanning works on the mobile app. Open the preview in Expo Go on your phone to use the camera."}
            </Text>
            <Pressable testID="qr-close-btn" onPress={close} style={s.closeBtn}>
              <Text style={s.closeTxt}>CLOSE</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View style={s.backdrop}>
          <View style={s.sheet} testID="qr-scanner-modal">
            <Text style={s.title}>CAMERA ACCESS</Text>
            <Text style={s.hint}>
              {lang === "hi"
                ? "QR स्कैन करने के लिए कैमरे की अनुमति दें।"
                : "Allow camera access to scan a QR code on the weighment slip."}
            </Text>
            <Pressable
              testID="qr-grant-btn"
              onPress={async () => {
                const r = await requestPermission();
                if (!r.granted && !r.canAskAgain) Linking.openSettings();
              }}
              style={[s.closeBtn, { backgroundColor: colors.brand }]}
            >
              <Text style={[s.closeTxt, { color: colors.onBrand }]}>GRANT CAMERA</Text>
            </Pressable>
            <Pressable testID="qr-close-btn" onPress={close} style={[s.closeBtn, { marginTop: spacing.sm }]}>
              <Text style={s.closeTxt}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: "#000" }} testID="qr-scanner-modal">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={handleScan}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13"] }}
        />
        {/* Overlay */}
        <View pointerEvents="box-none" style={s.overlay}>
          <View style={s.frameTop} />
          <View style={s.frameMid}>
            <View style={s.frameSide} />
            <View style={s.frameBox} />
            <View style={s.frameSide} />
          </View>
          <View style={s.frameBottom}>
            <Text style={s.frameHint}>
              {lang === "hi" ? "QR कोड को फ़्रेम के अंदर रखें" : "ALIGN QR INSIDE THE FRAME"}
            </Text>
            <Pressable testID="qr-close-btn" onPress={close} style={s.closeFloat}>
              <Text style={s.closeTxt}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.borderStrong },
  title: { fontSize: 14, fontWeight: "900", letterSpacing: 2, color: colors.onSurface, marginBottom: spacing.md },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 20, marginBottom: spacing.md },
  closeBtn: { paddingVertical: 12, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceInverse, alignItems: "center" },
  closeTxt: { color: colors.onSurfaceInverse, fontWeight: "900", letterSpacing: 2, fontSize: 13 },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },
  frameTop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  frameMid: { flexDirection: "row", height: 260 },
  frameSide: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  frameBox: { width: 260, borderWidth: 3, borderColor: colors.brand },
  frameBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", paddingTop: spacing.xl, gap: spacing.lg },
  frameHint: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  closeFloat: { paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1.5, borderColor: colors.onBrand, backgroundColor: colors.brand },
});
