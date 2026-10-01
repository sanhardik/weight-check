import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Platform } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect } from "react";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth";
import { I18nProvider } from "@/src/i18n";
import { ToastHost } from "@/src/ui/Toast";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  // Keep existing icon prewarming logic preserved (none specific present now).
  useEffect(() => {
    // Prewarm placeholder (asset prewarm hook used in template)
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <I18nProvider>
                <Stack screenOptions={{ headerShown: false }} />
                <ToastHost />
              </I18nProvider>
            </AuthProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
