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
 * Voice input: 1-8 s capture via expo-audio (native) or MediaRecorder (web).
 * Uploads audio to /api/voice/transcribe and fills Thickness/Width/Length.
 */
export function VoiceInput({ onNumbers, testID = "voice-input" }: Props) {
  const { token } = useAuth();
  const { lang } = useI18n();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [state, setState] = useState<"idle" | "preparing" | "recording" | "uploading">("idle");
  const [lastText, setLastText] = useState<string>("");
  const watchdog = useRef<any>(null);
  const webMediaRecorder = useRef<any>(null);
  const webChunks = useRef<Blob[]>([]);
  const webStream = useRef<MediaStream | null>(null);
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    return () => {
      if (watchdog.current) clearTimeout(watchdog.current);
      try { webStream.current?.getTracks().forEach((t) => t.stop()); } catch {}
      try { if (!isWeb && recorder.isRecording) recorder.stop().catch(() => {}); } catch {}
    };
  }, [recorder, isWeb]);

  const upload = useCallback(async (uri: string, mime: string, filename: string) => {
    const form = new FormData();
    if (isWeb) {
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, filename);
    } else {
      form.append("file", { uri, name: filename, type: mime } as any);
    }
    const res = await apiFetch("/voice/transcribe", { method: "POST", body: form }, token);
    return res as { text: string; numbers: number[] };
  }, [isWeb, token]);

  const finishWithUri = useCallback(async (uri: string, mime: string, filename: string) => {
    setState("uploading");
    try {
      const res = await upload(uri, mime, filename);
      setLastText(res.text || "");
      if (res.numbers && res.numbers.length > 0) {
        onNumbers(res.numbers);
        toast(`✓ ${res.numbers.join(" × ")}`, "success");
      } else {
        toast(res.text ? `Heard: "${res.text}" — no numbers detected` : "No numbers detected", "warning");
      }
    } catch (e: any) {
      toast(e.message || "Voice failed", "error");
    } finally {
      setState("idle");
    }
  }, [onNumbers, upload]);

  const stopNative = useCallback(async () => {
    if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
    try { await recorder.stop(); } catch {}
    const uri = recorder.uri;
    if (!uri) { setState("idle"); toast("No audio captured", "error"); return; }
    await finishWithUri(uri, "audio/m4a", "voice.m4a");
  }, [finishWithUri, recorder]);

  const stopWeb = useCallback(() => {
    if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
    const mr = webMediaRecorder.current;
    if (!mr) { setState("idle"); return; }
    const mime = mr.mimeType || "audio/webm";
    mr.onstop = async () => {
      try {
        webStream.current?.getTracks().forEach((t) => t.stop());
        webStream.current = null;
        const blob = new Blob(webChunks.current, { type: mime });
        webChunks.current = [];
        const url = URL.createObjectURL(blob);
        const ext = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : "mp4";
        await finishWithUri(url, mime, `voice.${ext}`);
        URL.revokeObjectURL(url);
      } catch (e: any) {
        toast(e.message || "Voice failed", "error");
        setState("idle");
      }
    };
    try { mr.stop(); } catch { setState("idle"); }
  }, [finishWithUri]);

  const startWeb = useCallback(async () => {
    try {
      const nav: any = (globalThis as any).navigator;
      if (!nav?.mediaDevices?.getUserMedia) {
        toast("Microphone not available in this browser", "error");
        setState("idle");
        return;
      }
      const stream = await nav.mediaDevices.getUserMedia({ audio: true });
      webStream.current = stream;
      const MR: any = (globalThis as any).MediaRecorder;
      if (!MR) {
        toast("Recording not supported in this browser", "error");
        setState("idle");
        return;
      }
      const mime = MR.isTypeSupported?.("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MR.isTypeSupported?.("audio/mp4") ? "audio/mp4" : "audio/webm");
      const mr = new MR(stream, { mimeType: mime });
      webChunks.current = [];
      mr.ondataavailable = (ev: any) => { if (ev.data && ev.data.size > 0) webChunks.current.push(ev.data); };
      webMediaRecorder.current = mr;
      mr.start();
      setState("recording");
      watchdog.current = setTimeout(() => stopWeb(), 8000);
    } catch (e: any) {
      toast(e.message || "Mic permission denied", "error");
      setState("idle");
    }
  }, [stopWeb]);

  const startNative = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { toast("Microphone permission denied", "error"); setState("idle"); return; }
      await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState("recording");
      watchdog.current = setTimeout(() => stopNative(), 8000);
    } catch (e: any) {
      toast(e.message || "Could not start recording", "error");
      setState("idle");
    }
  }, [recorder, stopNative]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("preparing");
    if (isWeb) await startWeb();
    else await startNative();
  }, [isWeb, startNative, startWeb, state]);

  const toggle = () => {
    if (state === "recording") {
      if (isWeb) stopWeb();
      else stopNative();
    } else start();
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
        {state === "uploading" ? <ActivityIndicator color={fg} /> : null}
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
  lbl: { fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  hint: { fontSize: 11, color: colors.muted, fontStyle: "italic", marginBottom: spacing.sm, letterSpacing: 0.3 },
});
