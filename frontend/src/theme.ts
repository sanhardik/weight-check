import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FAF9F6",
  onSurface: "#1C1B1A",
  surfaceSecondary: "#F2EFEA",
  onSurfaceSecondary: "#1C1B1A",
  surfaceTertiary: "#E6E1D7",
  onSurfaceTertiary: "#1C1B1A",
  surfaceInverse: "#1C1B1A",
  onSurfaceInverse: "#FAF9F6",
  muted: "#6B6760",

  brand: "#D96A3A",
  onBrand: "#FFFFFF",
  brandPrimary: "#D96A3A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#B9542A",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#F6DCC9",
  onBrandTertiary: "#1C1B1A",

  success: "#4F7D4E",
  onSuccess: "#FFFFFF",
  warning: "#D9A33A",
  onWarning: "#1C1B1A",
  error: "#C44A3A",
  onError: "#FFFFFF",
  info: "#3A6EA5",
  onInfo: "#FFFFFF",

  border: "#D9D4CB",
  borderStrong: "#1C1B1A",
  divider: "#D9D4CB",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export const colors = light;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const fonts = {
  display: "NunitoSans-Bold" as string | undefined,
  text: "NunitoSans" as string | undefined,
  mono: "Menlo",
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
