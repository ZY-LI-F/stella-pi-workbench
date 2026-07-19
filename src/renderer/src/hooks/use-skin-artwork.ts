import { useCallback, useEffect, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";
import {
  isSkinId,
  type SkinArtworkBySkin,
  type SkinArtworkDescriptor,
  type SkinId,
} from "@shared/skin-artwork";

function validatedDescriptor(value: SkinArtworkDescriptor): SkinArtworkDescriptor {
  if (!isSkinId(value.skin)) throw new Error(`自定义背景包含无效皮肤: ${String(value.skin)}`);
  if (!value.url.startsWith("stella-artwork://skin/")) throw new Error(`自定义背景 URL 无效: ${value.url}`);
  if (!Number.isFinite(value.updatedAt)) throw new Error(`自定义背景更新时间无效: ${String(value.updatedAt)}`);
  return Object.freeze({ ...value });
}

export function indexSkinArtwork(values: readonly SkinArtworkDescriptor[]): SkinArtworkBySkin {
  const entries: [SkinId, SkinArtworkDescriptor][] = [];
  const seen = new Set<SkinId>();
  for (const raw of values) {
    const descriptor = validatedDescriptor(raw);
    if (seen.has(descriptor.skin)) throw new Error(`皮肤 ${descriptor.skin} 存在重复的自定义背景`);
    seen.add(descriptor.skin);
    entries.push([descriptor.skin, descriptor]);
  }
  return Object.freeze(Object.fromEntries(entries) as Partial<Record<SkinId, SkinArtworkDescriptor>>);
}

function withoutSkin(artwork: SkinArtworkBySkin, skin: SkinId): SkinArtworkBySkin {
  return Object.freeze(
    Object.fromEntries(Object.entries(artwork).filter(([candidate]) => candidate !== skin)) as Partial<
      Record<SkinId, SkinArtworkDescriptor>
    >,
  );
}

export function useSkinArtwork(api: StellaDesktopApi) {
  const [bySkin, setBySkin] = useState<SkinArtworkBySkin>(Object.freeze({}));
  const [busySkin, setBusySkin] = useState<SkinId | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.skinArtworkInitialize().then((values) => {
      const indexed = indexSkinArtwork(values);
      if (active) setBySkin(indexed);
    }).catch((cause: unknown) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [api]);

  const choose = useCallback(async (skin: SkinId): Promise<boolean> => {
    setBusySkin(skin);
    try {
      const descriptor = await api.chooseSkinArtwork(skin);
      if (!descriptor) return false;
      const validated = validatedDescriptor(descriptor);
      if (validated.skin !== skin) throw new Error(`背景选择返回了错误的皮肤: ${validated.skin}`);
      setBySkin((current) => Object.freeze({ ...current, [skin]: validated }));
      return true;
    } finally {
      setBusySkin(null);
    }
  }, [api]);

  const reset = useCallback(async (skin: SkinId): Promise<void> => {
    setBusySkin(skin);
    try {
      await api.resetSkinArtwork(skin);
      setBySkin((current) => withoutSkin(current, skin));
    } finally {
      setBusySkin(null);
    }
  }, [api]);

  return Object.freeze({
    bySkin,
    busySkin,
    loadError,
    clearLoadError: () => setLoadError(null),
    choose,
    reset,
  });
}
