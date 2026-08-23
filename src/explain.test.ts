import { describe, expect, it } from 'vitest'
import {
  buildSystemPrompt,
  buildUserMessage,
  DEFAULT_MAX_CHARS,
  MAX_DEPTH,
  MAX_MAX_CHARS,
  MAX_PARENT_CHARS,
  MAX_TEXT_CHARS,
  MIN_MAX_CHARS,
  parseExplainRequest,
  resolveModelRoute,
} from './explain.js'
import type { Context } from '@deepseek-ai/cordis'

describe('parseExplainRequest', () => {
  it('normalizes a minimal valid request', () => {
    expect(parseExplainRequest({ text: '  hello  ' })).toEqual({
      text: 'hello',
      parent: null,
      depth: 0,
      maxChars: DEFAULT_MAX_CHARS,
    })
  })

  it('rejects non-record bodies and missing text', () => {
    expect(() => parseExplainRequest(null)).toThrow(TypeError)
    expect(() => parseExplainRequest('text')).toThrow(TypeError)
    expect(() => parseExplainRequest({})).toThrow(/text is required/)
    expect(() => parseExplainRequest({ text: 42 })).toThrow(/text is required/)
  })

  it('rejects empty and over-long text', () => {
    expect(() => parseExplainRequest({ text: '   ' })).toThrow(/must not be empty/)
    expect(() => parseExplainRequest({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) })).toThrow(
      /exceeds 4000 characters/,
    )
    // Exactly at the limit is fine.
    expect(parseExplainRequest({ text: 'x'.repeat(MAX_TEXT_CHARS) }).text.length).toBe(MAX_TEXT_CHARS)
  })

  it('clamps depth to [0, MAX_DEPTH]', () => {
    expect(parseExplainRequest({ text: 'a', depth: -5 }).depth).toBe(0)
    expect(parseExplainRequest({ text: 'a', depth: 2 }).depth).toBe(2)
    expect(parseExplainRequest({ text: 'a', depth: 99 }).depth).toBe(MAX_DEPTH)
    expect(parseExplainRequest({ text: 'a', depth: '2' }).depth).toBe(0) // non-number → 0
  })

  it('clamps maxChars to [MIN_MAX_CHARS, MAX_MAX_CHARS] with fallback', () => {
    expect(parseExplainRequest({ text: 'a', maxChars: 10 }).maxChars).toBe(MIN_MAX_CHARS)
    expect(parseExplainRequest({ text: 'a', maxChars: 5000 }).maxChars).toBe(MAX_MAX_CHARS)
    expect(parseExplainRequest({ text: 'a', maxChars: '300' }).maxChars).toBe(DEFAULT_MAX_CHARS)
    expect(parseExplainRequest({ text: 'a', maxChars: 150.6 }).maxChars).toBe(151)
  })

  it('validates and clips parent', () => {
    expect(() => parseExplainRequest({ text: 'a', parent: 'x' })).toThrow(/parent must be an object/)
    expect(() => parseExplainRequest({ text: 'a', parent: { text: 'x' } })).toThrow(/must be strings/)
    const long = 'y'.repeat(MAX_PARENT_CHARS + 10)
    const out = parseExplainRequest({ text: 'a', parent: { text: long, explanation: long } })
    expect(out.parent?.text.length).toBe(MAX_PARENT_CHARS + 1) // clipped + ellipsis
    expect(out.parent?.explanation.endsWith('…')).toBe(true)
  })
})

describe('buildSystemPrompt', () => {
  it('sets the length bound from maxChars and omits recursion context at depth 0', () => {
    const p = buildSystemPrompt(parseExplainRequest({ text: 'foo', maxChars: 150 }))
    expect(p).toContain('150 字以内')
    expect(p).not.toContain('父级解释全文')
    expect(p).not.toContain('<parent>')
  })

  it('adds recursion context for a follow-up level', () => {
    const req = parseExplainRequest({
      text: 'foo',
      depth: 3,
      parent: { text: 'outer', explanation: 'outer explanation' },
    })
    const p = buildSystemPrompt(req)
    expect(p).toContain('第 3 层递归追问')
    expect(p).toContain('<parent>outer explanation</parent>')
    expect(p).toContain('"""\nfoo\n"""')
  })
})

describe('buildUserMessage', () => {
  it('includes the parent text when present', () => {
    const msg = buildUserMessage(
      parseExplainRequest({ text: 'foo', parent: { text: 'outer', explanation: 'e' } }),
    )
    expect(msg).toContain('外层选中（父级）')
    expect(msg).toContain('"outer"')
    expect(msg).toContain('"""\nfoo\n"""')
  })

  it('omits the parent block for top-level requests', () => {
    const msg = buildUserMessage(parseExplainRequest({ text: 'foo' }))
    expect(msg).not.toContain('外层选中')
    expect(msg).toContain('本次框选的文字')
  })
})

describe('resolveModelRoute', () => {
  function makeCtx(providers: { id: string }[] = [], selection?: unknown) {
    return {
      get: (key: string) => (key === 'agentDefaultModel' ? { currentSelection: () => selection } : undefined),
      llm: { listProviders: () => providers },
    } as unknown as Context
  }

  it('prefers the agent default selection', () => {
    const ctx = makeCtx([], { provider: 'p1', model: 'm1' })
    expect(resolveModelRoute(ctx)).toEqual({ provider: 'p1', model: 'm1' })
  })

  it('falls through when the default selection is malformed or throws', () => {
    const bad = makeCtx([], { provider: '', model: '' })
    expect(resolveModelRoute(bad, { provider: 'last', model: 'lm' })).toEqual({ provider: 'last', model: 'lm' })

    const throwing = {
      get: () => ({
        currentSelection: () => {
          throw new Error('boom')
        },
      }),
      llm: { listProviders: () => [] },
    } as unknown as Context
    expect(resolveModelRoute(throwing, { provider: 'last', model: 'lm' })).toEqual({
      provider: 'last',
      model: 'lm',
    })
  })

  it('uses the first registered provider as a fallback', () => {
    const ctx = makeCtx([{ id: 'provider-a' }, { id: 'provider-b' }])
    expect(resolveModelRoute(ctx)).toEqual({ provider: 'provider-a', model: 'deepseek-chat' })
  })

  it('throws when nothing is available', () => {
    expect(() => resolveModelRoute(makeCtx([]))).toThrow(/没有可用的 LLM 路由/)
  })
})
