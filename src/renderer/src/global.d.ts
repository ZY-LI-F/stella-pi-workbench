import type { StellaDesktopApi } from "../../shared/contracts";

declare global {
  interface Window {
    readonly stella: StellaDesktopApi;
  }
}

export {};
