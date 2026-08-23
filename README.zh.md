# dsh-bubble-explain

在 DeepSeek Harness 对话中框选任意文字，点击「解释」按钮，弹出 Markdown 实时流式解释气泡，支持递归追问。

Select any text in a DeepSeek Harness conversation and tap **Explain** to get a
streaming Markdown explanation bubble, with recursive follow-up questions.

## 功能特性

- **框选即解释**：在对话中选中任意文字（术语、代码、报错、句子等），选中处出现待触发的「解释」按钮，点击弹出解释气泡。
- **Markdown 实时流式**：解释以 Markdown 形式流式输出（标题、列表、代码块），在气泡内实时渲染。
- **递归追问**：在解释气泡内部再框选片段，可在父级解释语境中继续深挖（最多 6 层）。
- **轻量不打扰**：气泡为覆盖层，可拖动、可复制，数量上限 8 个。
- **可配置**：可在「设置 → 通用」的「框选解释」中开关功能、调节递归深度与解释长度上限。

## 安装

```bash
dsh plugin --profile web add github:Hanmiao33/dsh-bubble-explain
```

GitHub 来源的插件会在安装时执行构建脚本；首次安装需按提示配置 `allowBuilds`
构建授权后重试。

## 使用

1. 在对话中选中任意文字。
2. 点击出现的「解释」按钮。
3. 解释气泡在选中文字旁流式弹出。
4. 在气泡内再框选片段可递归追问；可用复制按钮，也可拖动气泡到页面任意位置。

## 配置

打开 Harness 的「设置 → 通用」，找到「框选解释」：

| 键        | 默认值  | 含义                                   |
|-----------|--------|----------------------------------------|
| `enabled` | `true` | 功能总开关                             |
| `maxDepth`| `6`    | 最大递归层数（1–6）                     |
| `maxChars`| `300`  | 解释最大长度（字符数，50–1000）          |

配置持久化在 `$DSH_HOME/dsh-bubble-explain.settings.json`，也可直接编辑该文件。

## 开发

本插件是 DSH profile bundle（`package.json` 中的 `dsh.bundle`），构建依赖
harness 源码检出。在 DSH 源码检出环境下：

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh   # host：编译 src/ → lib/
npm run build:client                            # client：打包 src/client/ → lib/client.js
```

无需检出即可运行的健全性检查：

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm run build:client     # tsdown 打包
npm test                 # vitest 对 src/explain.ts 的单元测试
```

## 许可证

[BSD-3-Clause](LICENSE)
