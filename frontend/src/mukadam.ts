// Lightweight AsyncStorage wrapper around the selected Mukadam name
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "he.mukadam";

export async function getMukadam(): Promise<string | null> {
  return (await AsyncStorage.getItem(KEY)) || null;
}

export async function setMukadam(name: string | null): Promise<void> {
  if (name) await AsyncStorage.setItem(KEY, name);
  else await AsyncStorage.removeItem(KEY);
}
