// A stand-in for the Claude API, for recipe pages and for GitHub's issues API
// (FR-45), used only in test mode
// (docker-compose.test.yml). Deterministic, so tests can assert on drafts.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4010);
const PAGES = new URL('./pages/', import.meta.url);
const requests = []; // the user text of each /v1/messages call, newest last
const failures = new Map(); // FAKE_FAIL_TWICE tokens → failures served so far
const issues = []; // FR-45: issues filed through /github, newest last

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sourceOf(text) {
  const match = /<source>\n?([\s\S]*?)\n?<\/source>/.exec(text);
  return (match ? match[1] : text).trim();
}

// The text a test put in a JPEG comment (COM) segment, as the fake's "reading".
function jpegComments(bytes) {
  const out = [];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xfe) out.push(bytes.subarray(i + 4, i + 2 + length).toString('utf8'));
    i += 2 + length;
  }
  return out.join('\n');
}

// The e2e fixture pages (test-support/photos) by their size after the phone
// resizes them. The phone re-encodes every photo, which drops JPEG comments,
// so these are recognised by size instead. Keep in step with
// scripts/make-photo-samples.mjs.
const FIXTURE_PAGES = {
  '1000x750': 'Photo Fixture Bread\n- 500 g flour\n- 10 g salt',
  '1000x760': '1. Mix.\n2. Bake.',
  '1568x1176': 'Big Card Soup\n- 1 onion',
};

function jpegSize(bytes) {
  let i = 2;
  while (i + 9 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return `${(bytes[i + 7] << 8) | bytes[i + 8]}x${(bytes[i + 5] << 8) | bytes[i + 6]}`;
    }
    if (marker === 0xda || marker === 0xd9) break;
    i += 2 + length;
  }
  return '';
}

// A page's "reading": its comment if a test wrote one, else a known fixture.
function pageText(bytes) {
  return jpegComments(bytes) || FIXTURE_PAGES[jpegSize(bytes)] || '';
}

// String content as is; for content blocks, the comments of the image pages.
function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const images = content.filter((block) => block.type === 'image');
  const comments = images.map((block) => pageText(Buffer.from(block.source.data, 'base64')));
  return `images:${images.length}\n${comments.join('\n')}`;
}

// FR-43: "Nutrition: 420 kcal, 30 g protein, 45 g carbs, 12 g fat" as the
// source stating it; a trailing "?" marks it unclear (low confidence).
function nutritionFrom(lines) {
  const line = lines.find((l) => l.startsWith('Nutrition:'));
  if (!line) return { nutrition: null, unsure: false };
  const grab = (pattern) => {
    const match = pattern.exec(line);
    return match ? Number(match[1]) : null;
  };
  return {
    nutrition: {
      calories: grab(/(\d+(?:\.\d+)?)\s*kcal/),
      protein_g: grab(/(\d+(?:\.\d+)?)\s*g protein/),
      carbs_g: grab(/(\d+(?:\.\d+)?)\s*g carbs/),
      fat_g: grab(/(\d+(?:\.\d+)?)\s*g fat/),
    },
    unsure: line.endsWith('?'),
  };
}

function recipeFrom(text) {
  const lines = sourceOf(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('FAKE_') && !/^images:\d+$/.test(line));
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
    nutrition: nutritionFrom(lines).nutrition,
    low_confidence: nutritionFrom(lines).unsure ? ['servings', 'nutrition'] : ['servings'],
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
  const text = userText(body.messages?.[0]?.content);
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

  // FR-24: substitutions are asked with the record_substitutes tool.
  if (body.tools?.[0]?.name === 'record_substitutes') {
    let answer = {
      options: [
        { substitute: 'Fake yogurt', amount: '1 cup fake yogurt', how: '', effect: 'Fake effect.' },
        {
          substitute: 'Fake milk and lemon',
          amount: '1 cup fake milk + 1 tbsp lemon',
          how: 'Rest 5 minutes.',
          effect: 'Slightly thinner.',
        },
      ],
      note: null,
    };
    if (text.includes('FAKE_NO_SUBSTITUTE'))
      answer = { options: [], note: 'Nothing works here (fake).' };
    if (text.includes('FAKE_INVALID'))
      answer = { options: [{ ...answer.options[0], substitute: '' }], note: null };
    return send(res, 200, {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'tool_use', id: 'toolu_fake', name: 'record_substitutes', input: answer }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 800, output_tokens: 200 },
    });
  }

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

/**
 * GitHub's "create an issue". A title containing FAKE_GITHUB_DOWN fails the
 * first time it is sent, so tests can see a failure and a retry.
 */
function fileIssue(req, res, raw, repo) {
  if (req.headers.authorization !== 'Bearer fake-github-token') {
    return send(res, 401, { message: 'Bad credentials' });
  }
  const issue = JSON.parse(raw || '{}');
  if (String(issue.title).includes('FAKE_GITHUB_DOWN') && !failures.has(issue.title)) {
    failures.set(issue.title, 1);
    return send(res, 502, { message: 'Server Error' });
  }
  const number = 1000 + issues.length;
  issues.push({ repo, ...issue, number });
  send(res, 201, { number, html_url: `https://github.com/${repo}/issues/${number}` });
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const issuesPath = /^\/github\/repos\/([^/]+\/[^/]+)\/issues$/.exec(path);
  if (req.method === 'POST' && issuesPath) {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => fileIssue(req, res, raw, issuesPath[1]));
    return;
  }
  if (path === '/__issues') return send(res, 200, { issues });
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
