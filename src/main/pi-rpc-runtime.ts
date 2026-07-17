import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { PiCommand, PiExtensionResponse, PiResponse, RuntimeSignal } from "../shared/contracts";

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

interface RuntimeDependencies {
  readonly executablePath: string;
  readonly rpcEntryPath: string;
  readonly spawnProcess: SpawnProcess;
  readonly emitPiEvent: (event: unknown) => void;
  readonly emitRuntimeSignal: (event: RuntimeSignal) => void;
}

interface StartOptions {
  readonly cwd: string;
  readonly trusted: boolean;
  readonly sessionPath?: string;
}

interface PendingRequest {
  readonly resolve: (response: PiResponse) => void;
  readonly reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPiResponse(value: unknown): value is PiResponse {
  return isRecord(value) && value.type === "response" && typeof value.command === "string";
}

export class PiRpcRuntime {
  readonly #dependencies: RuntimeDependencies;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #intentionalStops = new WeakSet<ChildProcessWithoutNullStreams>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = "";
  #stderrBuffer = "";

  constructor(dependencies: RuntimeDependencies) {
    this.#dependencies = dependencies;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  async start(options: StartOptions): Promise<void> {
    const directory = await stat(options.cwd);
    if (!directory.isDirectory()) throw new Error(`项目路径不是目录: ${options.cwd}`);
    await this.stop();

    this.#dependencies.emitRuntimeSignal({ type: "runtime_starting", cwd: options.cwd });
    const args = [
      this.#dependencies.rpcEntryPath,
      options.trusted ? "--approve" : "--no-approve",
      ...(options.sessionPath ? ["--session", options.sessionPath] : []),
    ];
    const child = this.#dependencies.spawnProcess(this.#dependencies.executablePath, args, {
      cwd: options.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    this.#process = child;
    this.#stdoutBuffer = "";
    this.#stderrBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => this.#consumeStdout(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8");
      this.#stderrBuffer += message;
      this.#dependencies.emitRuntimeSignal({ type: "runtime_stderr", message });
    });
    child.once("error", (error) => this.#handleProcessFailure(error));
    child.once("exit", (code, signal) => {
      const intentional = this.#intentionalStops.has(child);
      this.#intentionalStops.delete(child);
      if (this.#process === child) this.#process = null;
      const failure = new Error(
        `${intentional ? "Pi RPC 已停止" : `Pi RPC 已退出 (code=${String(code)}, signal=${String(signal)})`}${
          this.#stderrBuffer ? `\n${this.#stderrBuffer}` : ""
        }`,
      );
      this.#rejectPending(failure);
      if (!intentional) this.#dependencies.emitRuntimeSignal({ type: "runtime_exit", code, signal });
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await this.send({ type: "get_state" });
    this.#dependencies.emitRuntimeSignal({ type: "runtime_ready", cwd: options.cwd });
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (!child) return;
    this.#process = null;
    this.#intentionalStops.add(child);
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2500).unref();
    });
  }

  send(command: PiCommand): Promise<PiResponse> {
    const child = this.#process;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      throw new Error(`Pi RPC 未运行${this.#stderrBuffer ? `: ${this.#stderrBuffer}` : ""}`);
    }

    const id = randomUUID();
    const record = { ...command, id };
    return new Promise<PiResponse>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(record)}\n`, "utf8", (error) => {
        if (!error) return;
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  async respondToExtension(response: PiExtensionResponse): Promise<void> {
    const child = this.#process;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      throw new Error("Pi RPC 未运行，无法回复扩展请求");
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(response)}\n`, "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  #consumeStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const record = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (record.length > 0) this.#handleRecord(record);
      newline = this.#stdoutBuffer.indexOf("\n");
    }
  }

  #handleRecord(record: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#dependencies.emitRuntimeSignal({ type: "protocol_error", message, record });
      return;
    }

    if (isPiResponse(parsed) && typeof parsed.id === "string") {
      const pending = this.#pending.get(parsed.id);
      if (!pending) return;
      this.#pending.delete(parsed.id);
      if (parsed.success) pending.resolve(parsed);
      else pending.reject(new Error(parsed.error));
      return;
    }
    this.#dependencies.emitPiEvent(parsed);
  }

  #handleProcessFailure(error: Error): void {
    this.#rejectPending(error);
    this.#dependencies.emitRuntimeSignal({
      type: "runtime_stderr",
      message: `Pi RPC 进程错误: ${error.message}`,
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
