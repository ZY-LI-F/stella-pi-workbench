// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AutopilotService } from "../../src/main/autopilot-service";
import type { BoardRepository } from "../../src/main/board-repository";
import {
  WebhookServer,
  webhookMaxBytesFromEnvironment,
  webhookPortFromEnvironment,
} from "../../src/main/webhook-server";
import {
  EMPTY_BOARD_STATE,
  parseBoardState,
  type BoardBootstrap,
  type BoardBridgeEvent,
  type BoardState,
  type CreateAutopilotInput,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `webhook-id-${String(++value).padStart(3, "0")}`;
}

function webhookInput(enabled = true): CreateAutopilotInput {
  return Object.freeze({
    name: "本机构建回调",
    enabled,
    trigger: Object.freeze({ kind: "webhook" }),
    taskTemplate: Object.freeze({
      title: "处理本机回调",
      description: "读取触发上下文",
      acceptanceCriteria: "保存处理结果",
      priority: "high",
    }),
    projectPath: "C:/project",
    projectName: "project",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
  });
}

async function setup(options: {
  readonly maxBodyBytes?: number;
  readonly enabled?: boolean;
  readonly dispatch?: (taskId: string) => Promise<BoardBootstrap>;
} = {}) {
  const repository = new MemoryRepository();
  const events: BoardBridgeEvent[] = [];
  const service = new AutopilotService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    dispatchTask: options.dispatch ?? (async () => Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG })),
    emitChanged: () => undefined,
    id: idFactory(),
    token: () => "fixed-secret-token",
    now: () => "2026-07-18T12:00:00.000Z",
  });
  await service.create(webhookInput(options.enabled));
  const server = new WebhookServer({
    autopilotService: service,
    emitBoardEvent: (event) => events.push(event),
    port: 0,
    maxBodyBytes: options.maxBodyBytes ?? 1_048_576,
  });
  const status = await server.start();
  if (status.state !== "listening") throw new Error(`测试 Webhook Server 未监听: ${status.error}`);
  const url = `http://${status.host}:${status.port}/api/webhooks/fixed-secret-token`;
  return { repository, service, server, status, url, events };
}

async function errorBody(response: Response): Promise<{ readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
  return await response.json() as { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
}

describe("WebhookServer", () => {
  it("accepts an authenticated loopback JSON POST and returns real audit/task ids", async () => {
    const context = await setup();
    try {
      const response = await fetch(context.url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ref: "refs/heads/main", build: 42 }),
      });
      expect(response.status).toBe(202);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: true,
        autopilotId: context.repository.state.autopilots[0]?.id,
        runId: context.repository.state.autopilotRuns[0]?.id,
        taskId: context.repository.state.tasks[0]?.id,
      });
      expect(context.repository.state.autopilotRuns[0]).toMatchObject({
        status: "succeeded",
        triggerKind: "webhook",
        requestPayload: { ref: "refs/heads/main", build: 42 },
      });
      expect(context.repository.state.tasks[0]?.description).toContain('"ref": "refs/heads/main"');
    } finally {
      await context.server.stop();
    }
  });

  it("returns structured errors for method, token, content type, UTF-8, JSON shape, and body limit", async () => {
    const context = await setup({ maxBodyBytes: 24 });
    try {
      const method = await fetch(context.url);
      expect(method.status).toBe(405);
      expect((await errorBody(method)).error.code).toBe("method_not_allowed");

      const token = await fetch(context.url.replace("fixed-secret-token", "wrong-token"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(token.status).toBe(404);
      expect((await errorBody(token)).error.code).toBe("invalid_token");

      const contentType = await fetch(context.url, { method: "POST", body: "{}" });
      expect(contentType.status).toBe(415);
      expect((await errorBody(contentType)).error.code).toBe("unsupported_content_type");

      const utf8 = await fetch(context.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]),
      });
      expect(utf8.status).toBe(400);
      expect((await errorBody(utf8)).error.code).toBe("invalid_utf8");

      const json = await fetch(context.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{\"incomplete\":",
      });
      expect(json.status).toBe(400);
      expect((await errorBody(json)).error.code).toBe("invalid_json");

      const shape = await fetch(context.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      });
      expect(shape.status).toBe(400);
      expect((await errorBody(shape)).error.code).toBe("json_object_required");

      const tooLarge = await fetch(context.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "this request is intentionally larger than the configured limit" }),
      });
      expect(tooLarge.status).toBe(413);
      expect((await errorBody(tooLarge)).error.code).toBe("body_too_large");
      expect(context.repository.state.tasks).toHaveLength(0);
    } finally {
      await context.server.stop();
    }
  });

  it("maps disabled and dispatch failures without claiming success, preserving applicable failed audits", async () => {
    const disabled = await setup({ enabled: false });
    try {
      const response = await fetch(disabled.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(409);
      expect((await errorBody(response)).error.code).toBe("autopilot_disabled");
      expect(disabled.repository.state.autopilotRuns).toHaveLength(0);
    } finally {
      await disabled.server.stop();
    }

    const failed = await setup({ dispatch: async () => { throw new Error("Pi Runner 拒绝分发"); } });
    try {
      const response = await fetch(failed.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "build" }),
      });
      expect(response.status).toBe(500);
      expect((await errorBody(response)).error).toMatchObject({ code: "trigger_failed", message: expect.stringContaining("Pi Runner 拒绝分发") });
      expect(failed.repository.state.autopilotRuns[0]).toMatchObject({ status: "failed", error: "Pi Runner 拒绝分发" });
    } finally {
      await failed.server.stop();
    }
  });

  it("surfaces a fixed-port bind conflict as runtime error state instead of choosing another port", async () => {
    const first = await setup();
    const events: BoardBridgeEvent[] = [];
    const second = new WebhookServer({
      autopilotService: first.service,
      emitBoardEvent: (event) => events.push(event),
      port: first.status.port,
      maxBodyBytes: 1_048_576,
    });
    try {
      const status = await second.start();
      expect(status).toMatchObject({ state: "error", host: "127.0.0.1", port: first.status.port, error: expect.stringContaining("EADDRINUSE") });
      expect(events).toContainEqual(expect.objectContaining({ type: "automation-error", source: "webhook", message: expect.stringContaining("EADDRINUSE") }));
    } finally {
      await second.stop();
      await first.server.stop();
    }
  });

  it("validates explicit environment configuration including zero as unlimited body size", () => {
    expect(webhookPortFromEnvironment(undefined)).toBe(43127);
    expect(webhookPortFromEnvironment("43128")).toBe(43128);
    expect(() => webhookPortFromEnvironment("0")).toThrow("STELLA_WEBHOOK_PORT");
    expect(webhookMaxBytesFromEnvironment(undefined)).toBe(1_048_576);
    expect(webhookMaxBytesFromEnvironment("0")).toBe(0);
    expect(() => webhookMaxBytesFromEnvironment("-1")).toThrow("STELLA_WEBHOOK_MAX_BYTES");
  });
});
