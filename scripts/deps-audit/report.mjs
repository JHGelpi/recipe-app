// Turns `pnpm audit --json` into the weekly audit issue's body (ADR-0024).
// Usage: node scripts/deps-audit/report.mjs audit.json > report.md
// Prints `blocking=true|false` to $GITHUB_OUTPUT when it is set.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORDER = ['critical', 'high', 'moderate', 'low', 'info'];
/** Severities that keep the audit issue open. */
export const BLOCKING = ['critical', 'high'];

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** @returns {{ blocking: boolean, markdown: string }} */
export function auditReport(audit) {
  // A failed audit (no network, registry error) must not read as "all clear",
  // which would close the issue.
  if (!audit || typeof audit.advisories !== 'object' || audit.advisories === null) {
    throw new Error(`Not an audit result: ${JSON.stringify(audit).slice(0, 200)}`);
  }
  const advisories = Object.values(audit.advisories).sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  );
  const blocking = advisories.some((advisory) => BLOCKING.includes(advisory.severity));
  if (advisories.length === 0) {
    return { blocking, markdown: 'No advisories in the production dependency tree.\n' };
  }
  const rows = advisories.map((advisory) => {
    const finding = advisory.findings?.[0];
    return [
      cell(advisory.severity),
      `\`${cell(advisory.module_name)}\``,
      cell([...new Set((advisory.findings ?? []).map((f) => f.version))].join(', ')),
      cell(advisory.patched_versions),
      `[${cell(advisory.title)}](${cell(advisory.url)})`,
      finding?.paths?.[0] ? `\`${cell(finding.paths[0])}\`` : '',
    ].join(' | ');
  });
  const markdown = [
    'Found by the weekly `pnpm audit --prod` (`.github/workflows/deps-audit.yml`).',
    'These are advisories a Dependabot bump did not fix, often a transitive package',
    'pinned by another one. Fix with a `pnpm.overrides` entry or by upgrading the parent,',
    'and check `pnpm why <package>` for every path.',
    '',
    '| Severity | Package | Installed | Fixed in | Advisory | A path |',
    '|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
  return { blocking, markdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { blocking, markdown } = auditReport(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  process.stdout.write(markdown);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `blocking=${blocking}\n`);
}
