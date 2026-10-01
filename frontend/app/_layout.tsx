import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Platform, Text, View, Pressable } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect } from "react";
import { useFonts } from "expo-font";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth";
import { I18nProvider } from "@/src/i18n";
import { ToastHost } from "@/src/ui/Toast";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  // Nunito Sans — soothing, high-legibility sans with warm humanist curves
  const [loaded] = useFonts({
    NunitoSans: "https://fonts.gstatic.com/s/nunitosans/v15/pe0qMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfGWVpNn64CL7U8upHZIbMV51Q42ptCp7t1R-s.ttf",
    "NunitoSans-Bold": "https://fonts.gstatic.com/s/nunitosans/v15/pe0qMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfGWVpNn64CL7U8upHZIbMV51Q4FptCp7t1R-s.ttf",
  });

  // Set global text defaults once fonts are loaded.
  useEffect(() => {
    if (!loaded) return;
    const txt: any = Text;
    txt.defaultProps = txt.defaultProps || {};
    txt.defaultProps.style = [{ fontFamily: "NunitoSans", color: colors.onSurface }, txt.defaultProps.style];
  }, [loaded]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <I18nProvider>
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
