import type { SkinId } from "@shared/skin-artwork";

export type SkinPreference = SkinId;

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
  Object.freeze({
    value: "xuri",
    label: "旭日",
    subtitle: "海上金轮",
    description: "朱砂日轮、矿物山海与克制金箔。",
    inspiration: "Ukiyo-e · Mineral Gold",
  }),
  Object.freeze({
    value: "yuehua",
    label: "月华",
    subtitle: "银蓝月湖",
    description: "月路、流云与冰晶花影交叠。",
    inspiration: "Ink Wash · Moon Glass",
  }),
  Object.freeze({
    value: "kuroshitsuji",
    label: "黑执事",
    subtitle: "暗夜契约",
    description: "维多利亚银器、雨夜庄园与深红玫瑰。",
    inspiration: "Victorian Gothic · Dark Academia",
  }),
  Object.freeze({
    value: "jojo",
    label: "JOJO",
    subtitle: "杜王与黄金",
    description: "粉紫郊町、意式金饰与漫画张力。",
    inspiration: "Morioh Color · Italian Gold",
  }),
  Object.freeze({
    value: "qihun",
    label: "棋魂",
    subtitle: "神之一手",
    description: "黑白棋子、银杏墨雾与古老棋枰。",
    inspiration: "Go Board · Ginkgo Ink",
  }),
]);

export function skinDefinition(value: SkinPreference): SkinDefinition {
  const definition = SKIN_OPTIONS.find((candidate) => candidate.value === value);
  if (!definition) throw new Error(`未知皮肤: ${value}`);
  return definition;
}
