import Anthropic from '@anthropic-ai/sdk';
import type { ParseRequest } from './parseRecipe';

export type AiConfig = {
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  priceInputPerMTokUsd: number;
  priceOutputPerMTokUsd: number;
  capUsd: number;
  /** All households together (issue #63). */
  globalCapUsd: number;
};
export type Usage = { inputTokens: number; outputTokens: number };
export type ToolCall = { input: unknown; usage: Usage };
export type Gateway = { callTool(request: ParseRequest, tool: Anthropic.Tool): Promise<ToolCall> };

/** Claude could not be asked: no key, timeout, overload, or another API failure. */
export class AiUnavailableError extends Error {
  constructor(reason: string) {
    super(`AI unavailable: ${reason}`);
    this.name = 'AiUnavailableError';
  }
}

export const MAX_OUTPUT_TOKENS = 8_000;
export const AI_TIMEOUT_MS = 60_000;
/** One call plus one retry by the SDK. */
export const AI_ATTEMPTS = 2;

/** A price per million tokens in dollars is a price per token in micro-dollars. */
export function costMicroUsd(
  usage: Usage,
  prices: Pick<AiConfig, 'priceInputPerMTokUsd' | 'priceOutputPerMTokUsd'>,
): number {
  return Math.ceil(
    usage.inputTokens * prices.priceInputPerMTokUsd +
      usage.outputTokens * prices.priceOutputPerMTokUsd,
  );
}

/**
 * The only code that calls Claude (ADR-0005). One retry, by the SDK, on
 * overload, 429 and 5xx; 60 s per attempt; output capped.
 *
 * tool_choice is auto: the Claude 5.5 models refuse a forced tool with a 400.
 * The tool is strict, so when it is called its input follows the schema, and
 * the prompt asks for it; an answer without it reads as invalid_output.
 * Effort is low: reading a recipe needs little reasoning, and less thinking
 * keeps the parse fast and cheap.
 */
export function createGateway(config: AiConfig, client?: Pick<Anthropic, 'messages'>): Gateway {
  const anthropic =
    client ??
    (config.apiKey
      ? new Anthropic({
          apiKey: config.apiKey,
          baseURL: config.baseUrl ?? undefined,
          timeout: AI_TIMEOUT_MS,
          maxRetries: AI_ATTEMPTS - 1,
        })
      : null);

  return {
    async callTool(request, tool) {
      if (!anthropic) throw new AiUnavailableError('ANTHROPIC_API_KEY is not set');
      let message: Anthropic.Message;
      try {
        message = await anthropic.messages.create({
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          tools: [tool],
          tool_choice: { type: 'auto' },
          output_config: { effort: 'low' },
        });
      } catch (error) {
        throw new AiUnavailableError(error instanceof Error ? error.message : String(error));
      }
      const block = message.content.find(
        (part): part is Anthropic.ToolUseBlock =>
          part.type === 'tool_use' && part.name === tool.name,
      );
      return {
        input: block ? block.input : null,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    },
  };
}
