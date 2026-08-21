"use client";

// Shared UI-language state. This is the cross-tab/cross-component language
// sync mechanism ported from the Task B agent bundle, adapted to APTAMS's
// existing Locale type. It is the single source of truth for the display
// language: Shell reads `lang` from here instead of keeping its own parallel
// state, the language switcher calls `setLang`, and the value is mirrored to a
// `lang` cookie so server-rendered/other tabs stay consistent.
//
// The agent request still sends `locale` (driven by this same value), and the
// signed *session* cookie remains the only source of role. Language is not a
// privilege boundary, so a plain (non-HMAC) cookie is appropriate here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Locale } from "@/lib/aptams/agent";

interface LanguageContextValue {
  lang: Locale;
  setLang: (lang: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

const COOKIE_NAME = "lang";
const COOKIE_MAX_AGE = 31536000; // 1 year
const LOCALES: readonly Locale[] = ["zh", "en", "ko"];

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function readCookieLang(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;)\\s*${COOKIE_NAME}=(\\w+)`),
  );
  const value = match?.[1];
  return isLocale(value) ? value : null;
}

function writeCookieLang(lang: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${lang};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Default to Chinese on the server/first paint; if a cookie exists we sync to
  // it in an effect before any language-dependent fetch so there is no flash.
  const [lang, setLangState] = useState<Locale>("zh");

  useEffect(() => {
    const cookieLang = readCookieLang();
    if (cookieLang) setLangState(cookieLang);
  }, []);

  // Sync from the cookie when the tab becomes visible again (the user may have
  // changed language in another tab) and across tabs via the storage event.
  useEffect(() => {
    const syncFromCookie = () => {
      const cookieLang = readCookieLang();
      if (cookieLang) setLangState(cookieLang);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === COOKIE_NAME && isLocale(e.newValue)) {
        setLangState(e.newValue);
      }
    };
    document.addEventListener("visibilitychange", syncFromCookie);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", syncFromCookie);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLang = useCallback((next: Locale) => {
    setLangState(next);
    writeCookieLang(next);
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
