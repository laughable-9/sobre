"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Currency = "PHP" | "USD";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  toggle: () => void;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const STORAGE_KEY = "sobre.displayCurrency";

/**
 * App-wide display-currency toggle. PHP is the household's home currency and
 * the default; USD is the option. Persisted per session so the choice survives
 * in-session navigation. Wrap the dashboard tree in this so the TopBar toggle
 * and every balance surface (envelope cards, total balance, summary) stay in
 * sync from one source of truth.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    if (typeof window === "undefined") return "PHP";
    return sessionStorage.getItem(STORAGE_KEY) === "USD" ? "USD" : "PHP";
  });

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    try {
      sessionStorage.setItem(STORAGE_KEY, c);
    } catch {
      // storage refused; in-memory value still works
    }
  }, []);

  const toggle = useCallback(
    () => setCurrency(currency === "PHP" ? "USD" : "PHP"),
    [currency, setCurrency],
  );

  const value = useMemo(
    () => ({ currency, setCurrency, toggle }),
    [currency, setCurrency, toggle],
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

/**
 * Read the display currency. Returns a safe PHP-only default when used outside
 * a provider (e.g. a card rendered in isolation) so nothing crashes.
 */
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    return { currency: "PHP", setCurrency: () => {}, toggle: () => {} };
  }
  return ctx;
}
