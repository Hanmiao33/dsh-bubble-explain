/**
 * dsh-bubble-explain host core: request validation, prompt assembly, and the
 * live provider/model route resolver. Kept side-effect free so it composes
 * cleanly with the SSE streaming handler in index.ts.
 * @module dsh-bubble-explain/explain
 */
import type { Context } from '@deepseek-ai/cordis';
/** Browser route the bubble overlay POSTs to (streaming SSE). */
export declare const EXPLAIN_ROUTE = "/bubble-explain/stream";
/** Defaults + upper bounds enforced on both sides of the wire. */
export declare const MAX_TEXT_CHARS = 4000;
export declare const MAX_PARENT_CHARS = 10000;
export declare const MAX_DEPTH = 6;
export declare const DEFAULT_MAX_CHARS = 300;
export declare const MIN_MAX_CHARS = 50;
export declare const MAX_MAX_CHARS = 1000;
/** One provider/model route a harness model call can be dispatched through. */
export interface ModelRoute {
    provider: string;
    model: string;
}
/** Wire payload of one explain request (recursive or top-level). */
export interface ExplainRequest {
    text: string;
    parent: {
        text: string;
        explanation: string;
    } | null;
    depth: number;
    maxChars: number;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Validate and normalize a raw request body; throws TypeError on bad shape. */
export declare function parseExplainRequest(value: unknown): ExplainRequest;
/** Assemble the system prompt for one explain call (top-level or recursive). */
export declare function buildSystemPrompt(req: ExplainRequest): string;
/** The user message carries the selected text (and outer context chain for recursion). */
export declare function buildUserMessage(req: ExplainRequest): string;
/** Resolve a live provider/model route: agent default selection first, then
 * the last observed main-loop route, then the first registered provider. */
export declare function resolveModelRoute(ctx: Context, lastRoute?: ModelRoute | undefined): ModelRoute;
