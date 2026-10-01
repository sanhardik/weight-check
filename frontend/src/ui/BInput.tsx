import React from "react";
import { View, Text, TextInput, StyleSheet, TextInputProps } from "react-native";
import { colors, spacing } from "../theme";

type Props = TextInputProps & {
  label: string;
  suffix?: string;
  testID?: string;
};

export function BInput({ label, suffix, testID, style, ...rest }: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <View style={s.row}>
        <TextInput
          {...rest}
          testID={testID}
          placeholderTextColor={colors.muted}
          style={[s.input, style]}
        />
        {suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "900", color: colors.onSurface, marginBottom: 6, letterSpacing: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    color: colors.onSurface,
    fontFamily: "Courier",
    fontWeight: "700",
  },
  suffix: {
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.muted,
    fontWeight: "900",
  },
});
