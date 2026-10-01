import { useMemo } from "react";
import { Appearance, Platform, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#17324D",
  surfaceSecondary: "#EFF6FC",
  onSurfaceSecondary: "#17324D",
  surfaceTertiary: "#E9F7EF",
  onSurfaceTertiary: "#17324D",
  surfaceInverse: "#17324D",
  onSurfaceInverse: "#FFFFFF",
  muted: "#5D7A94",

  brand: "#3E8FD0",
  onBrand: "#FFFFFF",
  brandPrimary: "#3E8FD0",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#2C74AE",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#DBEBF8",
  onBrandTertiary: "#17324D",

  success: "#3D9E66",
  onSuccess: "#FFFFFF",
  warning: "#E8B54A",
  onWarning: "#4A3808",
  error: "#D9553F",
  onError: "#FFFFFF",
  info: "#3E8FD0",
  onInfo: "#FFFFFF",

  border: "#D6E6F2",
  borderStrong: "#17324D",
  divider: "#D6E6F2",
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
  display: "Poppins-Bold" as string | undefined,
  text: "Poppins" as string | undefined,
  mono: Platform.OS === "ios" ? "Menlo" : "monospace",
};

/** English uses San Francisco (system font on Apple platforms); Hindi uses Poppins. */
export const FONT_EN: string | undefined = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});
export const FONT_HI = "Poppins";
export function appFontFamily(lang: "en" | "hi"): string | undefined {
  return lang === "hi" ? FONT_HI : FONT_EN;
}

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
