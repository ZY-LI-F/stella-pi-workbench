import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
  const [preferences, setPreferences] = usePreferences();
  return (
    <button type="button" onClick={() => setPreferences(Object.freeze({ ...preferences, skin: "chenxi" }))}>
      {preferences.skin}
    </button>
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
  document.documentElement.removeAttribute("data-skin");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
});

describe("preferences", () => {
  it("parses every supported skin and rejects unknown values", () => {
    for (const skin of ["stella", "chenxi", "dingyang", "xuri", "yuehua", "kuroshitsuji", "jojo", "qihun"] as const) {
      expect(parsePreferences(JSON.stringify({ ...LEGACY_PREFERENCES, skin })).skin).toBe(skin);
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
    });

    await user.click(screen.getByRole("button", { name: "stella" }));
    expect(screen.getByRole("button", { name: "chenxi" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null").skin).toBe("chenxi");
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe("chenxi"));
  });
});
