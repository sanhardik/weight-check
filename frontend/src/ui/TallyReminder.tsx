import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router, usePathname } from "expo-router";
import { useAuth, apiFetch } from "@/src/auth";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";

/**
 * Persistent reminder for labour users until today's 2 physical-tally items are
 * both submitted. Shown on every labour-visible screen except /verify itself.
 */
export function TallyReminder() {
  const { user, token } = useAuth();
  const { t } = useI18n();
  const pathname = usePathname();
  const [done, setDone] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const shouldRun = !!user && user.role === "labour" && !!token && !pathname?.startsWith("/verify");

  useEffect(() => {
    if (!shouldRun) { setDone(null); setTotal(null); return; }
    let alive = true;
    const fetchTally = () =>
      apiFetch("/verifications/today", {}, token)
        .then((d) => { if (alive) { setDone(d.done || 0); setTotal(d.total || 0); } })
        .catch(() => {});
    fetchTally();
    const iv = setInterval(fetchTally, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [shouldRun, token, pathname]);

  if (!shouldRun || done === null || total === null || total === 0 || done >= total) return null;

  const remaining = total - done;
  return (
    <Pressable
      testID="tally-reminder-banner"
      style={s.banner}
      onPress={() => router.push("/verify")}
    >
      <Text style={s.txt}>⚠ {t("daily_tally")} · {remaining} ITEM{remaining !== 1 ? "S" : ""} PENDING — TAP TO COMPLETE →</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  banner: {
    backgroundColor: colors.error,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.borderStrong,
  },
  txt: { color: colors.onError, fontWeight: "900", fontSize: 12, letterSpacing: 1, textAlign: "center" },
});
