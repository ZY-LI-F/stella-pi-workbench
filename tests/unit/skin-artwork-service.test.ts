// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { SkinArtworkService, type SkinArtworkStorage } from "../../src/main/skin-artwork-service";

const DIRECTORY = "C:/skin-artwork";

class FakeStorage implements SkinArtworkStorage {
  constructor(readonly entries: ReadonlyMap<string, number>) {}
  async mkdir(): Promise<void> { return undefined; }
  async readFile(): Promise<Uint8Array> { throw new Error("测试不读取文件内容"); }
  async copyFile(): Promise<void> { throw new Error("测试不复制文件"); }
  async readdir(): Promise<readonly string[]> { return [...this.entries.keys()]; }
  async stat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean }> {
    const name = [...this.entries.keys()].find((candidate) => path === join(resolve(DIRECTORY), candidate));
    if (name === undefined) throw new Error(`文件不存在: ${path}`);
    const mtimeMs = this.entries.get(name) ?? 0;
    return { size: 1, mtimeMs, isFile: () => true };
  }
  async remove(): Promise<void> { return undefined; }
}

describe("SkinArtworkService", () => {
  it("reports duplicate artwork files deterministically instead of choosing one", async () => {
    for (const entries of [
      new Map([["stella.png", 100], ["stella.webp", 200]]),
      new Map([["stella.webp", 200], ["stella.png", 100]]),
    ]) {
      const service = new SkinArtworkService({ directory: DIRECTORY, storage: new FakeStorage(entries) });
      await expect(service.list()).rejects.toThrow(/皮肤 stella 存在多个自定义背景文件：.*stella\.png.*stella\.webp/);
    }
  });

  it("returns the sole artwork for each skin in catalog order", async () => {
    const storage = new FakeStorage(new Map([
      ["chenxi.jpg", 50],
      ["stella.webp", 200],
    ]));
    const service = new SkinArtworkService({ directory: DIRECTORY, storage });

    const records = await service.list();

    expect(records.map((record) => record.skin)).toEqual(["stella", "chenxi"]);
    expect(records[0]).toMatchObject({ updatedAt: 200 });
    expect(records[0]?.path.endsWith("stella.webp")).toBe(true);
  });
});
