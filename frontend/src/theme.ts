import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#111111",
  surfaceSecondary: "#F4F4F5",
  onSurfaceSecondary: "#111111",
  surfaceTertiary: "#E4E4E7",
  onSurfaceTertiary: "#111111",
  surfaceInverse: "#111111",
  onSurfaceInverse: "#FFFFFF",
  muted: "#52525B",

  brand: "#FF4500",
  onBrand: "#FFFFFF",
  brandPrimary: "#FF4500",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E63E00",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FFDACC",
  onBrandTertiary: "#111111",

  success: "#008A00",
  onSuccess: "#FFFFFF",
  warning: "#FFB300",
  onWarning: "#111111",
  error: "#E50000",
  onError: "#FFFFFF",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",

  border: "#E4E4E7",
  borderStrong: "#111111",
  divider: "#E4E4E7",
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
  display: undefined as string | undefined, // SpaceGrotesk if loaded
  mono: "Courier",
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
