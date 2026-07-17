export type SkinPreference = "stella" | "chenxi" | "dingyang";

export interface SkinDefinition {
  readonly value: SkinPreference;
  readonly label: string;
  readonly subtitle: string;
  readonly description: string;
  readonly inspiration: string;
}

export const SKIN_OPTIONS: readonly SkinDefinition[] = Object.freeze([
  Object.freeze({
    value: "stella",
    label: "Stella",
    subtitle: "夜航星图",
    description: "鸢尾星轨、柔光玻璃与手写签名。",
    inspiration: "Codex · Dream Skin",
  }),
  Object.freeze({
    value: "chenxi",
    label: "晨曦",
    subtitle: "纸上初光",
    description: "雾面纸艺、山岚层叠与杏色晨光。",
    inspiration: "Rosé Pine Dawn",
  }),
  Object.freeze({
    value: "dingyang",
    label: "定阳",
    subtitle: "日晷制图",
    description: "矿物版画、太阳刻度与几何秩序。",
    inspiration: "Solarized · Trianglify",
  }),
]);

export function skinDefinition(value: SkinPreference): SkinDefinition {
  const definition = SKIN_OPTIONS.find((candidate) => candidate.value === value);
  if (!definition) throw new Error(`未知皮肤: ${value}`);
  return definition;
}
