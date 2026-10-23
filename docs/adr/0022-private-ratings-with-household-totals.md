# 0022. Private ratings, with household totals kept by a trigger

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

FR-44 (issue #45) lets everyone in a household, Viewers included, rate a recipe 1–5 stars, cooked or not. The recipe shows the household's average and count beside its title. The owner decided that people see only the average, never each other's ratings.

The app reads everything from the phone's database (rule 3), and sync streams mirror RLS (rule 6). A phone can only show an average it can compute from rows it has. Two simple designs don't meet the requirement:
- syncing every rating to the household would put each person's rating on everyone's phone;
- computing the average with a query on the server would need the network, and would never reach the phone through sync.

## Decision

1. **`recipe_ratings`:** one row per person and recipe, like `favorites`:
   - `stars` from 1 to 5; clearing sets `deleted_at`, and rating again revives the same row;
   - RLS lets you read and write only your own rows, for recipes of your household; any role may write;
   - the `user_ratings` stream sends each person only their own rows.
2. **`recipe_rating_totals`:** one row per rated recipe (`id` is the recipe's id) with `stars_total` and `ratings_count`:
   - the whole household reads it, and the `household_ratings` stream syncs it;
   - no client may write it: there is no write grant, and no write policy.
3. **A trigger keeps the totals:**
   - after any insert, update or delete on `recipe_ratings`, the trigger calls `recount_recipe_ratings(recipe_id)`;
   - the function locks the totals row, then recounts the recipe's live ratings from scratch. Two people rating at once can't lose a count, and a wrong total corrects itself on the next change;
   - both functions are `security definer`, because no caller may read the household's ratings or write totals. Neither takes input from a client beyond a recipe id, and `execute` is revoked from public;
   - `updated_by` on the totals stays null, so the row never names the last person who rated.
4. **The average is computed on the phone** by `ratingSummary` in `packages/domain`, from the synced totals.
5. **Ratings follow people the way favorites do:**
   - a person alone who joins another household brings their ratings with their recipes, and the totals move too;
   - anyone else who leaves, is removed or joins elsewhere has their ratings of the old household's recipes cleared. They stop counting there.

## Alternatives considered

- **Sync every rating to the household and average on the phone:** the simplest design, and the issue's first draft. It puts everyone's ratings on everyone's phone, which the owner ruled out.
- **Totals as columns on `recipes`:** no new table, but every rating would stamp the recipe's `updated_at` and `updated_by`. That would name the person who rated, and turn a Viewer's rating into a change to household data.
- **Update the totals by a difference (old stars minus new stars):** cheaper, but a missed or doubled change would stay wrong forever. Recounting one recipe's ratings costs little.
- **An API route that returns averages:** needs the network, so it breaks offline (rule 3).

## Consequences

- **The average lags your own change** until the rating uploads and the totals sync back. Offline, it shows what had synced; your own stars show at once.
- **A small household can work out a rating.** With two ratings, each person can subtract their own from the total. That is true of any average, and the owner accepted it.
- **A recipe purge removes its ratings and totals** by cascade. A deleted account's ratings go too, and the trigger recounts.
- **The new definer functions are not household functions under ADR-0015.** They only keep a derived table and never move data between households. Each change to them needs the same review as a household function.
