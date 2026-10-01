import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal } from "react-native";
import { colors, spacing } from "@/src/theme";

type Props = {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
  loading?: boolean;
  disabled?: boolean;
};

export function Dropdown({ label, value, options, onChange, placeholder = "SELECT", testID, loading, disabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <Pressable
        testID={testID}
        onPress={() => !disabled && setOpen(true)}
        style={({ pressed }) => [s.trigger, { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
      >
        <Text style={[s.triggerTxt, !value && { color: colors.muted }]} numberOfLines={1}>
          {loading ? "LOADING..." : (value || placeholder)}
        </Text>
        <Text style={s.caret}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>{label.toUpperCase()}</Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: spacing.xs }}>
              {options.length === 0 ? (
                <Text style={s.empty}>No options available</Text>
              ) : (
                options.map((o) => (
                  <Pressable
                    key={o}
                    testID={`${testID}-opt-${o}`}
                    onPress={() => { onChange(o); setOpen(false); }}
                    style={[s.option, value === o && s.optionActive]}
                  >
                    <Text style={[s.optionTxt, value === o && { color: colors.onBrand }]}>{o}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable testID={`${testID}-close`} onPress={() => setOpen(false)} style={s.close}>
              <Text style={s.closeTxt}>CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "700", color: colors.onSurface, marginBottom: 6, letterSpacing: 1 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  triggerTxt: { fontSize: 16, color: colors.onSurface, fontWeight: "700", flex: 1 },
  caret: { fontSize: 14, color: colors.muted, fontWeight: "900", marginLeft: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, borderTopWidth: 1.5, borderColor: colors.borderStrong },
  sheetTitle: { fontSize: 14, fontWeight: "800", letterSpacing: 2, color: colors.onSurface, marginBottom: spacing.sm },
  option: { paddingVertical: 14, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  optionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  optionTxt: { fontSize: 15, color: colors.onSurface, fontWeight: "700" },
  empty: { fontSize: 12, color: colors.muted, padding: spacing.md, textAlign: "center" },
  close: { marginTop: spacing.md, paddingVertical: 12, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  closeTxt: { color: colors.onSurface, fontWeight: "800", letterSpacing: 2, fontSize: 12 },
});
