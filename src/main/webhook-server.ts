import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import {
  WebhookAutopilotNotFoundError,
  type AutopilotService,
} from "./autopilot-service";
import type { AutomationRuntimeStatus, BoardBridgeEvent, JsonObject } from "../shared/kanban";

export const WEBHOOK_HOST = "127.0.0.1" as const;
export const DEFAULT_WEBHOOK_PORT = 43_127;
export const DEFAULT_WEBHOOK_MAX_BYTES = 1_048_576;

interface WebhookServerDependencies {
  readonly autopilotService: AutopilotService;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly port: number;
  readonly maxBodyBytes: number;
}

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

function integerEnvironment(value: string | undefined, fallback: number, label: string, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

export function webhookPortFromEnvironment(value: string | undefined): number {
  return integerEnvironment(value, DEFAULT_WEBHOOK_PORT, "STELLA_WEBHOOK_PORT", 1, 65_535);
}

export function webhookMaxBytesFromEnvironment(value: string | undefined): number {
  return integerEnvironment(value, DEFAULT_WEBHOOK_MAX_BYTES, "STELLA_WEBHOOK_MAX_BYTES", 0, Number.MAX_SAFE_INTEGER);
}

function jsonResponse(response: ServerResponse, status: number, body: Readonly<Record<string, unknown>>): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(payload.byteLength),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function requestToken(request: IncomingMessage): string {
  const url = new URL(request.url ?? "", `http://${WEBHOOK_HOST}`);
  if (url.search || url.hash) throw new HttpRequestError(404, "route_not_found", "Webhook 路由不存在");
  const match = /^\/api\/webhooks\/([^/]+)$/.exec(url.pathname);
  if (!match?.[1]) throw new HttpRequestError(404, "route_not_found", "Webhook 路由不存在");
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new HttpRequestError(400, "invalid_token_encoding", "Webhook token 编码无效");
  }
}

function assertJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"];
  const mimeType = typeof contentType === "string" ? contentType.split(";", 1)[0]?.trim().toLocaleLowerCase() : undefined;
  if (mimeType !== "application/json") {
    throw new HttpRequestError(415, "unsupported_content_type", "Content-Type 必须是 application/json");
  }
}

async function requestBody(request: IncomingMessage, maxBodyBytes: number): Promise<JsonObject> {
  const contentLength = request.headers["content-length"];
  if (maxBodyBytes > 0 && typeof contentLength === "string" && Number(contentLength) > maxBodyBytes) {
    request.resume();
    throw new HttpRequestError(413, "body_too_large", `请求体超过 ${maxBodyBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    length += chunk.byteLength;
    if (maxBodyBytes > 0 && length > maxBodyBytes) {
      request.resume();
      throw new HttpRequestError(413, "body_too_large", `请求体超过 ${maxBodyBytes} bytes`);
    }
    chunks.push(chunk);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
  } catch {
    throw new HttpRequestError(400, "invalid_utf8", "请求体不是有效 UTF-8");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpRequestError(400, "invalid_json", "请求体不是有效 JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpRequestError(400, "json_object_required", "Webhook payload 必须是 JSON object");
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function statusError(cause: unknown): string {
  const base = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof Error && "code" in cause ? String((cause as NodeJS.ErrnoException).code) : undefined;
  return code ? `${code}: ${base}` : base;
}

export class WebhookServer {
  readonly #autopilotService: AutopilotService;
  readonly #emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly #configuredPort: number;
  readonly #maxBodyBytes: number;
  #server?: Server;
  #status: AutomationRuntimeStatus["webhook"];

  constructor(dependencies: WebhookServerDependencies) {
    if (!Number.isInteger(dependencies.port) || dependencies.port < 0 || dependencies.port > 65_535) throw new Error("Webhook port 必须是有效整数端口");
    if (!Number.isSafeInteger(dependencies.maxBodyBytes) || dependencies.maxBodyBytes < 0) throw new Error("Webhook maxBodyBytes 必须是非负安全整数");
    this.#autopilotService = dependencies.autopilotService;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
    this.#configuredPort = dependencies.port;
    this.#maxBodyBytes = dependencies.maxBodyBytes;
    this.#status = Object.freeze({ state: "stopped", host: WEBHOOK_HOST, port: this.#configuredPort });
  }

  get status(): AutomationRuntimeStatus["webhook"] {
    return this.#status;
  }

  async start(): Promise<AutomationRuntimeStatus["webhook"]> {
    if (this.#server) throw new Error("Webhook Server 已启动");
    const server = createServer((request, response) => {
      void this.#handleRequest(request, response).catch((cause: unknown) => this.#handleRequestError(response, cause));
    });
    server.on("clientError", (cause, socket) => {
      const body = JSON.stringify({ ok: false, error: { code: "invalid_http", message: cause.message } });
      socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (cause: Error) => reject(cause);
        server.once("error", onError);
        server.listen(this.#configuredPort, WEBHOOK_HOST, () => {
          server.off("error", onError);
          resolve();
        });
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Webhook Server 未返回 TCP 监听地址");
      this.#server = server;
      this.#status = Object.freeze({ state: "listening", host: WEBHOOK_HOST, port: address.port });
      this.#emitStatus();
      return this.#status;
    } catch (cause) {
      const error = statusError(cause);
      this.#status = Object.freeze({ state: "error", host: WEBHOOK_HOST, port: this.#configuredPort, error });
      this.#emitStatus();
      this.#emitBoardEvent({ type: "automation-error", source: "webhook", message: `Webhook Server 启动失败：${error}` });
      return this.#status;
    }
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve()));
    }
    this.#status = Object.freeze({ state: "stopped", host: WEBHOOK_HOST, port: this.#configuredPort });
    this.#emitStatus();
  }

  emitStatus(): void {
    this.#emitStatus();
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = requestToken(request);
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      throw new HttpRequestError(405, "method_not_allowed", "Webhook 只接受 POST");
    }
    assertJsonContentType(request);
    const payload = await requestBody(request, this.#maxBodyBytes);
    const result = await this.#autopilotService.triggerWebhook(token, payload);
    jsonResponse(response, 202, {
      ok: true,
      autopilotId: result.autopilotId,
      runId: result.runId,
      taskId: result.taskId,
    });
  }

  #handleRequestError(response: ServerResponse, cause: unknown): void {
    if (response.headersSent) {
      response.destroy(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    if (cause instanceof HttpRequestError) {
      jsonResponse(response, cause.status, { ok: false, error: { code: cause.code, message: cause.message } });
      return;
    }
    if (cause instanceof WebhookAutopilotNotFoundError) {
      jsonResponse(response, 404, { ok: false, error: { code: "invalid_token", message: cause.message } });
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    const disabled = message.includes("已禁用");
    jsonResponse(response, disabled ? 409 : 500, {
      ok: false,
      error: { code: disabled ? "autopilot_disabled" : "trigger_failed", message },
    });
  }

  #emitStatus(): void {
    this.#emitBoardEvent({ type: "automation-runtime", status: Object.freeze({ webhook: this.#status }) });
  }
}
