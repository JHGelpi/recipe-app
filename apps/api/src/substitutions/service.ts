import {
  toSubstitutionAnswer,
  type Ingredient,
  type SubstitutionAnswer,
  type SubstitutionAsk,
} from '@recipe-app/domain';
import type { TokenClaims, VerifyToken } from '../auth/verify';
import type { AsClaims } from '../db/asUser';
import { AiUnavailableError, costMicroUsd, type AiConfig, type Gateway } from '../llm/gateway';
import { buildSubstituteRequest, RECORD_SUBSTITUTES_TOOL } from '../llm/suggestSubstitutes';
import { AI_RESERVE_MICROUSD, reserveSpend, settleSpend } from '../llm/usage';

export type SubstitutionOutcome =
  | { kind: 'answer'; answer: SubstitutionAnswer; ingredient_raw: string }
  | { kind: 'forbidden' | 'missing' | 'quota' | 'ai_unavailable' | 'invalid_output' };
export type SubstitutionService = {
  ask(token: string, ask: SubstitutionAsk): Promise<SubstitutionOutcome>;
};

type RecipeRow = {
  title: string;
  servings: number | null;
  ingredients: Ingredient[] | null;
  steps: { text: string }[] | null;
};
const WRITERS = ['admin', 'member'];

/**
 * FR-24: asks Claude about one ingredient and remembers the answer for the
 * household. Every statement runs as the user (rule 1); the token is checked
 * once, so a slow answer still lands after the phone has gone.
 */
export function createSubstitutionService(deps: {
  verify: VerifyToken;
  asClaims: AsClaims;
  gateway: Gateway;
  ai: Pick<AiConfig, 'capUsd' | 'priceInputPerMTokUsd' | 'priceOutputPerMTokUsd'>;
  log?: (event: Record<string, unknown>) => void;
}): SubstitutionService {
  return {
    async ask(token, ask) {
      const claims: TokenClaims = await deps.verify(token);
      if (!WRITERS.includes(String(claims.household_role))) return { kind: 'forbidden' };

      const cap = Math.round(deps.ai.capUsd * 1_000_000);
      const found = await deps.asClaims(claims, async (tx) => {
        const [recipe] = await tx<RecipeRow[]>`
          select title, servings, ingredients, steps from public.recipes
          where id = ${ask.recipe_id} and deleted_at is null`;
        const line = (recipe?.ingredients ?? []).find(
          (item) => item.id === ask.ingredient_id && !item.heading,
        );
        // Reserved only for a line that exists, under the household's lock (spec §3).
        const reserved = recipe && line ? await reserveSpend(tx, cap, AI_RESERVE_MICROUSD) : false;
        return { recipe, line, reserved };
      });
      const { line } = found;
      if (!found.recipe || !line) return { kind: 'missing' };
      if (!found.reserved) return { kind: 'quota' };
      const ingredients = found.recipe.ingredients ?? [];

      let call;
      try {
        call = await deps.gateway.callTool(
          buildSubstituteRequest(
            { ...found.recipe, ingredients, steps: found.recipe.steps ?? [] },
            ask.ingredient_id,
          ),
          RECORD_SUBSTITUTES_TOOL,
        );
      } catch (error) {
        if (!(error instanceof AiUnavailableError)) throw error;
        deps.log?.({ event: 'ai_unavailable', recipe: ask.recipe_id, message: error.message });
        // Nothing was spent: the reservation goes back.
        await deps.asClaims(claims, (tx) => settleSpend(tx, -AI_RESERVE_MICROUSD));
        return { kind: 'ai_unavailable' };
      }
      const answer = toSubstitutionAnswer(call.input);
      // Spend first, in its own transaction: an upsert that fails (a demotion
      // or a purge mid-ask) never loses what the call cost.
      await deps.asClaims(claims, (tx) =>
        settleSpend(tx, costMicroUsd(call.usage, deps.ai) - AI_RESERVE_MICROUSD),
      );
      if (answer)
        await deps.asClaims(claims, async (tx) => {
          // Asking again replaces the remembered answer for this line.
          await tx`
          insert into public.substitutions
            (id, household_id, recipe_id, ingredient_id, ingredient_raw, options, note)
          values (${ask.id}, (select public.auth_household_id()), ${ask.recipe_id},
                  ${ask.ingredient_id}, ${line.raw}, ${tx.json(answer.options as never)}, ${answer.note})
          on conflict (recipe_id, ingredient_id) where deleted_at is null
          do update set ingredient_raw = excluded.ingredient_raw,
                        options = excluded.options, note = excluded.note`;
        });
      return answer
        ? { kind: 'answer', answer, ingredient_raw: line.raw }
        : { kind: 'invalid_output' };
    },
  };
}
