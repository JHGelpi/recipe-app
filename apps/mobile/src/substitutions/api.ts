import {
  toSubstitutionAnswer,
  type SubstitutionAnswer,
  type SubstitutionAsk,
} from '@recipe-app/domain';
import type { ApiDeps } from '../imports/api';

export type AskResult =
  | { kind: 'answer'; answer: SubstitutionAnswer; ingredient_raw: string }
  | { kind: 'error'; message: string };

const MESSAGES: Record<string, string> = {
  quota: "Over this month's AI limit",
  ai_unavailable: "Couldn't reach the AI service. Try again.",
  invalid_output: "Couldn't read the suggestions. Try again.",
  not_found: 'This recipe is no longer on the server.',
};
const FALLBACK = "Couldn't get substitutes. Try again.";

/** FR-24: asks the server for substitutes. Never throws. */
export async function askSubstitutes(ask: SubstitutionAsk, deps: ApiDeps): Promise<AskResult> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/substitutions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
      body: JSON.stringify(ask),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      ingredient_raw?: unknown;
      options?: unknown;
      note?: unknown;
    } | null;
    if (!response.ok) return { kind: 'error', message: MESSAGES[body?.error ?? ''] ?? FALLBACK };
    const answer = toSubstitutionAnswer({ options: body?.options, note: body?.note ?? null });
    if (!answer || typeof body?.ingredient_raw !== 'string') {
      return { kind: 'error', message: MESSAGES.invalid_output! };
    }
    return { kind: 'answer', answer, ingredient_raw: body.ingredient_raw };
  } catch {
    return { kind: 'error', message: FALLBACK };
  }
}
