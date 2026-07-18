# Ticket 06 · Loopback Webhook、三套皮肤 UI 与原生验证

Status: DONE  
Blocked by: Ticket 03, Ticket 05

## Outcome

本机脚本能通过带随机 token 的 loopback JSON POST 触发规则；完整自动化界面在 Stella、晨曦、定阳中可用，并通过生产构建和打包应用验证。

## Checklist

- [x] 实现只绑定 `127.0.0.1` 的 HTTP server、固定/可配置端口和显式 bind 状态。
- [x] 创建 Webhook 规则时生成随机 token，UI 展示并可复制完整 URL。
- [x] 严格验证 method、route、token、content-type、UTF-8、JSON object 和显式 body limit。
- [x] 成功返回 task/audit id；失败返回结构化 HTTP error 并保留适用审计。
- [x] Webhook payload 进入触发上下文和新 Task 描述。
- [x] Automation Studio、Task Detail、所有空/错/忙/焦点状态适配三套皮肤。
- [x] 响应式窄屏与 `prefers-reduced-motion` 完整。
- [x] 补充 README 自动化说明和三套皮肤截图信息（使用真实界面，不伪造运行结果）。
- [x] 运行 `npm run check`、`npm run build`、`npm run test:packaged`。
