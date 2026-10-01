import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio";
import { colors, spacing } from "@/src/theme";
import { useAuth, apiFetch } from "@/src/auth";
import { toast } from "@/src/ui/Toast";
import { useI18n } from "@/src/i18n";

type Props = {
  onNumbers: (nums: number[]) => void;
  testID?: string;
};

/**
 * Voice input that captures 1–8 seconds of speech, uploads to backend,
 * and returns up to 3 numbers (Thickness / Width / Length) parsed from
 * the Hindi or English transcript.
 */
export function VoiceInput({ onNumbers, testID = "voice-input" }: Props) {
  const { token } = useAuth();
  const { lang } = useI18n();
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const [state, setState] = useState<"idle" | "preparing" | "recording" | "uploading">("idle");
  const [lastText, setLastText] = useState<string>("");
  const watchdog = useRef<any>(null);
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    return () => {
      if (watchdog.current) clearTimeout(watchdog.current);
      try {
        if (recorder.isRecording) recorder.stop().catch(() => {});
      } catch {
        /* already released */
      }
    };
  }, [recorder]);

  const upload = useCallback(async (uri: string) => {
    const form = new FormData();
    const name = "voice.m4a";
    if (isWeb) {
      try {
        const blob = await (await fetch(uri)).blob();
        form.append("file", blob, name);
      } catch (e: any) {
        throw new Error("Audio capture not supported in this browser preview");
      }
    } else {
      form.append("file", { uri, name, type: "audio/m4a" } as any);
    }
    const res = await apiFetch("/voice/transcribe", { method: "POST", body: form }, token);
    return res as { text: string; numbers: number[] };
  }, [isWeb, token]);

  const stopAndSend = useCallback(async () => {
    if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
    try {
      await recorder.stop();
    } catch {
      /* ignore */
    }
    const uri = recorder.uri;
    if (!uri) {
      setState("idle");
      toast("No audio captured", "error");
      return;
    }
    setState("uploading");
    try {
      const res = await upload(uri);
      setLastText(res.text || "");
      if (res.numbers && res.numbers.length > 0) {
        onNumbers(res.numbers);
        toast(`✓ ${res.numbers.join(" × ")}`, "success");
      } else {
        toast(res.text ? `Heard: "${res.text}" — no numbers detected` : "Could not hear numbers", "warning");
      }
    } catch (e: any) {
      toast(e.message || "Voice failed", "error");
    } finally {
      setState("idle");
    }
  }, [onNumbers, recorder, upload]);

  const startRecording = useCallback(async () => {
    if (isWeb) {
      toast("Voice entry works on mobile builds — try Expo Go on your phone", "warning");
      return;
    }
    if (state !== "idle") return;
    setState("preparing");
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        toast("Microphone permission denied", "error");
        setState("idle");
        return;
      }
      await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState("recording");
      // Max duration watchdog: 8 seconds auto-stop
      watchdog.current = setTimeout(() => {
        stopAndSend();
      }, 8000);
    } catch (e: any) {
      toast(e.message || "Could not start recording", "error");
      setState("idle");
    }
  }, [isWeb, recorder, state, stopAndSend]);

  const toggle = () => {
    if (state === "recording") stopAndSend();
    else startRecording();
  };

  const label =
    state === "recording" ? (lang === "hi" ? "🎙 बोलिए... टैप करके रोकें" : "🎙 LISTENING... TAP TO STOP") :
    state === "preparing" ? "..." :
    state === "uploading" ? (lang === "hi" ? "समझ रहे..." : "TRANSCRIBING...") :
    (lang === "hi" ? "🎙 बोलकर भरें (मोटाई, चौड़ाई, लम्बाई)" : "🎙 SPEAK T × W × L");

  const bg = state === "recording" ? colors.error : state === "idle" ? colors.surfaceInverse : colors.surfaceSecondary;
  const fg = state === "recording" ? colors.onError : state === "idle" ? colors.onSurfaceInverse : colors.onSurface;

  return (
    <View>
      <Pressable
        testID={testID}
        onPress={toggle}
        disabled={state === "preparing" || state === "uploading"}
        style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }]}
      >
        {state === "uploading" ? (
          <ActivityIndicator color={fg} />
        ) : null}
        <Text style={[styles.lbl, { color: fg }]}>{label}</Text>
      </Pressable>
      {lastText ? (
        <Text style={styles.hint} testID="voice-last-text">"{lastText}"</Text>
      ) : (
        <Text style={styles.hint}>
          {lang === "hi" ? "उदाहरण: दस बारह सौ पचास पच्चीस सौ" : "e.g. ten twelve fifty twenty five hundred"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    marginBottom: spacing.xs,
  },
  lbl: { fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  hint: { fontSize: 11, color: colors.muted, fontStyle: "italic", marginBottom: spacing.sm, letterSpacing: 0.5 },
});
