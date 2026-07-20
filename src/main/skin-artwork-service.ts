import { join, resolve } from "node:path";
import { isSkinId, SKIN_IDS, type SkinId } from "../shared/skin-artwork";

export const MAX_CUSTOM_SKIN_ARTWORK_BYTES = 25 * 1024 * 1024;

type ArtworkExtension = "png" | "jpg" | "webp";

interface FileMetadata {
  readonly size: number;
  readonly mtimeMs: number;
  isFile(): boolean;
}

export interface SkinArtworkStorage {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  copyFile(source: string, destination: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<FileMetadata>;
  remove(path: string): Promise<void>;
}

export interface StoredSkinArtwork {
  readonly skin: SkinId;
  readonly path: string;
  readonly updatedAt: number;
}

interface SkinArtworkServiceDependencies {
  readonly directory: string;
  readonly storage: SkinArtworkStorage;
}

function extensionFromBytes(bytes: Uint8Array): ArtworkExtension {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return "webp";
  throw new Error("背景图片内容无效，仅支持 PNG、JPEG 或 WebP");
}

function storedFileName(skin: SkinId, extension: ArtworkExtension): string {
  return `${skin}.${extension}`;
}

function parsedStoredFileName(fileName: string): { readonly skin: SkinId; readonly extension: ArtworkExtension } | null {
  for (const skin of SKIN_IDS) {
    for (const extension of ["png", "jpg", "webp"] as const) {
      if (fileName === storedFileName(skin, extension)) return Object.freeze({ skin, extension });
    }
  }
  return null;
}

export class SkinArtworkService {
  readonly #directory: string;
  readonly #storage: SkinArtworkStorage;

  constructor(dependencies: SkinArtworkServiceDependencies) {
    this.#directory = resolve(dependencies.directory);
    this.#storage = dependencies.storage;
  }

  async list(): Promise<readonly StoredSkinArtwork[]> {
    await this.#storage.mkdir(this.#directory);
    const fileNames = [...await this.#storage.readdir(this.#directory)].sort((left, right) => left.localeCompare(right));
    const artworkBySkin = new Map<SkinId, StoredSkinArtwork[]>();
    for (const fileName of fileNames) {
      const parsed = parsedStoredFileName(fileName);
      if (!parsed) continue;
      const path = join(this.#directory, fileName);
      const metadata = await this.#storage.stat(path);
      if (!metadata.isFile()) throw new Error(`自定义背景不是文件: ${path}`);
      const artwork = Object.freeze({ skin: parsed.skin, path, updatedAt: metadata.mtimeMs });
      artworkBySkin.set(parsed.skin, [...(artworkBySkin.get(parsed.skin) ?? []), artwork]);
    }

    const records: StoredSkinArtwork[] = [];
    for (const skin of SKIN_IDS) {
      const candidates = artworkBySkin.get(skin) ?? [];
      if (candidates.length > 1) {
        throw new Error(`皮肤 ${skin} 存在多个自定义背景文件：${candidates.map((candidate) => candidate.path).join("、")}；请删除冲突文件后重试`);
      }
      if (candidates[0]) records.push(candidates[0]);
    }
    return Object.freeze(records);
  }

  async find(skin: SkinId): Promise<StoredSkinArtwork | null> {
    const records = await this.list();
    return records.find((record) => record.skin === skin) ?? null;
  }

  async install(skinValue: unknown, sourcePath: string): Promise<StoredSkinArtwork> {
    if (!isSkinId(skinValue)) throw new Error(`不支持的皮肤: ${String(skinValue)}`);
    const source = resolve(sourcePath);
    const metadata = await this.#storage.stat(source);
    if (!metadata.isFile()) throw new Error(`所选背景不是文件: ${source}`);
    if (metadata.size === 0) throw new Error("所选背景图片为空文件");
    if (metadata.size > MAX_CUSTOM_SKIN_ARTWORK_BYTES) {
      throw new Error(`背景图片不能超过 ${MAX_CUSTOM_SKIN_ARTWORK_BYTES / 1024 / 1024} MB`);
    }

    const extension = extensionFromBytes(await this.#storage.readFile(source));
    await this.#storage.mkdir(this.#directory);
    const destination = join(this.#directory, storedFileName(skinValue, extension));
    if (source !== resolve(destination)) await this.#storage.copyFile(source, destination);
    const copiedExtension = extensionFromBytes(await this.#storage.readFile(destination));
    if (copiedExtension !== extension) throw new Error("背景图片复制后内容校验失败");

    await Promise.all(
      (["png", "jpg", "webp"] as const)
        .filter((candidate) => candidate !== extension)
        .map((candidate) => this.#storage.remove(join(this.#directory, storedFileName(skinValue, candidate)))),
    );
    const storedMetadata = await this.#storage.stat(destination);
    return Object.freeze({ skin: skinValue, path: destination, updatedAt: storedMetadata.mtimeMs });
  }

  async reset(skinValue: unknown): Promise<void> {
    if (!isSkinId(skinValue)) throw new Error(`不支持的皮肤: ${String(skinValue)}`);
    await this.#storage.mkdir(this.#directory);
    await Promise.all(
      (["png", "jpg", "webp"] as const).map((extension) =>
        this.#storage.remove(join(this.#directory, storedFileName(skinValue, extension))),
      ),
    );
  }
}
