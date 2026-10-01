import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { colors, spacing } from "../theme";

type ToastMsg = { id: number; text: string; type: "info" | "success" | "error" | "warning" };

let push: (msg: Omit<ToastMsg, "id">) => void = () => {};

export function toast(text: string, type: ToastMsg["type"] = "info") {
  push({ text, type });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    push = (m) => {
      idRef.current += 1;
      const id = idRef.current;
      setItems((prev) => [...prev, { ...m, id }]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 3500);
    };
    return () => { push = () => {}; };
  }, []);

  return (
    <View pointerEvents="none" style={s.wrap}>
      {items.map((it) => {
        const bg = it.type === "success" ? colors.success
          : it.type === "error" ? colors.error
          : it.type === "warning" ? colors.warning
          : colors.surfaceInverse;
        const fg = it.type === "warning" ? colors.onWarning : colors.onSurfaceInverse;
        return (
          <View key={it.id} style={[s.toast, { backgroundColor: bg }]} testID={`toast-${it.type}`}>
            <Text style={[s.txt, { color: fg }]}>{it.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", top: 50, left: 0, right: 0, alignItems: "center", zIndex: 9999, gap: spacing.sm },
  toast: {
    maxWidth: "92%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  txt: { fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
});
