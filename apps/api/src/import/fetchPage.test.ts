import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPage, type FetchOptions } from './fetchPage';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h1>Soup</h1>');
      return;
    }
    if (path === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      return;
    }
    if (path === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('x'.repeat(5_000));
      return;
    }
    if (path === '/hop') {
      res.writeHead(302, { Location: '/page' }).end();
      return;
    }
    if (path === '/loop') {
      res.writeHead(302, { Location: '/loop' }).end();
      return;
    }
    if (path === '/to-loopback') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/page` }).end();
      return;
    }
    if (path === '/missing') {
      res.writeHead(404).end();
      return;
    }
    if (path === '/hang') return; // never answers
    res.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const options = (extra: Partial<FetchOptions> = {}): FetchOptions => ({
  allowHosts: ['localhost'],
  timeoutMs: 500,
  maxBytes: 1_000,
  maxRedirects: 2,
  resolve: async () => ['127.0.0.1'],
  ...extra,
});
const local = (path: string) => `http://localhost:${port}${path}`;

describe('fetchPage', () => {
  it('returns the HTML of an allow-listed host', async () => {
    expect(await fetchPage(local('/page'), options())).toEqual({
      ok: true,
      html: '<h1>Soup</h1>',
      url: local('/page'),
    });
  });

  it('follows a redirect on the same host', async () => {
    expect(await fetchPage(local('/hop'), options())).toMatchObject({
      ok: true,
      url: local('/page'),
    });
  });

  it.each([['/json'], ['/big'], ['/missing'], ['/loop'], ['/hang']])(
    'fails %s as fetch_failed',
    async (path) => {
      expect(await fetchPage(local(path), options())).toEqual({ ok: false, error: 'fetch_failed' });
    },
  );

  it('blocks a redirect to a loopback address that is not allow-listed', async () => {
    expect(await fetchPage(local('/to-loopback'), options())).toEqual({
      ok: false,
      error: 'blocked_address',
    });
  });

  it('blocks a host that resolves to a private address, even alongside a public one', async () => {
    const resolve = async () => ['93.184.216.34', '10.0.0.1'];
    expect(await fetchPage('http://evil.example/', options({ allowHosts: [], resolve }))).toEqual({
      ok: false,
      error: 'blocked_address',
    });
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://0x7f000001/',
  ])('blocks the literal address %s', async (url) => {
    expect(await fetchPage(url, options({ allowHosts: [] }))).toEqual({
      ok: false,
      error: 'blocked_address',
    });
  });

  it('refuses schemes other than http(s) and links with credentials', async () => {
    expect((await fetchPage('file:///etc/passwd', options())).ok).toBe(false);
    expect((await fetchPage(`http://user:pw@localhost:${port}/page`, options())).ok).toBe(false);
  });

  it('connects to the checked address, not a fresh DNS answer', async () => {
    // pinned.test has no DNS record; the page loads only through the checked address.
    const result = await fetchPage(
      `http://pinned.test:${port}/page`,
      options({ allowHosts: ['pinned.test'] }),
    );
    expect(result).toMatchObject({ ok: true });
  });
});
