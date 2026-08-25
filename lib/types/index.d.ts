/**
 * @dsh-external/bubble-explain — host half.
 *
 * Mounts two HTTP routes on the DSH webServer:
 *  - POST /bubble-explain/stream  → SSE stream of the explanation for a
 *    selected text (recursive: carries parent context + depth). Model is
 *    resolved live (agent default → captured main-loop route → first
 *    provider); the reasoning effort comes from persisted settings and is
 *    clamped onto what the resolved model actually declares.
 *  - GET/POST /bubble-explain/settings → read/write the plugin's persisted
 *    preferences (enabled / maxDepth / maxChars) to $DSH_HOME/envir … a JSON
 *    file so choices survive restarts.
 * @module dsh-bubble-explain
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import { type EffortId } from './explain.js';
type AppContext = Context & {
    llm: LlmService;
    webServer: {
        register(route: {
            kind: 'prefix' | 'exact';
            path: string;
            handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>;
        }): () => void;
    };
};
export declare const name = "@dsh-external/bubble-explain";
export declare const inject: string[];
/** On-disk, restart-surviving plugin preferences. */
export interface PersistedSettings {
    enabled: boolean;
    maxDepth: number;
    maxChars: number;
    /** Requested model reasoning strength; clamped per model at call time. */
    effort: EffortId;
}
export declare function apply(ctx: AppContext): void;
export {};
