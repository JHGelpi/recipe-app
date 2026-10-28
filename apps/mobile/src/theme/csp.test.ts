import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The proxy's Content-Security-Policy allows index.html's inline script only by
// its hash (issue #64). Editing the script without updating deploy/Caddyfile
// would stop it running, so the page would paint the wrong theme first.
const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const caddyfile = readFileSync(new URL('../../../../deploy/Caddyfile', import.meta.url), 'utf8');

describe('the Content-Security-Policy (#64)', () => {
  it("allows index.html's inline scripts by their hashes, and no others", () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => `'sha256-${createHash('sha256').update(match[1]!).digest('base64')}'`,
    );
    expect(inline.length).toBeGreaterThan(0);
    const policy = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1] ?? '';
    const allowed = policy.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? [];
    // On a mismatch, put the hashes printed here in deploy/Caddyfile.
    expect(allowed.sort()).toEqual(inline.sort());
    expect(/script-src[^;]*'unsafe-(inline|eval)'/.test(policy)).toBe(false);
  });

  it('forbids framing, plugins and other origins', () => {
    const policy = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1] ?? '';
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("default-src 'self'");
  });
});
