import { useEffect, useState } from "react";
import { isSkinId } from "@shared/skin-artwork";
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
    isSkinId(record.skin) &&
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

interface LoadedPreferences {
  readonly preferences: Preferences;
  readonly storageError?: string;
}

function storageFailure(action: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `${action}：${detail}`;
}

export function parsePreferences(raw: string, storageKey = PREFERENCES_STORAGE_KEY): Preferences {
  const parsed = JSON.parse(raw) as unknown;
  if (!isPreferences(parsed)) throw new Error(`本地偏好 ${storageKey} 格式无效`);
  return Object.freeze({ ...parsed });
}

function loadPreferences(): LoadedPreferences {
  let stored: string | null;
  try {
    stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
  } catch (cause) {
    return Object.freeze({
      preferences: DEFAULT_PREFERENCES,
      storageError: storageFailure("无法读取本地偏好，当前页面暂用默认值", cause),
    });
  }

  if (stored !== null) {
    try {
      return Object.freeze({ preferences: parsePreferences(stored) });
    } catch (cause) {
      return Object.freeze({
        preferences: DEFAULT_PREFERENCES,
        storageError: storageFailure(`本地偏好 ${PREFERENCES_STORAGE_KEY} 已损坏，原数据已保留`, cause),
      });
    }
  }

  let legacyStored: string | null;
  try {
    legacyStored = localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY);
  } catch (cause) {
    return Object.freeze({
      preferences: DEFAULT_PREFERENCES,
      storageError: storageFailure("无法读取旧版本地偏好，当前页面暂用默认值", cause),
    });
  }
  if (legacyStored === null) return Object.freeze({ preferences: DEFAULT_PREFERENCES });

  let migrated: Preferences;
  try {
    const legacy = JSON.parse(legacyStored) as unknown;
    if (!isLegacyPreferences(legacy)) throw new Error(`本地偏好 ${LEGACY_PREFERENCES_STORAGE_KEY} 格式无效`);
    migrated = Object.freeze({ ...legacy, skin: "stella" as const });
  } catch (cause) {
    return Object.freeze({
      preferences: DEFAULT_PREFERENCES,
      storageError: storageFailure(`旧版本地偏好 ${LEGACY_PREFERENCES_STORAGE_KEY} 已损坏，原数据已保留`, cause),
    });
  }

  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(migrated));
    return Object.freeze({ preferences: migrated });
  } catch (cause) {
    return Object.freeze({
      preferences: migrated,
      storageError: storageFailure(`旧版偏好已读取，但无法写入 ${PREFERENCES_STORAGE_KEY}`, cause),
    });
  }
}

export function usePreferences(): readonly [Preferences, (next: Preferences) => void, string | undefined] {
  const [loaded] = useState<LoadedPreferences>(loadPreferences);
  const [preferences, setPreferencesState] = useState<Preferences>(loaded.preferences);
  const [storageError, setStorageError] = useState<string | undefined>(loaded.storageError);

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
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(frozen));
    } catch (cause) {
      setStorageError(storageFailure(`无法写入本地偏好 ${PREFERENCES_STORAGE_KEY}`, cause));
      return;
    }
    setPreferencesState(frozen);
    setStorageError(undefined);
  };

  return [preferences, setPreferences, storageError] as const;
}
