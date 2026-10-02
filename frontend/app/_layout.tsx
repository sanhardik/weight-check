import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Platform, StyleSheet, Text, TextInput } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import * as Font from "expo-font";
import { Asset } from "expo-asset";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth";
import { I18nProvider, useI18n } from "@/src/i18n";
import { ToastHost } from "@/src/ui/Toast";
import { TallyReminder } from "@/src/ui/TallyReminder";
import { colors, appFontFamily } from "@/src/theme";

LogBox.ignoreAllLogs(true);

const POPPINS = {
  Poppins: require("../assets/fonts/Poppins-Regular.ttf"),
  "Poppins-SemiBold": require("../assets/fonts/Poppins-SemiBold.ttf"),
  "Poppins-Bold": require("../assets/fonts/Poppins-Bold.ttf"),
  "Poppins-ExtraBold": require("../assets/fonts/Poppins-ExtraBold.ttf"),
};

/**
 * Loads Poppins (with Devanagari glyphs). useFonts() proved flaky on web with
 * local requires, so on web we load explicit FontFaces from the metro asset
 * URLs; native uses expo-font as usual.
 */
function usePoppins(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web") {
          await Promise.all(
            Object.entries(POPPINS).map(async ([name, mod]) => {
              const url = Asset.fromModule(mod).uri;
              const face = new FontFace(name, `url('${url}')`);
              await face.load();
              (document as any).fonts.add(face);
            })
          );
        } else {
          await Font.loadAsync(POPPINS);
        }
      } catch {
        // Font failure must never block the app — system font fallback
      } finally {
        setLoaded(true);
      }
    })();
  }, []);
  return loaded;
}

/**
 * Language-aware default font for every Text / TextInput that does not set an
 * explicit fontFamily: Hindi → Poppins, English → San Francisco (system font on
 * Apple platforms). React 19 dropped defaultProps for function components, so we
 * patch render once and just swap the active family on language change.
 */
function patchComponent(comp: any) {
  if (comp.__fontPatched) return;
  const oldRender = comp.render;
  comp.__oldRender = oldRender;
  comp.__fontPatched = true;
  comp.render = function (props: any, ref: any) {
    const flat = StyleSheet.flatten(props?.style) || {};
    const base: any = {};
    if (!flat.fontFamily && comp.__currentFont) base.fontFamily = comp.__currentFont;
    if (!flat.color) base.color = colors.onSurface;
    const style = Object.keys(base).length ? [base, props.style] : props.style;
    return comp.__oldRender({ ...props, style }, ref);
  };
}

patchComponent(Text);
patchComponent(TextInput);

function FontDefaults({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { lang } = useI18n();
  // Must run synchronously during render (not in useEffect): effects fire after
  // the tree has already rendered, leaving every screen one language-toggle stale.
  if (fontsLoaded) {
    const family = appFontFamily(lang);
    (Text as any).__currentFont = family;
    (TextInput as any).__currentFont = family;
  }
  return null;
}

export default function RootLayout() {
  const loaded = usePoppins();

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <I18nProvider>
                <FontDefaults fontsLoaded={loaded} />
                <TallyReminder />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
                <ToastHost />
              </I18nProvider>
            </AuthProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
