# Stella · Pi Workbench

这是一个为 [earendil-works/pi](https://github.com/earendil-works/pi) 打造的 Electron 桌面 GUI。它直接启动 Pi 的 JSONL RPC 进程，不模拟回复、不绕开 Pi 的会话系统；界面提供 Stella、晨曦、定阳三套可持久化皮肤，同时以贯穿界面的 **Stella 签名**保持统一识别度。

![Stella Pi Workbench](docs/stella-home.png)

## 三套完整皮肤

皮肤切换不只是换主色：每套视觉都会同步改变背景主视觉、色彩令牌、面板材质、边框与圆角、品牌符号、空状态图形、建议卡片和输入器；明色、暗色与系统模式仍可独立组合。

| 皮肤 | 视觉方向 | 开源参考 |
| --- | --- | --- |
| **Stella · 夜航星图** | 鸢尾星轨、柔光玻璃、暖色手写签名 | [Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin)、Codex 的信息层级 |
| **晨曦 · 纸上初光** | 雾面纸艺、山岚层叠、杏色晨光 | [Rosé Pine Dawn](https://github.com/rose-pine/rose-pine-theme) 的柔和色阶 |
| **定阳 · 日晷制图** | 矿物版画、太阳刻度、几何秩序 | [Solarized](https://github.com/altercation/solarized) 的明暗关系、[Trianglify](https://github.com/qrohlf/trianglify) 的算法几何构成 |

![晨曦皮肤](docs/chenxi-home.png)

![定阳皮肤](docs/dingyang-home.png)

晨曦与定阳的背景图为本项目生成的原创视觉资源，并分别带有“晨曦”“定阳”专属中文题字；开源项目只用于设计研究，没有复制其图片资产或打包其运行代码。

## 已覆盖的交互

- 真实 Pi RPC：提示词、图片、流式消息、steer / follow-up 队列、停止生成、可中止的自动重试与上下文压缩。
- 模型与思考级别：读取 Pi 可用模型并即时切换，支持 `off` 到 `max` 的完整思考级别。
- 会话：新建、切换、搜索、重命名、克隆、从历史消息分叉、树状分支查看、HTML 导出。
- 工具过程：流式展示 tool call、参数、实时结果、错误和活动时间线。
- 本地命令：在当前工作目录执行 Pi `bash` 命令，支持取消、历史导航、截断输出定位。
- 编辑器：Enter 发送、Shift+Enter 换行、图片添加/预览/移除、斜杠命令、建议卡片与快捷键。
- 扩展 UI：`select`、`confirm`、`input`、`editor`、请求超时、通知、状态、编辑器上下组件、窗口标题与草稿注入。
- 项目权限：检测项目级 `.pi` 资源，在“信任加载”和“受限打开”之间明确选择。
- 桌面体验：无边框窗口控制、命令面板、检查器、终端抽屉、三套可选皮肤、深色/浅色/跟随系统、紧凑密度、响应式侧栏、键盘焦点与减少动态效果。

## 运行

要求 Node.js `>= 22.19.0`。Pi 的模型、认证、扩展、技能和用户设置沿用其标准用户目录，无需在本项目内重复保存凭据。

```bash
npm install
npm run dev
```

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## Windows / macOS 安装包

安装包采用“内置 Pi 运行时、复用用户配置”的结构。`@earendil-works/pi-coding-agent` 及其生产依赖会随 Stella 一起进入安装包，主进程使用 Electron 自带的 Node 运行内置 RPC 入口，因此接收者的全局 `pi` 命令安装在哪里、有没有加入 `PATH`，都不会影响 GUI 启动。

接收者自己的配置、认证、会话、扩展和技能仍从 Pi 的标准用户目录读取：

- Windows：`%USERPROFILE%\.pi\agent`
- macOS：`~/.pi/agent`
- 若设置了 `PI_CODING_AGENT_DIR`，Pi 会改用该目录。

不要把开发者自己的 API Key、OAuth 凭据或 `.pi/agent` 目录放进安装包。没有单独安装 Pi CLI 的用户也能启动 Stella，但首次调用模型前仍需配置自己的提供方凭据。

### 本机打包

```bash
# 只生成当前系统的未安装目录，适合做打包后冒烟测试
npm run package:dir
npm run test:packaged

# Windows x64 NSIS 安装程序
npm run dist:win

# Windows ARM64 安装程序
npm run dist:win:arm64

# Intel Mac：DMG + ZIP
npm run dist:mac:x64

# Apple Silicon Mac：DMG + ZIP
npm run dist:mac:arm64
```

产物统一写入 `release/`，文件名包含版本、系统与架构，例如：

```text
Stella Pi Workbench-0.1.0-win-x64.exe
Stella Pi Workbench-0.1.0-mac-x64.dmg
Stella Pi Workbench-0.1.0-mac-arm64.dmg
```

macOS 签名只能在 macOS 上完成，因此不要在 Windows 上交叉生成正式 Mac 发布包。项目包含 [GitHub Actions 发布流程](.github/workflows/release.yml)，会分别在 Windows x64、macOS Apple Silicon 和 macOS Intel 主机上安装目标架构依赖并打包。

### 签名、公证与 Release

手动运行 `Build installers` 工作流会生成可供内部验证的构建产物；如果没有证书，产物会明确保持未签名。Windows 会显示“未知发布者”，未签名的 macOS 应用会被 Gatekeeper 拦截，因此不应把未签名的 Mac 包当作正式公共发行版。

推送与 `package.json` 版本一致的标签（例如 `v0.1.0`）时，工作流会强制要求签名；Mac 任务还会强制要求 Apple 公证。全部平台成功后才会创建 GitHub Release。仓库 Secrets 使用：

| Secret | 用途 |
| --- | --- |
| `WIN_CSC_LINK` | Windows 代码签名证书文件路径、URL 或 Base64 内容 |
| `WIN_CSC_KEY_PASSWORD` | Windows 证书密码 |
| `MAC_CSC_LINK` | `Developer ID Application` 的 `.p12` 文件或 Base64 内容 |
| `MAC_CSC_KEY_PASSWORD` | Mac 证书密码 |
| `APPLE_ID` | Apple Developer 账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 专用密码，不是 Apple ID 登录密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

正式发布示例：

```bash
npm version 0.1.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin main --tags
```

## 验证

```bash
npm run check
npm run build
npm run test:e2e
```

单元测试覆盖运行态归并、流式消息、工具调用、消息队列、扩展 UI、皮肤偏好和输入器行为；Electron 端到端测试使用真实 Pi RPC 冷启动，并检查命令面板、设置、主题、密度、检查器、重命名弹窗、终端、图片附件、快捷键和响应式侧栏。`test:packaged` 会清空可执行文件搜索路径后直接启动 `release/` 中的打包应用，只有安装包内置 Pi RPC 成功返回状态后才通过。

## 结构

```text
src/
├─ main/                 Electron 主进程、Pi RPC 生命周期、项目与会话装载
├─ preload/              contextBridge 白名单 API
├─ renderer/src/
│  ├─ components/        会话、输入器、检查器、终端、弹窗和导航
│  ├─ hooks/             Pi 状态同步与本地偏好
│  ├─ assets/skins/      晨曦与定阳的原创皮肤主视觉
│  ├─ lib/               不可变运行态 reducer 与皮肤定义
│  └─ styles/            多皮肤设计令牌、布局与响应式样式
└─ shared/               主进程与渲染器共享协议
```

主进程以 Electron 自带的 Node 运行时启动 Pi RPC，并设置 `ELECTRON_RUN_AS_NODE=1`。渲染器开启 `contextIsolation` 与 `sandbox`，只通过 preload 暴露的窄接口访问本地能力；外部链接仅允许 HTTP(S)，项目路径和 IPC 命令在主进程边界验证。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl/Cmd + N` | 新建会话 |
| `Ctrl/Cmd + K` | 搜索与命令 |
| `Ctrl/Cmd + L` | 聚焦输入框 |
| <code>Ctrl/Cmd + `</code> | 切换本地命令抽屉 |
| `Ctrl/Cmd + I` | 切换会话检查器 |
| `Esc` | 停止生成或关闭当前弹窗 |

## 项目信任

当工作目录包含项目级设置、扩展、技能、提示词或主题时，Stella 会先显示权限对话框：

- “信任并加载”会以 Pi 的 `--approve` 模式启动当前工作区。
- “受限打开”会以 `--no-approve` 模式忽略项目级可执行资源，仅使用用户级配置。

这个选择会随最近项目记录保存在 Electron 的用户数据目录中；不会写入被打开的代码仓库。
