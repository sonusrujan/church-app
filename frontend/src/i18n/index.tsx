import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

import en from "./en.json";
import hi from "./hi.json";
import ta from "./ta.json";
import te from "./te.json";
import ml from "./ml.json";
import kn from "./kn.json";

// ── Types ──

export type SupportedLanguage = "en" | "hi" | "ta" | "te" | "ml" | "kn";

export const LANGUAGES: { code: SupportedLanguage; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
  { code: "te", label: "Telugu", nativeLabel: "తెలుగు" },
  { code: "ml", label: "Malayalam", nativeLabel: "മലയാളം" },
  { code: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ" },
];

type TranslationValue = string | Record<string, string>;
type TranslationMap = Record<string, Record<string, TranslationValue>>;

const translations: Record<SupportedLanguage, TranslationMap> = { en, hi, ta, te, ml, kn };

// ── Context ──

interface I18nContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  hasChosenLanguage: boolean;
  markLanguageChosen: () => void;
}

const I18nContext = createContext<I18nContextValue>({
  language: "en",
  setLanguage: () => {},
  t: (key) => key,
  hasChosenLanguage: false,
  markLanguageChosen: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

// ── Helper ──

const STORAGE_KEY = "shalom_language";
const CHOSEN_KEY = "shalom_language_chosen";

function getNestedValue(obj: TranslationMap, key: string): string | undefined {
  const parts = key.split(".");
  if (parts.length === 2) {
    const val = obj[parts[0]]?.[parts[1]];
    return typeof val === "string" ? val : undefined;
  }
  if (parts.length === 3) {
    const section = obj[parts[0]]?.[parts[1]];
    if (section && typeof section === "object") return section[parts[2]];
  }
  return undefined;
}

// ── Provider ──

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in translations) return stored as SupportedLanguage;
    return "en";
  });

  const [hasChosenLanguage, setHasChosenLanguage] = useState(() => {
    return localStorage.getItem(CHOSEN_KEY) === "true";
  });

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const markLanguageChosen = useCallback(() => {
    setHasChosenLanguage(true);
    localStorage.setItem(CHOSEN_KEY, "true");
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let value = getNestedValue(translations[language], key);
      // Fallback to English
      if (!value) value = getNestedValue(translations.en, key);
      if (!value) return key;

      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
        }
      }
      return value;
    },
    [language]
  );

  // Sync to document for CSS font adjustments if needed
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, hasChosenLanguage, markLanguageChosen }}>
      {children}
    </I18nContext.Provider>
  );
}
