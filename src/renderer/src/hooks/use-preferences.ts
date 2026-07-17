import { useEffect, useState } from "react";
import type { SkinPreference } from "../lib/skins";

export type ThemePreference = "system" | "dark" | "light";
export type DensityPreference = "comfortable" | "compact";

export interface Preferences {
  readonly skin: SkinPreference;
  readonly theme: ThemePreference;
  readonly density: DensityPreference;
  readonly autoRetry: boolean;
  readonly defaultQueueMode: "steer" | "followUp";
}

export const PREFERENCES_STORAGE_KEY = "stella.preferences.v2";
export const LEGACY_PREFERENCES_STORAGE_KEY = "stella.preferences.v1";
export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  skin: "stella",
  theme: "dark",
  density: "comfortable",
  autoRetry: true,
  defaultQueueMode: "steer",
});

function isPreferences(value: unknown): value is Preferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.skin === "stella" || record.skin === "chenxi" || record.skin === "dingyang") &&
    (record.theme === "system" || record.theme === "dark" || record.theme === "light") &&
    (record.density === "comfortable" || record.density === "compact") &&
    typeof record.autoRetry === "boolean" &&
    (record.defaultQueueMode === "steer" || record.defaultQueueMode === "followUp")
  );
}

type LegacyPreferences = Omit<Preferences, "skin">;

function isLegacyPreferences(value: unknown): value is LegacyPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.theme === "system" || record.theme === "dark" || record.theme === "light") &&
    (record.density === "comfortable" || record.density === "compact") &&
    typeof record.autoRetry === "boolean" &&
    (record.defaultQueueMode === "steer" || record.defaultQueueMode === "followUp")
  );
}

export function parsePreferences(raw: string, storageKey = PREFERENCES_STORAGE_KEY): Preferences {
  const parsed = JSON.parse(raw) as unknown;
  if (!isPreferences(parsed)) throw new Error(`本地偏好 ${storageKey} 格式无效`);
  return Object.freeze({ ...parsed });
}

function loadPreferences(): Preferences {
  const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
  if (stored) return parsePreferences(stored);

  const legacyStored = localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY);
  if (!legacyStored) return DEFAULT_PREFERENCES;
  const legacy = JSON.parse(legacyStored) as unknown;
  if (!isLegacyPreferences(legacy)) throw new Error(`本地偏好 ${LEGACY_PREFERENCES_STORAGE_KEY} 格式无效`);
  const migrated = Object.freeze({ ...legacy, skin: "stella" as const });
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

export function usePreferences(): readonly [Preferences, (next: Preferences) => void] {
  const [preferences, setPreferencesState] = useState<Preferences>(loadPreferences);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.theme = preferences.theme === "system" ? (media.matches ? "dark" : "light") : preferences.theme;
      root.dataset.density = preferences.density;
      root.dataset.skin = preferences.skin;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [preferences.density, preferences.skin, preferences.theme]);

  const setPreferences = (next: Preferences) => {
    const frozen = Object.freeze({ ...next });
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(frozen));
    setPreferencesState(frozen);
  };

  return [preferences, setPreferences] as const;
}
