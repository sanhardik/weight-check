import { useEffect } from "react";
import { Platform, View, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  // Office staff work from a browser only — send them to the dedicated web portal.
  if (user?.role === "office" && Platform.OS === "web") return <Redirect href="/office" />;
  // Office staff on a phone still get the mobile app, but their default landing
  // is the mobile home. Everyone else: home or login.
  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/home" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
