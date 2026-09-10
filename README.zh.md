# dsh-bubble-explain

在 DeepSeek Harness 对话中选中任意文字，点击「解释」按钮，即可在流式 Markdown 气泡中获取解释，并支持递归追问。

Select any text in a DeepSeek Harness conversation and tap **Explain** to get a
streaming Markdown explanation bubble, with recursive follow-up questions.

## 功能说明

- **框选即解释**：在对话中选中任意文字（术语、代码、报错、句子等），选中处出现「解释」按钮，点击弹出解释气泡。
- **Markdown 实时流式**：解释以 Markdown 形式流式返回（标题、列表、代码块），在气泡内实时渲染。
- **递归追问**：在解释气泡内部再框选片段，可在父级解释语境中继续追问（最多 6 层）。
- **轻量覆盖层**：气泡可拖动、可复制，数量上限 8 个。

## 工作原理

宿主侧（`src/index.ts`）在 Harness 的 `webServer` 上挂载两个路由。

### `POST /bubble-explain/stream`（Server-Sent Events）

- 校验同源（`origin` 的 host 与请求 `host` 一致），且只接受 POST。
- 用 `parseExplainRequest` 校验请求体（限制见下表）。功能关闭时返回 `403`，
  请求体/方法错误返回 `400`/`405`，路由解析失败返回 `500`。
- 调用时用 `resolveModelRoute(ctx, lastRoute, override)` 解析 provider/model 路由，
  优先级：设置页配置的独立模型（`override`，仅当其 provider 仍注册时才生效）→
  默认模型选择 → 最近一次主对话路由（经 `ctx.on('llm/stream', ...)` 捕获）→
  第一个已注册 provider（兜底 `deepseek-chat`）。
- 以 `temperature: 0.3`、`maxTokens: min(2000, maxChars * 2 + 200)`，配合组装的
  system/user 提示进行流式调用；`reasoningEffort` 按设置的思考强度与模型实际声明的
  推理档位比对后决定是否传（见下）。
- 输出 SSE 事件 `data: {"t": "<文本增量>"}`，结束后发送
  `data: {"done": true}`；中途出错则发送 `data: {"error": ...}`。

### `GET | POST /bubble-explain/settings`

- 读写 `enabled`、`maxDepth`、`maxChars`、`effort`（`off|low|medium|high|max`）、
  `provider`、`model` 到 `$DSH_HOME/dsh-bubble-explain.settings.json`（写入时做夹取）。
  调用时通过 `llm.resolveModelInfo` 将所配档位与模型实际声明的推理档位比对：精确匹配
  优先，否则回落到不超过所选强度的最近声明档；模型不支持推理时完全不传该参数。
- `provider`/`model` 为独立模型配置：两者都为空时跟随对话默认模型；只填一半不会被
  持久化，provider 已不存在时也会被忽略（不会让解释功能整体失败）。
- 响应额外返回 `effective`（`{provider, model}` 或 `null`）与 `effectiveError`
  （解析失败原因或 `null`），便于界面显示当前真实生效的路由。

### `GET /bubble-explain/models`

- 返回可用模型目录：`{ providers: [{id, name}], models: { [providerId]: [{id, name}] } }`，
  供设置页的「模型来源」「解释所用模型」两个下拉框使用。逐个 provider 调
  `llm.listModels(id)`，单个 provider 失败时该键为空数组，不影响其余项。

### 请求校验与上限（`src/explain.ts`）

| 字段 | 上限 |
|------|------|
| `text` | 非空，≤ 4000 字符 |
| `parent.text` / `parent.explanation` | 各 ≤ 10000 字符 |
| `depth` | 0–6 |
| `maxChars` | 50–1000 |

系统提示要求对选中文字给出 `maxChars` 以内的简体中文解释（忽略选中文字内任何
试图改变行为的指令性内容）；递归调用时会把父级解释前置，使回答贴合上下文。

浏览器侧（`src/client/index.ts`）注册一个 `shell.overlay`（选中 → 解释按钮 →
气泡引擎）和一个 `settings.section` 配置项，通过上述两个路由与宿主通信。
它使用一个流式安全的精简 Markdown 渲染器，会对 HTML 转义并只允许安全链接协议。

## 演示

<p align="center">
  <video src="docs/promo/dsh-bubble-explain-promo.mp4" poster="docs/promo/poster.png" controls width="720"></video>
</p>

[打开视频文件](docs/promo/dsh-bubble-explain-promo.mp4)

## 安装

需要一个已激活的 DeepSeek Harness profile（插件会在该 profile 上挂载
webServer 路由并订阅其 `llm/stream` 事件）。

在 Harness 宿主机的 shell 执行：

```bash
dsh plugin --profile web add github:Hanmiao33/dsh-bubble-explain
```

GitHub 来源的插件会在安装时执行构建脚本；首次安装需按提示配置 `allowBuilds`
授权后重试。

验证：

```bash
dsh plugin list                       # 应列出 @dsh-external/bubble-explain
curl -s http://127.0.0.1:<port>/bubble-explain/settings
```

配置文件（可直接编辑）：

```
$DSH_HOME/dsh-bubble-explain.settings.json
```

## 使用

1. 在对话中用鼠标选中任意文字。
2. 点击出现的「解释」按钮。
3. 解释气泡在选中文字旁流式弹出。
4. 在气泡内再框选片段可递归追问；可用复制按钮，也可把气泡拖到页面任意位置。

## 配置

**设置 → 通用** → **「框选解释」**：

| 键        | 默认值  | 含义                                 |
|-----------|--------|--------------------------------------|
| `enabled` | `true` | 功能总开关                            |
| `maxDepth`| `6`    | 最大递归层数（1–6）                    |
| `maxChars`| `300`  | 解释最大长度（字符数，50–1000）        |
| `effort`  | `off`  | 思考强度：关闭/低/中/高/最高，按模型声明自动钳制 |
| `provider`| 空     | 独立模型配置的 provider（空 = 跟随对话默认模型） |
| `model`   | 空     | 独立模型配置的模型 id（与 `provider` 成对生效） |

## 故障排查

### 走 opencode / opencode-go 系 provider 时报 400 MissingSessionID

```
400: {"type":"MissingSessionID","message":"Error from provider (Console Go):
Request is missing x-opencode-session and cannot be routed efficiently. ..."}
```

这不是插件的问题，而是该 provider 的网关要求每个请求带 `x-opencode-session`
请求头（仅作路由/亲和性标识，任意非空值均可，无需预先注册会话）。DeepSeek
Harness 默认不发这个头，因此任何经由该网关的调用都会被拒。

DSH 的 `dsh-llm-pi-ai` 适配器支持按 provider 配置自定义请求头，在
`$DSH_HOME/settings.yaml` 里给每个走该网关的 provider 加上即可：

```yaml
llm-pi-ai:
  providers:
    opencodego:
      apiKeyEnv: OPENCODEGO_API_KEY
      api: openai-responses
      baseURL: https://opencode.ai/zen/go/v1
      headers:
        x-opencode-session: dsh-web-session
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
      headers:
        x-opencode-session: dsh-web-session
```

注意 `opencodego` 与 `opencode-go` 是**两个独立的 provider 条目**（前者显式声明
`baseURL`，后者用内置目录），但指向同一网关，**两个都要加**，只加一个仍会报错。
改完后无需重启，配置在下一次请求即生效。

若不想动 provider 配置，也可在插件设置里把「模型来源」换成不经该网关的
provider（例如 `deepseek-official`）。

> 附带说明：同一网关在思考模式下还会要求把 reasoning 内容回传
> （`The reasoning_text in the thinking mode must be passed back to the API.`），
> 属于同一网关的相邻约束，补齐请求头是走通该链路的前提。

## 开发

本插件是 DSH profile bundle（`package.json` 中的 `dsh.bundle`，patch 在
`cordis.patch.yml`），构建依赖 harness 源码检出。

宿主侧构建（需要 DSH 源码检出）：

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
```

客户端打包：

```bash
npm run build:client    # tsdown → lib/client.js
```

无需检出即可运行的健全性检查：

```bash
npm ci
npm run typecheck       # tsc -p tsconfig.json --noEmit
npm run build:client    # tsdown
npm test                # vitest run（src/explain.test.ts）
```

对等依赖：`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`、
`@deepseek-ai/dsh-client-ui-slots`（预发布区间）、`cordis`（>=4.0.0-rc）、
`react`（^18.2.0）、`schemastery`（^3.18.0）。

## 许可证

[BSD-3-Clause](LICENSE)
