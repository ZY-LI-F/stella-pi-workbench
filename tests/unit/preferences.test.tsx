import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  LEGACY_PREFERENCES_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  parsePreferences,
  usePreferences,
} from "@renderer/hooks/use-preferences";

const LEGACY_PREFERENCES = Object.freeze({
  theme: "dark" as const,
  density: "comfortable" as const,
  autoRetry: true,
  defaultQueueMode: "steer" as const,
});

function PreferencesHarness() {
  const [preferences, setPreferences, storageError] = usePreferences();
  return (
    <>
      <button type="button" onClick={() => setPreferences(Object.freeze({ ...preferences, skin: "chenxi" }))}>
        {preferences.skin}
      </button>
      {storageError && <p role="alert">{storageError}</p>}
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-skin");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-font-size");
});

describe("preferences", () => {
  it("parses every supported skin and rejects unknown values", () => {
    for (const skin of ["stella", "chenxi", "dingyang", "xuri", "yuehua", "kuroshitsuji", "jojo", "qihun"] as const) {
      expect(parsePreferences(JSON.stringify({ ...LEGACY_PREFERENCES, skin }))).toMatchObject({ skin, fontSize: "default" });
    }
    expect(() => parsePreferences(JSON.stringify({ ...LEGACY_PREFERENCES, skin: "unknown" }))).toThrow(
      `本地偏好 ${PREFERENCES_STORAGE_KEY} 格式无效`,
    );
  });

  it("migrates v1 preferences to Stella and persists skin changes", async () => {
    localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEY, JSON.stringify(LEGACY_PREFERENCES));
    const user = userEvent.setup();
    render(<PreferencesHarness />);

    expect(screen.getByRole("button", { name: "stella" })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe("stella"));
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null")).toEqual({
      ...LEGACY_PREFERENCES,
      skin: "stella",
      fontSize: "default",
    });

    await user.click(screen.getByRole("button", { name: "stella" }));
    expect(screen.getByRole("button", { name: "chenxi" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null").skin).toBe("chenxi");
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe("chenxi"));
  });

  it("uses explicit defaults while preserving corrupted v2 JSON for diagnosis", () => {
    const corrupted = "{corrupted json";
    localStorage.setItem(PREFERENCES_STORAGE_KEY, corrupted);
    expect(() => render(<PreferencesHarness />)).not.toThrow();
    expect(screen.getByRole("button", { name: DEFAULT_PREFERENCES.skin })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("原数据已保留");
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(corrupted);
  });

  it("preserves v2 preferences with an invalid shape and exposes the error", () => {
    const invalid = JSON.stringify({ skin: "unknown", theme: 42 });
    localStorage.setItem(PREFERENCES_STORAGE_KEY, invalid);
    expect(() => render(<PreferencesHarness />)).not.toThrow();
    expect(screen.getByRole("button", { name: DEFAULT_PREFERENCES.skin })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(PREFERENCES_STORAGE_KEY);
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(invalid);
  });

  it("preserves corrupted legacy preferences and exposes the error", () => {
    const corrupted = "not-json";
    localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEY, corrupted);
    expect(() => render(<PreferencesHarness />)).not.toThrow();
    expect(screen.getByRole("button", { name: DEFAULT_PREFERENCES.skin })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("原数据已保留");
    expect(localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY)).toBe(corrupted);
  });

  it("still persists new preferences after recovering from corrupted storage", async () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, "{corrupted json");
    const user = userEvent.setup();
    render(<PreferencesHarness />);
    await user.click(screen.getByRole("button", { name: DEFAULT_PREFERENCES.skin }));
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null").skin).toBe("chenxi");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the in-memory preference unchanged and reports a storage write failure", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota denied"); });
    const user = userEvent.setup();
    render(<PreferencesHarness />);

    await user.click(screen.getByRole("button", { name: DEFAULT_PREFERENCES.skin }));

    expect(screen.getByRole("button", { name: DEFAULT_PREFERENCES.skin })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("quota denied");
  });
});
