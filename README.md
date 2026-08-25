# dsh-bubble-explain

A DeepSeek Harness profile bundle that explains any selected text inside a
conversation with a streaming Markdown bubble, with recursive follow-up
questions.

选中对话中的任意文字，点击「解释」按钮，即可在流式 Markdown 气泡中获取解释，并支持递归追问。

## What it does

- Select text in a conversation (a term, a code snippet, an error message, a
  sentence) — an **解释** button appears next to the selection. Click it to
  open an explanation bubble.
- The explanation is streamed in as Markdown (headings, lists, code blocks)
  and rendered live in the bubble.
- Select text *inside* an explanation to ask a deeper follow-up; each level
  carries the parent explanation as context (up to 6 levels).
- Bubbles are a draggable overlay with a copy button, capped at 8 at a time.

## How it works

The host half (`src/index.ts`) mounts two routes on the harness `webServer`.

### `POST /bubble-explain/stream` (Server-Sent Events)

- Validates same-origin (`origin` host === request `host`) and accepts POST
  only.
- Validates the body with `parseExplainRequest` (limits below). Returns `403`
  if the feature is disabled, `400`/`405` on a bad body/method, `500` on route
  resolution failure.
- Resolves the provider/model route at call time with `resolveModelRoute`:
  agent default selection → last observed main-loop route → first registered
  provider (falls back to `deepseek-chat`). The main-loop route is captured via
  `ctx.on('llm/stream', ...)`.
- Streams with `reasoningEffort: "off"`, `temperature: 0.3`,
  `maxTokens: min(2000, maxChars * 2 + 200)`, and the assembled system/user
  prompts.
- Emits SSE events `data: {"t": "<text delta>"}` and then
  `data: {"done": true}`; an error mid-stream sends `data: {"error": ...}`.

### `GET | POST /bubble-explain/settings`

- Reads/writes `enabled`, `maxDepth`, `maxChars`, `effort` (`off|low|medium|high|max`)
  to `$DSH_HOME/dsh-bubble-explain.settings.json` (values are clamped on write).
  At call time the configured effort is matched against the model's declared
  efforts via `llm.resolveModelInfo`: exact match wins, otherwise it falls back
  to the closest declared level not stronger than requested; models without
  reasoning support omit the parameter entirely.

### Request validation and limits (`src/explain.ts`)

| Field | Limit |
|-------|-------|
| `text` | non-empty, ≤ 4000 chars |
| `parent.text` / `parent.explanation` | ≤ 10000 chars each |
| `depth` | 0–6 |
| `maxChars` | 50–1000 |

The system prompt asks for a `maxChars`-bounded Chinese explanation of only the
selected text (instruction-like content inside the selection is ignored). For
recursive calls it prepends the parent explanation so the reply stays grounded
in context.

The browser half (`src/client/index.ts`) registers a `shell.overlay` (the
selection → 解释 button → bubble engine) and a `settings.section` entry, and
talks to the host over the two routes above. It uses a small streaming-safe
Markdown renderer that escapes HTML and allows only safe link schemes.

## Demo

<p align="center">
  <video src="docs/promo/dsh-bubble-explain-promo.mp4" poster="docs/promo/poster.png" controls width="720"></video>
</p>

[Open the video file](docs/promo/dsh-bubble-explain-promo.mp4)

## Install

Requires an active DeepSeek Harness profile (the plugin mounts webServer routes
and subscribes to that profile's `llm/stream` event).

From a shell on the harness host:

```bash
dsh plugin --profile web add github:Hanmiao33/dsh-bubble-explain
```

Because GitHub-sourced plugins run build scripts at install time, the first run
asks for an `allowBuilds` approval — follow the hint and retry the command.

Verify:

```bash
dsh plugin list                       # @dsh-external/bubble-explain should be listed
curl -s http://127.0.0.1:<port>/bubble-explain/settings
```

The settings file (editable directly):

```
$DSH_HOME/dsh-bubble-explain.settings.json
```

## Usage

1. In a conversation, select any text with the mouse.
2. Click the **解释** button that appears.
3. An explanation bubble streams in next to the selection.
4. Select text inside the bubble to ask a deeper follow-up, or use the copy
   button / drag the bubble anywhere on the page.

## Configuration

**Settings → General** → **「框选解释」**:

| Key       | Default | Meaning                             |
|-----------|---------|-------------------------------------|
| `enabled` | `true`  | Master switch                       |
| `maxDepth`| `6`     | Max recursion depth (1–6)           |
| `maxChars`| `300`   | Max explanation length (50–1000)    |
| `effort`  | `off`   | Reasoning strength (`off/low/medium/high/max`), auto-clamped per model |

## Development

The plugin is a DSH profile bundle (`dsh.bundle` in `package.json`, patch at
`cordis.patch.yml`) built against a harness checkout.

Host build (needs a DSH source checkout):

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
```

Client bundle:

```bash
npm run build:client    # tsdown → lib/client.js
```

Checks that need no checkout:

```bash
npm ci
npm run typecheck       # tsc -p tsconfig.json --noEmit
npm run build:client    # tsdown
npm test                # vitest run (src/explain.test.ts)
```

Peer dependencies: `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-tools`,
`@deepseek-ai/dsh-client-ui-slots` (pre-release ranges), `cordis` (>=4.0.0-rc),
`react` (^18.2.0), `schemastery` (^3.18.0).

## License

[BSD-3-Clause](LICENSE)
