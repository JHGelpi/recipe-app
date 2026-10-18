// Runs before every dev, seed, reset and test command (production spec §2).
import { existsSync, readFileSync } from 'node:fs';
import { productionSignals } from './prod/lib.mjs';

const reasons = productionSignals({
  env: process.env,
  argv: process.argv.slice(2),
  dotenv: existsSync('.env') ? readFileSync('.env', 'utf8') : '',
});
if (reasons.length > 0) {
  console.error(
    `Refusing: this would touch production (project dishkept).\n- ${reasons.join('\n- ')}`,
  );
  process.exit(1);
}
