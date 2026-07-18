export const CAPABILITY_NAMES = ["pi", "task", "schedule", "webhook"] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];
export type CapabilityState = "loading" | "ready" | "degraded" | "error";

export interface CapabilityHealth {
  readonly state: CapabilityState;
  readonly error?: string;
  readonly updatedAt: string;
}

export type CapabilityHealthSnapshot = Readonly<Record<CapabilityName, CapabilityHealth>>;
