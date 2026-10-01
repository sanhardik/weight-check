import React from "react";
import { Pressable, Text, StyleSheet, ActivityIndicator, View, PressableProps } from "react-native";
import { colors, spacing } from "../theme";

type Props = {
  label: string;
  subLabel?: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  icon?: React.ReactNode;
};

export function BButton({ label, subLabel, onPress, variant = "primary", size = "md", loading, disabled, testID, icon }: Props) {
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.surface,
    ghost: colors.surfaceSecondary,
    danger: colors.error,
  }[variant];
  const fg = {
    primary: colors.onBrandPrimary,
    secondary: colors.onSurface,
    ghost: colors.onSurface,
    danger: colors.onError,
  }[variant];
  const minH = { sm: 44, md: 52, lg: 64, xl: 80 }[size];
  const fs = { sm: 14, md: 16, lg: 20, xl: 24 }[size];

  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      testID={testID}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: bg,
          minHeight: minH,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={s.row}>
          {icon}
          <View style={{ alignItems: "center" }}>
            <Text style={[s.label, { color: fg, fontSize: fs }]}>{label}</Text>
            {subLabel ? <Text style={[s.sub, { color: fg }]}>{subLabel}</Text> : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { fontWeight: "900", letterSpacing: 0.5, textAlign: "center" },
  sub: { fontSize: 12, marginTop: 2, opacity: 0.9, letterSpacing: 0.5 },
});
