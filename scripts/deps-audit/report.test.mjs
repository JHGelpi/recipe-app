import { describe, expect, it } from 'vitest';
import { auditReport } from './report.mjs';

const advisory = (severity, name, extra = {}) => ({
  module_name: name,
  severity,
  title: `${name} problem`,
  url: `https://github.com/advisories/${name}`,
  vulnerable_versions: '<2.0.0',
  patched_versions: '>=2.0.0',
  findings: [{ version: '1.0.0', paths: [`apps__mobile>${name}`] }],
  ...extra,
});

describe('the weekly audit report', () => {
  it('blocks on high or critical, listed first', () => {
    const { blocking, markdown } = auditReport({
      advisories: { 1: advisory('moderate', 'uuid'), 2: advisory('high', 'zod') },
    });
    expect(blocking).toBe(true);
    const rows = markdown.split('\n').filter((line) => /^\| (high|moderate) /.test(line));
    expect(rows.map((row) => row.split(' | ')[0])).toEqual(['| high', '| moderate']);
    expect(markdown).toContain('`apps__mobile>zod`');
  });

  it('does not block on moderate or low findings alone', () => {
    const { blocking } = auditReport({
      advisories: { 1: advisory('moderate', 'uuid'), 2: advisory('low', 'ms') },
    });
    expect(blocking).toBe(false);
  });

  it('reports a clean tree', () => {
    expect(auditReport({ advisories: {} })).toEqual({
      blocking: false,
      markdown: 'No advisories in the production dependency tree.\n',
    });
  });

  it('keeps a pipe in a title from breaking the table', () => {
    const { markdown } = auditReport({
      advisories: { 1: advisory('high', 'zod', { title: 'a | b' }) },
    });
    expect(markdown).toContain('[a \\| b]');
  });

  it('refuses an error in place of a result, so the issue is not closed', () => {
    expect(() => auditReport({ error: { code: 'ENOTFOUND' } })).toThrow(/Not an audit result/);
  });
});
