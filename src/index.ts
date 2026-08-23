/**
 * @dsh-external/bubble-explain — host half.
 *
 * Mounts two HTTP routes on the DSH webServer:
 *  - POST /bubble-explain/stream  → SSE stream of the explanation for a
 *    selected text (recursive: carries parent context + depth). Model is
 *    resolved live (agent default → captured main-loop route → first
 *    provider) and the call runs with reasoning off for instant output.
 *  - GET/POST /bubble-explain/settings → read/write the plugin's persisted
 *    preferences (enabled / maxDepth / maxChars) to $DSH_HOME/envir … a JSON
 *    file so choices survive restarts.
 * @module dsh-bubble-explain
 */

import type { Context } from '@deepseek-ai/cordis'
import type LlmService from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import {
  DEFAULT_MAX_CHARS,
  MAX_DEPTH,
  buildSystemPrompt,
  buildUserMessage,
  parseExplainRequest,
  resolveModelRoute,
  type ModelRoute,
} from './explain.js'

type AppContext = Context & {
  llm: LlmService
  webServer: {
    register(route: {
      kind: 'prefix' | 'exact'
      path: string
      handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
    }): () => void
  }
}

export const name = '@dsh-external/bubble-explain'
export const inject = ['webServer', 'llm']

/** On-disk, restart-surviving plugin preferences. */
export interface PersistedSettings {
  enabled: boolean
  maxDepth: number
  maxChars: number
}

const DEFAULT_SETTINGS: PersistedSettings = {
  enabled: true,
  maxDepth: MAX_DEPTH,
  maxChars: DEFAULT_MAX_CHARS,
}

const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const SETTINGS_FILE = join(DSH_HOME, 'dsh-bubble-explain.settings.json')

function loadSettings(): PersistedSettings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as Partial<PersistedSettings>
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
      maxDepth: clampInt(raw.maxDepth, 1, MAX_DEPTH, DEFAULT_SETTINGS.maxDepth),
      maxChars: clampInt(raw.maxChars, 50, 1000, DEFAULT_SETTINGS.maxChars),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(next: PersistedSettings): PersistedSettings {
  const merged: PersistedSettings = {
    enabled: typeof next.enabled === 'boolean' ? next.enabled : DEFAULT_SETTINGS.enabled,
    maxDepth: clampInt(next.maxDepth, 1, MAX_DEPTH, DEFAULT_SETTINGS.maxDepth),
    maxChars: clampInt(next.maxChars, 50, 1000, DEFAULT_SETTINGS.maxChars),
  }
  try {
    mkdirSync(join(DSH_HOME), { recursive: true })
    writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8')
  } catch { /* persistence failure is non-fatal */ }
  return merged
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Same-origin fence mirroring neighbouring bundle plugins. */
function isTrusted(req: import('node:http').IncomingMessage, ctx: AppContext): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (host === undefined) return true
  if (origin === undefined) return true
  try {
    const o = new URL(origin)
    return o.host === host
  } catch {
    return false
  }
}

function writeJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim().length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new TypeError('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx: AppContext): void {
  let lastRoute: ModelRoute | undefined

  // Capture the main loop's route so the explain call can reuse it when the
  // agent has no explicit selection.
  ctx.on('llm/stream', (options: { provider?: string; model?: string }, next: () => AsyncIterable<StreamChunk>) => {
    if (typeof options.provider === 'string' && typeof options.model === 'string' && options.provider.length > 0 && options.model.length > 0) {
      lastRoute = { provider: options.provider, model: options.model }
    }
    return next()
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/bubble-explain/stream',
    handler: (req, res) => {
      void (async () => {
        if (!isTrusted(req, ctx)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        if ((req.method ?? '').toUpperCase() !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let request
        try {
          request = parseExplainRequest(await readJsonBody(req))
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          return
        }
        const settings = loadSettings()
        if (!settings.enabled) {
          writeJson(res, 403, { ok: false, error: '框选解释已关闭（设置 → 通用 → 框选解释）' })
          return
        }

        let route: ModelRoute
        try {
          route = resolveModelRoute(ctx, lastRoute)
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        const write = (data: unknown): void => {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }
        write({ ok: true })

        try {
          let text = ''
          const stream = ctx.llm.stream({
            provider: route.provider,
            model: route.model,
            reasoningEffort: ReasoningEffortId('off'),
            system: buildSystemPrompt(request),
            temperature: 0.3,
            maxTokens: Math.min(2000, request.maxChars * 2 + 200),
            messages: [
              createUserMessage({
                source: { kind: 'user' },
                content: [{ type: 'text', text: buildUserMessage(request) }],
              }),
            ],
          })
          for await (const chunk of stream) {
            if (chunk.type === 'text-delta' && chunk.text.length > 0) {
              text += chunk.text
              write({ t: chunk.text })
            } else if (chunk.type === 'finish') {
              const reason = chunk.reason
              if (reason && (reason.kind === 'error' || reason.kind === 'aborted')) {
                write({ error: (reason.failure && reason.failure.message) || String(reason.kind) })
                text = ''
              }
            }
          }
          if (text.length > 0) write({ done: true })
        } catch (error) {
          write({ error: error instanceof Error ? error.message : String(error) })
        } finally {
          res.end()
        }
      })().catch((error) => {
        if (!res.writableEnded) {
          try {
            writeJson(res, 500, { ok: false, error: String(error && error.message || error) })
          } catch { /* headers already sent */ }
        }
      })
    },
  }), '@dsh-external/bubble-explain: /stream SSE route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/bubble-explain/settings',
    handler: (req, res) => {
      void (async () => {
        if (!isTrusted(req, ctx)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const method = (req.method ?? '').toUpperCase()
        if (method === 'GET') {
          writeJson(res, 200, loadSettings())
          return
        }
        if (method === 'POST' || method === 'PUT') {
          let body: unknown
          try {
            body = await readJsonBody(req)
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            return
          }
          const next = loadSettings()
          if (typeof (body as { enabled?: unknown })?.enabled === 'boolean') {
            next.enabled = (body as { enabled: boolean }).enabled
          }
          if (typeof (body as { maxDepth?: unknown })?.maxDepth === 'number') {
            next.maxDepth = clampInt((body as { maxDepth: number }).maxDepth, 1, MAX_DEPTH, DEFAULT_SETTINGS.maxDepth)
          }
          if (typeof (body as { maxChars?: unknown })?.maxChars === 'number') {
            next.maxChars = clampInt((body as { maxChars: number }).maxChars, 50, 1000, DEFAULT_SETTINGS.maxChars)
          }
          writeJson(res, 200, saveSettings(next))
          return
        }
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
      })().catch((error) => {
        try {
          writeJson(res, 500, { ok: false, error: String(error && error.message || error) })
        } catch { /* headers already sent */ }
      })
    },
  }), '@dsh-external/bubble-explain: /settings route')

  ctx.logger?.info?.('[' + name + '] mounted: /bubble-explain/stream + /bubble-explain/settings')
}
