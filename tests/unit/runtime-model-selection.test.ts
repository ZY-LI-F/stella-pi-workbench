import { describe, expect, it } from "vitest";
import {
  resolveAgentRuntimeModel,
  runtimeModelSelectionFromSession,
} from "../../src/shared/runtime-model";

describe("runtime model selection", () => {
  it("maps the current Pi model into the immutable global execution default", () => {
    const selected = runtimeModelSelectionFromSession({ provider: "anthropic", id: "claude-sonnet" });

    expect(selected).toEqual({ provider: "anthropic", model: "claude-sonnet" });
    expect(Object.isFrozen(selected)).toBe(true);
  });

  it("rejects incomplete model identities instead of hiding protocol errors", () => {
    expect(() => runtimeModelSelectionFromSession({ provider: "", id: "model" })).toThrow(
      "Pi 当前模型缺少 provider 或 model id",
    );
  });

  it("inherits the global model only when the Agent has no explicit override", () => {
    const globalSelection = Object.freeze({ provider: "openai", model: "gpt-global" });

    expect(resolveAgentRuntimeModel({}, globalSelection)).toEqual(globalSelection);
    expect(resolveAgentRuntimeModel({ provider: "anthropic", model: "claude-agent" }, globalSelection)).toEqual({
      provider: "anthropic",
      model: "claude-agent",
    });
    expect(resolveAgentRuntimeModel({ provider: "custom" }, globalSelection)).toEqual({
      provider: "custom",
      model: undefined,
    });
  });
});
