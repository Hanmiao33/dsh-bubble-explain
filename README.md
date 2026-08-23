# dsh-bubble-explain

Select any text in a DeepSeek Harness conversation and tap **Explain** to get a
streaming Markdown explanation bubble, with recursive follow-up questions.

对话中框选任意文字，点击「解释」按钮，弹出 Markdown 实时流式解释气泡，支持递归追问。

## Features

- **Selection → Explain**: select any text in a conversation (terms, code,
  errors, sentences) and a pending **解释** button appears next to the
  selection; tap it to open an explanation bubble.
- **Streaming Markdown**: the explanation streams in as Markdown (headings,
  lists, code blocks), rendered live in the bubble.
- **Recursive follow-up**: select text *inside* an explanation to drill deeper
  (up to 6 levels), always in the context of the parent explanation.
- **Non-intrusive**: bubbles are a lightweight overlay — draggable, with a
  copy button, and capped (8 bubbles max).
- **Configurable**: enable/disable the whole feature, set max recursion depth
  and max explanation length from **Settings → General** (「框选解释」).

## Install

```bash
dsh plugin --profile web add github:Hanmiao33/dsh-bubble-explain
```

GitHub-sourced plugins run build scripts at install time; the first run asks
for an `allowBuilds` approval — follow the hint, then retry the command.

## Usage

1. In a conversation, select any piece of text with your mouse.
2. Click the **解释** button that appears.
3. An explanation bubble streams in beside the selection.
4. Select text inside the bubble to ask a deeper follow-up, or use the copy
   button / drag the bubble anywhere on the page.

## Configuration

Open **Settings → General** in the harness and find the **「框选解释」** section:

| Key       | Default | Meaning                                          |
|-----------|---------|--------------------------------------------------|
| `enabled` | `true`  | Master switch for the explain feature            |
| `maxDepth`| `6`     | Max recursion depth (1–6)                        |
| `maxChars`| `300`   | Max explanation length in characters (50–1000)   |

Settings are persisted to `$DSH_HOME/dsh-bubble-explain.settings.json` and can
be edited there directly.

## Development

The plugin is a DSH profile bundle (`dsh.bundle` in `package.json`) built
against the harness checkout. From a DSH source checkout:

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh   # host: compile src/ → lib/
npm run build:client                            # client: bundle src/client/ → lib/client.js
```

Sanity checks that need no checkout:

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm run build:client     # tsdown bundle
npm test                 # vitest unit tests for src/explain.ts
```

## License

[BSD-3-Clause](LICENSE)
