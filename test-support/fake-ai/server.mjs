// A stand-in for the Claude API and for recipe pages, used only in test mode
// (docker-compose.test.yml). Deterministic, so tests can assert on drafts.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4010);
const PAGES = new URL('./pages/', import.meta.url);
const requests = []; // the user text of each /v1/messages call, newest last
const failures = new Map(); // FAKE_FAIL_TWICE tokens → failures served so far

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sourceOf(text) {
  const match = /<source>\n?([\s\S]*?)\n?<\/source>/.exec(text);
  return (match ? match[1] : text).trim();
}

function recipeFrom(text) {
  const lines = sourceOf(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('FAKE_'));
  return {
    is_recipe: true,
    title: lines[0] ?? 'Untitled',
    servings: 4,
    prep_minutes: 10,
    cook_minutes: 20,
    ingredients: lines
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2))
      .map((raw) => ({
        raw,
        quantity: null,
        quantity_max: null,
        unit: null,
        item: raw,
        note: null,
        heading: false,
      })),
    steps: lines
      .filter((line) => /^\d+[.)]\s/.test(line))
      .map((line) => line.replace(/^\d+[.)]\s*/, '')),
    tags: ['fake-suggested'],
    author: null,
    low_confidence: ['servings'],
  };
}

async function messages(res, body) {
  // As the Claude 5.5 models do: a forced tool_choice is refused.
  if (body.tool_choice?.type === 'tool' || body.tool_choice?.type === 'any') {
    return send(res, 400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'forced tool use is not supported' },
    });
  }
  const content = body.messages?.[0]?.content;
  const text = typeof content === 'string' ? content : '';
  requests.push(text);
  if (requests.length > 500) requests.shift();

  const failTwice = /FAKE_FAIL_TWICE_(\w+)/.exec(text);
  if (failTwice) {
    const served = failures.get(failTwice[1]) ?? 0;
    if (served < 2) {
      failures.set(failTwice[1], served + 1);
      return send(res, 500, {
        type: 'error',
        error: { type: 'api_error', message: 'fake failure' },
      });
    }
  }
  if (text.includes('FAKE_OVERLOADED')) {
    return send(res, 529, {
      type: 'error',
      error: { type: 'overloaded_error', message: 'fake overload' },
    });
  }
  if (text.includes('FAKE_SLOW')) await new Promise((resolve) => setTimeout(resolve, 3000));

  let input = recipeFrom(text);
  if (text.includes('FAKE_NOT_RECIPE')) input = { ...input, is_recipe: false };
  if (text.includes('FAKE_INVALID')) input = { ...input, title: '' };
  send(res, 200, {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'tool_use', id: 'toolu_fake', name: 'record_recipe', input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 500 },
  });
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'POST' && path === '/v1/messages') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => void messages(res, JSON.parse(raw || '{}')));
    return;
  }
  if (path === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (path === '/__requests') return send(res, 200, { requests });
  if (path === '/pages/redirect-private') {
    res.writeHead(302, { Location: 'http://127.0.0.1:3000/api/health' });
    return res.end();
  }
  const page = /^\/pages\/(jsonld|plain)\.html$/.exec(path);
  if (page) {
    const html = readFileSync(new URL(`${page[1]}.html`, PAGES), 'utf8');
    return send(res, 200, html, 'text/html; charset=utf-8');
  }
  send(res, 404, { error: 'not_found' });
}).listen(PORT, '0.0.0.0');
