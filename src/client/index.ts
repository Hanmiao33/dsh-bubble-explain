/**
 * @dsh-external/bubble-explain — browser half (single self-contained module).
 *
 * Registers into:
 *  - shell.overlay: the selection → 「✨ 解释」button → bubble overlay engine.
 *  - settings.section: a 「框选解释」 entry in the settings list (config page).
 *
 * Talks to the host through the /bubble-explain/stream SSE route and
 * /bubble-explain/settings JSON routes (bundle clients have no host.call).
 * React is the only external require; everything else is inline so the
 * bundle matches the loader's seed/static requirement.
 * @module dsh-bubble-explain/client
 */

import React from 'react'

export const inject = ['slots']

const EXPLAIN_ROUTE = '/bubble-explain/stream'
const SETTINGS_ROUTE = '/bubble-explain/settings'

const MIN_CHARS = 2
const MAX_TEXT_CHARS = 4000
const MAX_DEPTH = 6
const MAX_BUBBLES = 8
const QUOTE_COLLAPSE_CHARS = 240

interface PluginSettings {
  enabled: boolean
  maxDepth: number
  maxChars: number
  /** Requested model reasoning strength ('off'|'low'|'medium'|'high'|'max'). */
  effort: string
}

const DEFAULT_SETTINGS: PluginSettings = { enabled: true, maxDepth: 6, maxChars: 300, effort: 'off' }

/** Reasoning-effort options shown in settings; values mirror the host whitelist. */
const EFFORT_OPTIONS = [
  { value: 'off', label: '关闭（最快）' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最高' },
] as const

function isEffortId(value: unknown): value is PluginSettings['effort'] {
  return typeof value === 'string' && EFFORT_OPTIONS.some((option) => option.value === value)
}

// ---------------------------------------------------------------------------
// Markdown mini-renderer (streaming-safe; input escaped before structuring)
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(u: string): string | null {
  const t = u.trim()
  if (/^(https?:\/\/|mailto:|#)/i.test(t)) return t
  if (/^www\./i.test(t)) return 'https://' + t
  return null
}

function inlineMd(value: string): string {
  let out = escapeHtml(value)
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  out = out.replace(/(^|\s)(https?:\/\/[^\s<>"']+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
  return out
}

function renderMarkdown(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let inCode = false
  let codeBuffer: string[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    out.push(`<p>${inlineMd(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushCode = (): void => {
    if (codeBuffer.length === 0) return
    out.push(`<pre><code>${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`)
    codeBuffer = []
  }

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      flushParagraph()
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(raw)
      continue
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      flushParagraph()
      continue
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushParagraph()
      out.push(`<h5>${inlineMd(trimmed.replace(/^#{1,4}\s+/, ''))}</h5>`)
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph()
      out.push(`<li>${inlineMd(trimmed.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph()
      out.push(`<li>${inlineMd(trimmed.replace(/^\d+[.)]\s+/, ''))}</li>`)
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      flushParagraph()
      out.push(`<blockquote>${inlineMd(trimmed.replace(/^>\s?/, ''))}</blockquote>`)
      continue
    }
    paragraph.push(raw)
  }
  flushParagraph()
  flushCode()
  return out.join('')
}

// ---------------------------------------------------------------------------
// Overlay engine (pure DOM, framework-free)
// ---------------------------------------------------------------------------

interface Bubble {
  id: number
  depth: number
  parent: Bubble | null
  text: string
  el: HTMLDivElement
  bodyEl: HTMLDivElement
  content: string
  status: 'streaming' | 'done' | 'error'
  controller: AbortController | null
  renderQueued: boolean
  lastError: string
}

const CSS = `
.bbl-layer{position:absolute;inset:0;pointer-events:none;z-index:2147483000}
.bbl{position:fixed;pointer-events:auto;width:min(400px,calc(100vw - 24px));max-height:60vh;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#d5d8de);background:var(--dsw-alias-bg-base,#1f2329);color:var(--dsw-alias-label-primary,#e6e8eb);box-shadow:0 12px 32px rgba(0,0,0,.24);font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}
.bbl-head{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 10px;background:var(--dsw-alias-bg-layer-2,#23272e);cursor:grab;user-select:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));flex:none}
.bbl-head:active{cursor:grabbing}
.bbl-badge{flex:none;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:99px;color:var(--dsw-alias-state-business-primary,#6a9bff);background:rgba(106,155,255,.14)}
.bbl-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary,#8a8f98)}
.bbl-btn{flex:none;width:22px;height:22px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#8a8f98);font-size:13px;line-height:1;cursor:pointer;padding:0}
.bbl-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.bbl-quote{margin:8px 10px 0;padding:6px 9px;border-left:3px solid var(--dsw-alias-state-business-primary,#6a9bff);border-radius:0 7px 7px 0;background:var(--dsw-alias-bg-layer-2,#23272e);color:var(--dsw-alias-label-secondary,#8a8f98);font-size:11.5px;max-height:80px;overflow:hidden;flex:none}
.bbl-body{margin:8px 10px 4px;overflow-y:auto;overscroll-behavior:contain;min-height:18px;flex:1}
.bbl-body p{margin:0 0 6px}.bbl-body p:last-child{margin-bottom:0}
.bbl-body h5{margin:6px 0 4px;font-size:12px}
.bbl-body ul,.bbl-body ol{margin:0 0 6px;padding-left:18px}
.bbl-body li{margin:1px 0}
.bbl-body code{font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--dsw-alias-bg-layer-2,#23272e);border-radius:4px;padding:1px 4px}
.bbl-body pre{margin:0 0 6px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#23272e);overflow-x:auto}
.bbl-body pre code{background:transparent;padding:0;color:inherit}
.bbl-caret{display:inline-block;width:7px;height:13px;margin-left:2px;vertical-align:-2px;background:var(--dsw-alias-state-business-primary,#6a9bff);animation:bbl-blink .9s steps(2) infinite;border-radius:1px}
@keyframes bbl-blink{50%{opacity:.15}}
.bbl-foot{padding:5px 10px 8px;color:var(--dsw-alias-label-caption,#8a919c);font-size:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));display:flex;gap:8px;align-items:center;flex:none}
.bbl-error{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:11.5px;margin:2px 0 6px;white-space:pre-wrap}
.bbl-empty{color:var(--dsw-alias-label-caption,#8a919c);font-size:11.5px;margin:2px 0 6px}
.bbl-pending{position:fixed;z-index:2147483100;pointer-events:auto;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-alias-bg-base,#1f2329);color:var(--dsw-alias-state-business-primary,#6a9bff);font-size:12px;font-weight:600;border-radius:999px;padding:5px 12px;box-shadow:0 4px 16px rgba(0,0,0,.24);cursor:pointer;user-select:none;white-space:nowrap}
.bbl-pending:hover{background:var(--dsw-alias-bg-layer-2,#23272e)}
.bbl-settings{display:flex;flex-direction:column;gap:14px;padding:4px 2px}
.bbl-set-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.bbl-set-label{font-size:13px;color:var(--dsw-alias-label-primary,inherit)}
.bbl-set-row input[type="number"]{width:96px;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:6px;background:var(--dsw-alias-bg-base,#1f2329);color:var(--dsw-alias-label-primary,inherit);font-size:13px}
.bbl-set-row select{padding:4px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:6px;background:var(--dsw-alias-bg-base,#1f2329);color:var(--dsw-alias-label-primary,inherit);font-size:13px;cursor:pointer}
.bbl-set-row input[type="checkbox"]{width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary,#6a9bff);cursor:pointer}
@media (max-width:720px){.bbl{width:calc(100vw - 16px)}}
`

class BubbleOverlay {
  private readonly bubbles = new Map<number, Bubble>()
  private nextId = 1
  private pendingEl: HTMLButtonElement | null = null
  private pending: { text: string; anchor: DOMRect; parent: Bubble | null; depth: number } | null = null
  private layer: HTMLDivElement | null = null
  private styleEl: HTMLStyleElement | null = null
  private disposed = false
  private settings: PluginSettings = { ...DEFAULT_SETTINGS }

  private onMouseUp = (event: MouseEvent): void => {
    if (this.disposed) return
    const target = event.target as Node | null
    if (this.pendingEl !== null && this.pendingEl.contains(target)) return
    if (!this.settings.enabled) { this.clearPending(); return }
    const selection = window.getSelection()
    const text = selection === null ? '' : selection.toString().trim()
    if (text.length < MIN_CHARS || !this.selectionInPage(selection)) { this.clearPending(); return }
    const range = selection?.getRangeAt(0)
    const rect = range?.getBoundingClientRect()
    if (rect === undefined || rect.width <= 1 || rect.height <= 1) { this.clearPending(); return }
    const parent = this.bubbleOfSelection(selection)
    const depth = parent === null ? 0 : parent.depth + 1
    this.showPending({ text: text.slice(0, MAX_TEXT_CHARS), anchor: rect, parent, depth })
  }

  private onMouseDown = (event: MouseEvent): void => {
    const target = event.target as Node | null
    if (this.pendingEl !== null && this.pendingEl.contains(target)) return
    if (target !== null && this.isInsideBubble(target)) return
    this.clearPending()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { this.closeAll(); this.clearPending() }
  }

  loadSettings(): Promise<void> {
    return fetch(SETTINGS_ROUTE, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<PluginSettings> | null) => {
        if (data === null) return
        const s = { ...this.settings }
        if (typeof data.enabled === 'boolean') s.enabled = data.enabled
        if (typeof data.maxDepth === 'number') s.maxDepth = Math.min(MAX_DEPTH, Math.max(1, Math.round(data.maxDepth)))
        if (typeof data.maxChars === 'number') s.maxChars = Math.min(1000, Math.max(50, Math.round(data.maxChars)))
        if (isEffortId(data.effort)) s.effort = data.effort
        this.settings = s
      })
      .catch(() => undefined)
  }

  setSettings(patch: Partial<PluginSettings>): void {
    this.settings = { ...this.settings, ...patch }
    if (!this.settings.enabled) this.clearPending()
  }

  private clearPending(): void {
    this.pending = null
    if (this.pendingEl !== null) { this.pendingEl.remove(); this.pendingEl = null }
  }

  private showPending(value: { text: string; anchor: DOMRect; parent: Bubble | null; depth: number }): void {
    this.pending = value
    if (this.pendingEl === null || !this.pendingEl.isConnected) {
      this.pendingEl = document.createElement('button')
      this.pendingEl.type = 'button'
      this.pendingEl.className = 'bbl-pending'
      this.pendingEl.textContent = '✨ 解释'
      this.pendingEl.addEventListener('click', (ev) => { ev.stopPropagation(); this.confirmPending() })
      if (this.layer !== null) this.layer.appendChild(this.pendingEl)
    }
    const btn = this.pendingEl
    const bw = 88
    const bh = 30
    let left = value.anchor.right + 8
    let top = value.anchor.bottom + 8
    if (left + bw > window.innerWidth - 8) left = Math.max(8, value.anchor.left - bw - 8)
    if (top + bh > window.innerHeight - 8) top = Math.max(8, value.anchor.top - bh - 8)
    btn.style.left = `${Math.round(left)}px`
    btn.style.top = `${Math.round(top)}px`
  }

  private confirmPending(): void {
    const value = this.pending
    this.clearPending()
    if (value === null || this.disposed) return
    if (value.parent !== null && value.depth > this.settings.maxDepth) { this.showDepthLimit(value.parent, value.depth); return }
    if (this.bubbles.size >= MAX_BUBBLES) {
      const oldest = [...this.bubbles.values()].sort((a, b) => a.id - b.id)[0]
      if (oldest !== undefined) this.closeBubble(oldest.id)
    }
    this.createBubble(value)
  }

  private selectionInPage(selection: Selection | null): boolean {
    if (selection === null || selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (range.collapsed) return false
    const container = range.commonAncestorContainer
    const element = container instanceof Element ? container : container.parentElement
    if (element === null) return false
    if (element.closest('input, textarea, select, [contenteditable="true"]') !== null) return false
    const rect = range.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }

  private bubbleOfSelection(selection: Selection | null): Bubble | null {
    if (selection === null || selection.rangeCount === 0) return null
    const container = selection.getRangeAt(0).commonAncestorContainer
    const element = container instanceof Element ? container : container.parentElement
    const host = element?.closest?.('.bbl')
    if (host === null || host === undefined) return null
    const id = Number((host as HTMLElement).dataset.id)
    return this.bubbles.get(id) ?? null
  }

  private isInsideBubble(node: Node): boolean {
    const element = node instanceof Element ? node : node.parentElement
    return element?.closest('.bbl') !== null
  }

  attachTo(host: HTMLElement | null): void {
    if (host === null) return
    this.disposed = false
    this.styleEl = document.createElement('style')
    this.styleEl.dataset.plugin = 'dsh-bubble-explain'
    this.styleEl.textContent = CSS
    document.head.appendChild(this.styleEl)
    this.layer = document.createElement('div')
    this.layer.className = 'bbl-layer'
    host.appendChild(this.layer)
    document.addEventListener('mouseup', this.onMouseUp, true)
    document.addEventListener('mousedown', this.onMouseDown, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    void this.loadSettings()
  }

  detach(): void {
    this.disposed = true
    document.removeEventListener('mouseup', this.onMouseUp, true)
    document.removeEventListener('mousedown', this.onMouseDown, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    this.closeAll()
    this.clearPending()
    this.layer?.remove()
    this.layer = null
    this.styleEl?.remove()
    this.styleEl = null
  }

  private createBubble(options: { text: string; parent: Bubble | null; depth: number; anchor: DOMRect }): void {
    const id = this.nextId++
    const el = document.createElement('div')
    el.className = 'bbl'
    el.dataset.id = String(id)
    const quoteText = options.text.length > QUOTE_COLLAPSE_CHARS ? `${options.text.slice(0, QUOTE_COLLAPSE_CHARS)}…` : options.text
    el.innerHTML = `
      <header class="bbl-head">
        <span class="bbl-badge">${options.depth === 0 ? '框选解释' : `递归解释 · L${options.depth}`}</span>
        <span class="bbl-title">${options.depth === 0 ? '' : '外层语境已带上'}</span>
        <button type="button" class="bbl-btn" data-action="copy" title="复制解释">⧉</button>
        <button type="button" class="bbl-btn" data-action="close" title="关闭">×</button>
      </header>
      <div class="bbl-quote">「${escapeHtml(quoteText)}」</div>
      <div class="bbl-body"></div>
      <footer class="bbl-foot">
        <span class="bbl-hint">拖动标题栏移动 · 在解释内再框选并点「解释」可递归追问</span>
      </footer>
    `
    const bubble: Bubble = {
      id, depth: options.depth, parent: options.parent, text: options.text,
      el, bodyEl: el.querySelector('.bbl-body') as HTMLDivElement,
      content: '', status: 'streaming', controller: null, renderQueued: false, lastError: '',
    }
    this.bubbles.set(id, bubble)
    this.layer?.appendChild(el)
    this.positionBubble(bubble, options.anchor)
    this.bindBubble(bubble)
    this.renderBody(bubble)
    void this.stream(bubble)
  }

  private positionBubble(bubble: Bubble, anchor: DOMRect): void {
    const width = bubble.el.offsetWidth || 380
    const height = bubble.el.offsetHeight || 120
    const gap = 10
    const depthShift = Math.min(bubble.depth, 6) * 10
    let left = anchor.left + depthShift
    let top = anchor.top - height - gap
    if (top < 8) top = anchor.bottom + gap + depthShift
    left = Math.min(Math.max(left, 8), window.innerWidth - width - 8)
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8)
    bubble.el.style.left = `${Math.round(left)}px`
    bubble.el.style.top = `${Math.round(top)}px`
  }

  private bindBubble(bubble: Bubble): void {
    const el = bubble.el
    el.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest?.('[data-action]') as HTMLElement | null
      if (button === null) return
      if (button.dataset.action === 'close') this.closeBubble(bubble.id)
      else if (button.dataset.action === 'copy') void navigator.clipboard?.writeText(bubble.content).catch(() => undefined)
    })
    const head = el.querySelector('.bbl-head') as HTMLElement
    head.addEventListener('pointerdown', (event) => {
      if ((event.target as Element | null)?.closest?.('button') !== null) return
      event.preventDefault()
      const startX = event.clientX
      const startY = event.clientY
      const originLeft = bubble.el.offsetLeft
      const originTop = bubble.el.offsetTop
      const move = (moveEvent: PointerEvent): void => {
        bubble.el.style.left = `${Math.round(originLeft + moveEvent.clientX - startX)}px`
        bubble.el.style.top = `${Math.round(originTop + moveEvent.clientY - startY)}px`
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    })
  }

  private renderBody(bubble: Bubble): void {
    const streaming = bubble.status === 'streaming'
    let html = ''
    if (bubble.content.length === 0 && streaming) {
      html = '<div class="bbl-empty">解释中…</div>'
    } else {
      html = renderMarkdown(bubble.content)
      if (streaming) html += '<span class="bbl-caret"></span>'
    }
    if (bubble.status === 'error') html += `<div class="bbl-error">${escapeHtml(bubble.lastError)}</div>`
    bubble.bodyEl.innerHTML = html
    bubble.bodyEl.scrollTop = bubble.bodyEl.scrollHeight
  }

  private queueRender(bubble: Bubble): void {
    if (bubble.renderQueued) return
    bubble.renderQueued = true
    requestAnimationFrame(() => {
      bubble.renderQueued = false
      if (this.bubbles.has(bubble.id)) this.renderBody(bubble)
    })
  }

  private async stream(bubble: Bubble): Promise<void> {
    const parent = bubble.parent
    const controller = new AbortController()
    bubble.controller = controller
    const payload = {
      text: bubble.text,
      parent: parent === null ? null : { text: parent.text, explanation: parent.content },
      depth: bubble.depth,
      maxChars: this.settings.maxChars,
    }
    try {
      const response = await fetch(EXPLAIN_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        let detail = `HTTP ${response.status}`
        try {
          const text = await response.text()
          if (text.length > 0) detail = text.slice(0, 300)
        } catch { /* keep status */ }
        throw new Error(detail)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          this.consumeSseLine(bubble, chunk)
        }
      }
      if (buffer.trim().length > 0) this.consumeSseLine(bubble, buffer)
      if (bubble.status === 'streaming') bubble.status = 'done'
    } catch (error) {
      if (bubble.status !== 'streaming') return
      bubble.status = 'error'
      bubble.lastError = error instanceof Error && error.name === 'AbortError'
        ? '已取消'
        : `解释失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      bubble.controller = null
      if (this.bubbles.has(bubble.id)) this.renderBody(bubble)
    }
  }

  private consumeSseLine(bubble: Bubble, chunk: string): void {
    for (const rawLine of chunk.split('\n')) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        if (bubble.status === 'streaming') bubble.status = 'done'
        return
      }
      let parsed: { t?: unknown; error?: unknown; done?: unknown }
      try {
        parsed = JSON.parse(data) as { t?: unknown; error?: unknown; done?: unknown }
      } catch { continue }
      if (typeof parsed.t === 'string' && parsed.t.length > 0) {
        bubble.content += parsed.t
        this.queueRender(bubble)
      } else if (typeof parsed.error === 'string' && parsed.error.length > 0) {
        bubble.status = 'error'
        bubble.lastError = parsed.error
      } else if (parsed.done === true) {
        if (bubble.status === 'streaming') bubble.status = 'done'
        this.queueRender(bubble)
      }
    }
  }

  private showDepthLimit(parent: Bubble, depth: number): void {
    const el = document.createElement('div')
    el.className = 'bbl'
    el.style.left = `${parent.el.offsetLeft + 20}px`
    el.style.top = `${parent.el.offsetTop + 40}px`
    el.innerHTML = `
      <header class="bbl-head"><span class="bbl-badge">递归解释 · L${depth}</span><span class="bbl-title">已达递归上限</span><button type="button" class="bbl-btn" data-action="close" title="关闭">×</button></header>
      <div class="bbl-body"><div class="bbl-error">已达到最大递归深度 ${this.settings.maxDepth} 层。关闭部分气泡后可继续。</div></div>
    `
    this.layer?.appendChild(el)
    const remove = (): void => { el.remove() }
    el.querySelector('[data-action="close"]')?.addEventListener('click', remove)
    window.setTimeout(remove, 4000)
  }

  private closeBubble(id: number): void {
    const bubble = this.bubbles.get(id)
    if (bubble === undefined) return
    for (const child of [...this.bubbles.values()]) {
      if (child.parent?.id === id) this.closeBubble(child.id)
    }
    bubble.controller?.abort()
    bubble.el.remove()
    this.bubbles.delete(id)
  }

  private closeAll(): void {
    for (const id of [...this.bubbles.keys()]) this.closeBubble(id)
  }
}

// ---------------------------------------------------------------------------
// Shared settings bridge + React shells
// ---------------------------------------------------------------------------

interface RuntimeState {
  settings: PluginSettings
  overlay: BubbleOverlay | null
  subscribers: Set<() => void>
}

const state: RuntimeState = { settings: { ...DEFAULT_SETTINGS }, overlay: null, subscribers: new Set() }

function notify(): void {
  for (const sub of [...state.subscribers]) {
    try { sub() } catch { /* ignore */ }
  }
}

function applySettings(next: Partial<PluginSettings>): void {
  state.settings = { ...state.settings, ...next }
  state.overlay?.setSettings(next)
  notify()
}

function submitSettings(patch: Partial<PluginSettings>): void {
  applySettings(patch)
  void fetch(SETTINGS_ROUTE, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => undefined)
}

function refreshSettings(): void {
  void fetch(SETTINGS_ROUTE, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: Partial<PluginSettings> | null) => {
      if (data === null) return
      applySettings({
        enabled: typeof data.enabled === 'boolean' ? data.enabled : state.settings.enabled,
        maxDepth: typeof data.maxDepth === 'number' ? data.maxDepth : state.settings.maxDepth,
        maxChars: typeof data.maxChars === 'number' ? data.maxChars : state.settings.maxChars,
        effort: isEffortId(data.effort) ? data.effort : state.settings.effort,
      })
    })
    .catch(() => undefined)
}

function OverlayHost(_props: unknown): React.ReactNode {
  const ref = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const overlay = new BubbleOverlay()
    state.overlay = overlay
    overlay.attachTo(ref.current)
    return () => {
      overlay.detach()
      if (state.overlay === overlay) state.overlay = null
    }
  }, [])
  return React.createElement('div', { ref, style: { position: 'absolute', inset: 0, pointerEvents: 'none' } })
}

function SettingsPage(): React.ReactNode {
  const [, force] = React.useState(0)
  const settings = state.settings
  React.useEffect(() => {
    const sub = () => force((v) => v + 1)
    state.subscribers.add(sub)
    return () => { state.subscribers.delete(sub) }
  }, [])
  const row = (label: string, control: React.ReactNode): React.ReactNode =>
    React.createElement('div', { className: 'bbl-set-row' },
      React.createElement('span', { className: 'bbl-set-label' }, label), control)
  return React.createElement('div', { className: 'bbl-settings' },
    React.createElement('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#8a8f98)', lineHeight: 1.7, margin: '0 0 4px' } },
      '在对话中框选任意文字后，点击出现的「✨ 解释」按钮弹出气泡，Markdown 实时流式解释，支持递归追问。设置即时生效。「思考强度」控制解释模型的推理力度：档位越高回答越深入但更慢；模型不支持所选档位时自动落到不超过它的最近可用档。'),
    row('启用框选解释',
      React.createElement('input', {
        type: 'checkbox', checked: settings.enabled,
        onChange: (ev: React.ChangeEvent<HTMLInputElement>) => submitSettings({ enabled: ev.target.checked }),
      })),
    row('最大递归深度',
      React.createElement('input', {
        type: 'number', min: 1, max: 6, value: settings.maxDepth,
        onChange: (ev: React.ChangeEvent<HTMLInputElement>) => submitSettings({ maxDepth: Math.min(6, Math.max(1, Number(ev.target.value) || 1)) }),
      })),
    row('解释字数上限',
      React.createElement('input', {
        type: 'number', min: 50, max: 1000, step: 50, value: settings.maxChars,
        onChange: (ev: React.ChangeEvent<HTMLInputElement>) => submitSettings({ maxChars: Math.min(1000, Math.max(50, Number(ev.target.value) || 300)) }),
      })),
    row('思考强度',
      React.createElement('select',
        {
          value: settings.effort,
          onChange: (ev: React.ChangeEvent<HTMLSelectElement>) => submitSettings({ effort: ev.target.value }),
        },
        EFFORT_OPTIONS.map((option) =>
          React.createElement('option', { key: option.value, value: option.value }, option.label))),
    ),
  )
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

interface ClientContext {
  slots: {
    inject(key: string, callback: () => { dispose(): void } | void): void
    register(
      options: { name: string; id: string; order?: number; label?: () => string },
      component: React.ComponentType<unknown>,
    ): { dispose(): void }
  }
  effect(callback: () => void | (() => void), label?: string): () => void
}

let cssInserted = false

export function apply(ctx: ClientContext): void {
  if (!cssInserted) {
    cssInserted = true
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-bubble-explain'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  ctx.effect(() => ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'bubble-explain' }, OverlayHost),
  ), '@dsh-external/bubble-explain: overlay')

  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'bubble-explain', order: 85, label: () => '框选解释' }, SettingsPage),
  ), '@dsh-external/bubble-explain: settings')

  refreshSettings()
}
