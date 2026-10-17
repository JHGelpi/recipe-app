import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isBlockedAddress } from './addresses';

export type FetchOptions = {
  /** Host names exempt from the address check. Test-only (IMPORT_FETCH_ALLOW_HOSTS). */
  allowHosts: readonly string[];
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** For tests; real DNS otherwise. */
  resolve?: (host: string) => Promise<string[]>;
};

export type FetchResult =
  | { ok: true; html: string; url: string }
  | { ok: false; error: 'fetch_failed' | 'blocked_address' };

export const FETCH_DEFAULTS = { timeoutMs: 10_000, maxBytes: 3 * 1024 * 1024, maxRedirects: 5 };

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const FAILED: FetchResult = { ok: false, error: 'fetch_failed' };
const BLOCKED: FetchResult = { ok: false, error: 'blocked_address' };

class Blocked extends Error {}

async function resolveAll(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
}

/** The one address to connect to. Every address the host has must be public. */
async function checkedAddress(hostname: string, options: FetchOptions): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = options.allowHosts.includes(host);
  const addresses = isIP(host) ? [host] : await (options.resolve ?? resolveAll)(host);
  if (addresses.length === 0) throw new Error('no address');
  if (!allowed && addresses.some(isBlockedAddress)) throw new Blocked();
  return addresses[0]!;
}

type Answer = { status: number; location?: string; body?: string };

function requestOnce(
  url: URL,
  address: string,
  options: FetchOptions,
  signal: AbortSignal,
): Promise<Answer> {
  // The socket goes to the address checked above, so a second DNS answer
  // (rebinding) cannot send it anywhere else.
  const family = isIP(address);
  const lookup = ((
    _host: string,
    opts: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (opts.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  }) as unknown as LookupFunction;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = lib.request(
      url,
      {
        method: 'GET',
        lookup,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ status, location: response.headers.location });
          return;
        }
        const type = String(response.headers['content-type'] ?? '');
        const declared = Number(response.headers['content-length'] ?? 0);
        if (
          status !== 200 ||
          !/text\/html|application\/xhtml\+xml/i.test(type) ||
          declared > options.maxBytes
        ) {
          response.destroy();
          resolve({ status });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            resolve({ status: 413 });
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * Fetches a recipe page for the server (spec §4). Refuses non-public
 * addresses after DNS and on every redirect; gives up on anything slow,
 * large, or not HTML.
 */
export async function fetchPage(input: string, options: FetchOptions): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return FAILED;
  }
  const signal = AbortSignal.timeout(options.timeoutMs);
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return BLOCKED;
    if (url.username || url.password) return FAILED;
    let address: string;
    try {
      address = await checkedAddress(url.hostname, options);
    } catch (error) {
      return error instanceof Blocked ? BLOCKED : FAILED;
    }
    let answer: Answer;
    try {
      answer = await requestOnce(url, address, options, signal);
    } catch {
      return FAILED;
    }
    if (answer.location !== undefined) {
      try {
        url = new URL(answer.location, url);
      } catch {
        return FAILED;
      }
      continue;
    }
    return answer.body === undefined
      ? FAILED
      : { ok: true, html: answer.body, url: url.toString() };
  }
  return FAILED;
}
