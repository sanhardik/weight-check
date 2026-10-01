import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Lang = "en" | "hi";

type Dict = Record<string, { en: string; hi: string }>;

const D: Dict = {
  app_name: { en: "SteelTrack", hi: "SteelTrack" },
  login: { en: "LOGIN", hi: "लॉगिन" },
  logout: { en: "Logout", hi: "लॉगआउट" },
  email: { en: "Email", hi: "ईमेल" },
  password: { en: "Password", hi: "पासवर्ड" },
  sign_in: { en: "SIGN IN", hi: "साइन इन" },
  invalid_credentials: { en: "Invalid email or password", hi: "गलत ईमेल या पासवर्ड" },

  inward: { en: "INWARD", hi: "आवक" },
  outward: { en: "OUTWARD", hi: "जावक" },
  inventory: { en: "INVENTORY", hi: "स्टॉक" },
  entries: { en: "ENTRIES", hi: "एंट्री" },
  settings: { en: "SETTINGS", hi: "सेटिंग" },

  thickness: { en: "Thickness (mm)", hi: "मोटाई (mm)" },
  width: { en: "Width (mm)", hi: "चौड़ाई (mm)" },
  length: { en: "Length (mm)", hi: "लम्बाई (mm)" },
  pieces: { en: "Pieces (e.g. 0.5)", hi: "टुकड़े (जैसे 0.5)" },
  grade: { en: "Grade (optional)", hi: "ग्रेड (वैकल्पिक)" },
  vehicle: { en: "Vehicle Number", hi: "गाड़ी नंबर" },
  broker: { en: "Broker Name", hi: "ब्रोकर नाम" },
  actual_weight: { en: "Actual Weight (kg)", hi: "वास्तविक वजन (kg)" },
  theoretical_weight: { en: "Theoretical Weight", hi: "सैद्धांतिक वजन" },
  variance: { en: "Variance", hi: "अंतर" },
  flagged_variance: { en: "WEIGHT MISMATCH > 0.2%", hi: "वजन अंतर > 0.2%" },
  take_photo: { en: "TAKE PHOTO OF SLIP", hi: "स्लिप का फोटो लें" },
  pick_photo: { en: "PICK FROM GALLERY", hi: "गैलरी से चुनें" },
  retake: { en: "RETAKE", hi: "फिर से लें" },
  save_entry: { en: "SAVE ENTRY", hi: "सहेजें" },
  select_stock: { en: "SELECT STOCK ITEM", hi: "स्टॉक चुनें" },
  available: { en: "Available", hi: "उपलब्ध" },
  no_stock: { en: "No stock available", hi: "कोई स्टॉक नहीं" },

  invoice_no: { en: "Invoice No.", hi: "इनवॉइस नं." },
  party_name: { en: "Party Name", hi: "पार्टी नाम" },
  rate: { en: "Rate (₹)", hi: "दर (₹)" },
  payment_terms: { en: "Payment Terms", hi: "भुगतान शर्तें" },
  office_remarks: { en: "Office Remarks", hi: "ऑफिस टिप्पणी" },
  update_details: { en: "UPDATE DETAILS", hi: "अपडेट करें" },

  entry_no: { en: "Entry No.", hi: "एंट्री नं." },
  created_by: { en: "By", hi: "द्वारा" },
  all: { en: "ALL", hi: "सभी" },
  language: { en: "Language", hi: "भाषा" },
  english: { en: "English", hi: "English" },
  hindi: { en: "Hindi", hi: "हिंदी" },
  users: { en: "USERS", hi: "यूज़र" },
  add_user: { en: "ADD USER", hi: "यूज़र जोड़ें" },
  name: { en: "Name", hi: "नाम" },
  role: { en: "Role", hi: "रोल" },
  create: { en: "CREATE", hi: "बनाएं" },
  cancel: { en: "CANCEL", hi: "रद्द" },
  saving: { en: "SAVING...", hi: "सहेज रहे..." },
  error: { en: "Error", hi: "त्रुटि" },
  weight_kg: { en: "kg", hi: "kg" },
  back: { en: "BACK", hi: "वापस" },
  loading: { en: "Loading...", hi: "लोड हो रहा..." },
  pending_office: { en: "Awaiting office details", hi: "ऑफिस विवरण प्रतीक्षित" },
  complete: { en: "Complete", hi: "पूर्ण" },
  remarks: { en: "Remarks (optional)", hi: "टिप्पणी (वैकल्पिक)" },
  details: { en: "DETAILS", hi: "विवरण" },
  no_entries: { en: "No entries yet", hi: "कोई एंट्री नहीं" },
  dashboard: { en: "DASHBOARD", hi: "डैशबोर्ड" },
  total_items: { en: "Total Items", hi: "कुल आइटम" },
  total_weight: { en: "Total Weight", hi: "कुल वजन" },
  select_action: { en: "Select action", hi: "कार्य चुनें" },
};

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: keyof typeof D) => string;
};

const Ctx = createContext<I18n>({ lang: "en", setLang: () => {}, t: (k) => String(k) });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    AsyncStorage.getItem("st.lang").then((v) => {
      if (v === "en" || v === "hi") setLangState(v);
    });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem("st.lang", l);
  };

  const t = (k: keyof typeof D) => D[k]?.[lang] ?? String(k);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
