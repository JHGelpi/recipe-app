// pnpm test:infra: static checks of infra/ (infrastructure spec §7). Touches no cloud account.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const STEPS = [
  ['tofu', ['fmt', '-check', '-recursive'], 'infra/tofu'],
  ['tofu', ['init', '-backend=false', '-input=false'], 'infra/tofu'],
  ['tofu', ['validate'], 'infra/tofu'],
];

for (const [cmd, args, cwd] of STEPS) {
  console.log(`$ (cd ${cwd} && ${cmd} ${args.join(' ')})`);
  if (!existsSync(cwd)) {
    console.error(`${cwd} is missing`);
    process.exit(1);
  }
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    console.error(`${cmd} is not installed; see infra/README.md`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('infra: ok');
