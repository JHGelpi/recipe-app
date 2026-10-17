import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiUnavailableError, costMicroUsd, createGateway, type AiConfig } from './gateway';
import { RECORD_RECIPE_TOOL } from './parseRecipe';

const config: AiConfig = {
  apiKey: 'test-key',
  baseUrl: null,
  model: 'claude-sonnet-5-5',
  priceInputPerMTokUsd: 3,
  priceOutputPerMTokUsd: 15,
  capUsd: 2,
};
const request = { system: 'sys', user: 'user' };

function message(content: unknown[]) {
  return { content, usage: { input_tokens: 1000, output_tokens: 500 } };
}

describe('costMicroUsd', () => {
  it('prices tokens in micro-dollars, rounding up', () => {
    expect(costMicroUsd({ inputTokens: 1000, outputTokens: 500 }, config)).toBe(10_500);
    expect(
      costMicroUsd(
        { inputTokens: 1, outputTokens: 0 },
        { priceInputPerMTokUsd: 0.25, priceOutputPerMTokUsd: 0 },
      ),
    ).toBe(1);
  });
});

describe('createGateway', () => {
  it('forces the tool and returns its input with the usage', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        message([{ type: 'tool_use', id: 't', name: 'record_recipe', input: { title: 'Soup' } }]),
      );
    const gateway = createGateway(config, { messages: { create } } as never);
    const call = await gateway.callTool(request, RECORD_RECIPE_TOOL);
    expect(call).toEqual({
      input: { title: 'Soup' },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    // Claude Sonnet 5.5 rejects a forced tool_choice with a 400; auto plus a
    // strict tool and a prompt that asks for the tool is the supported path.
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 8000,
      system: 'sys',
      tool_choice: { type: 'auto' },
      output_config: { effort: 'low' },
    });
    expect(create.mock.calls[0]?.[0].tools[0]).toMatchObject({
      name: 'record_recipe',
      strict: true,
    });
  });

  it('returns null input when the model answered without the tool', async () => {
    const create = vi.fn().mockResolvedValue(message([{ type: 'text', text: 'hi' }]));
    const call = await createGateway(config, { messages: { create } } as never).callTool(
      request,
      RECORD_RECIPE_TOOL,
    );
    expect(call.input).toBeNull();
  });

  it('is unavailable without a key, and when the call fails', async () => {
    await expect(
      createGateway({ ...config, apiKey: null }).callTool(request, RECORD_RECIPE_TOOL),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    const create = vi.fn().mockRejectedValue(new Error('overloaded'));
    await expect(
      createGateway(config, { messages: { create } } as never).callTool(
        request,
        RECORD_RECIPE_TOOL,
      ),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe('createGateway with the real SDK', () => {
  let server: Server;
  let calls = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      calls++;
      if (calls === 1) {
        res
          .writeHead(529, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
          );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: 'm',
          stop_reason: 'tool_use',
          stop_sequence: null,
          content: [{ type: 'tool_use', id: 't', name: 'record_recipe', input: { title: 'Soup' } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(() => server.close());

  it('retries an overloaded answer once, at the configured base URL', async () => {
    const port = (server.address() as AddressInfo).port;
    const gateway = createGateway({ ...config, baseUrl: `http://127.0.0.1:${port}` });
    const call = await gateway.callTool(request, RECORD_RECIPE_TOOL);
    expect(call.input).toEqual({ title: 'Soup' });
    expect(calls).toBe(2);
  });
});
