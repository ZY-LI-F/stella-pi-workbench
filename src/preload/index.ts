import { contextBridge, ipcRenderer } from "electron";
import type {
  BridgeEvent,
  PiCommand,
  PiExtensionResponse,
  ProjectSelection,
  RuntimeBootstrap,
  StellaDesktopApi,
} from "../shared/contracts";
import type {
  BoardBootstrap,
  CreateTaskInput,
  ManualTaskStatus,
  ResolveGateInput,
  UpdateTaskInput,
} from "../shared/kanban";

const api: StellaDesktopApi = Object.freeze({
  initialize: () => ipcRenderer.invoke("stella:initialize") as Promise<RuntimeBootstrap>,
  command: (command: PiCommand) => ipcRenderer.invoke("stella:command", command),
  refresh: () => ipcRenderer.invoke("stella:refresh") as Promise<RuntimeBootstrap>,
  respondToExtension: (response: PiExtensionResponse) =>
    ipcRenderer.invoke("stella:extension-response", response) as Promise<void>,
  chooseProject: () => ipcRenderer.invoke("stella:choose-project") as Promise<ProjectSelection | null>,
  openProject: (path: string, trusted: boolean) =>
    ipcRenderer.invoke("stella:open-project", path, trusted) as Promise<RuntimeBootstrap>,
  revealPath: (path: string) => ipcRenderer.invoke("stella:reveal-path", path) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke("stella:open-external", url) as Promise<void>,
  boardInitialize: () => ipcRenderer.invoke("stella:board:initialize") as Promise<BoardBootstrap>,
  boardCreateTask: (input: CreateTaskInput) =>
    ipcRenderer.invoke("stella:board:create-task", input) as Promise<BoardBootstrap>,
  boardUpdateTask: (input: UpdateTaskInput) =>
    ipcRenderer.invoke("stella:board:update-task", input) as Promise<BoardBootstrap>,
  boardMoveTask: (taskId: string, status: ManualTaskStatus) =>
    ipcRenderer.invoke("stella:board:move-task", taskId, status) as Promise<BoardBootstrap>,
  boardDeleteTask: (taskId: string) =>
    ipcRenderer.invoke("stella:board:delete-task", taskId) as Promise<BoardBootstrap>,
  boardDispatchTask: (taskId: string) =>
    ipcRenderer.invoke("stella:board:dispatch-task", taskId) as Promise<BoardBootstrap>,
  boardResolveGate: (input: ResolveGateInput) =>
    ipcRenderer.invoke("stella:board:resolve-gate", input) as Promise<BoardBootstrap>,
  boardAbortTask: (taskId: string) =>
    ipcRenderer.invoke("stella:board:abort-task", taskId) as Promise<BoardBootstrap>,
  windowAction: (action: "minimize" | "maximize" | "close") =>
    ipcRenderer.invoke("stella:window-action", action) as Promise<void>,
  onEvent: (listener: (event: BridgeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: BridgeEvent) => listener(value);
    ipcRenderer.on("stella:event", handler);
    return () => ipcRenderer.removeListener("stella:event", handler);
  },
});

contextBridge.exposeInMainWorld("stella", api);
