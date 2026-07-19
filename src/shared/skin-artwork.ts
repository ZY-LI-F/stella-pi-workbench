export const SKIN_IDS = Object.freeze([
  "stella",
  "chenxi",
  "dingyang",
  "xuri",
  "yuehua",
  "kuroshitsuji",
  "jojo",
  "qihun",
] as const);

export type SkinId = (typeof SKIN_IDS)[number];

export interface SkinArtworkDescriptor {
  readonly skin: SkinId;
  readonly url: string;
  readonly updatedAt: number;
}

export type SkinArtworkBySkin = Readonly<Partial<Record<SkinId, SkinArtworkDescriptor>>>;

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === "string" && (SKIN_IDS as readonly string[]).includes(value);
}
