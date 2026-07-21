import "@fontsource-variable/manrope";
import "@fontsource/marck-script";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/kanban.css";
import "./styles/models.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 渲染节点");
if (!window.stella) throw new Error("Stella preload bridge 未加载，无法连接 Electron 主进程");

createRoot(root).render(
  <StrictMode>
    <App api={window.stella} />
  </StrictMode>,
);
