# Import the dish photo with the recipe (#116)

## Why
An imported recipe should come with its picture. Today a household member must add the dish photo by hand, even when the website or screenshot they imported already shows it (issue #116, FR-7, FR-15).

## Goals / non-goals
- Goal: a URL import whose page names a recipe image, and a photo import whose screenshot contains a dish picture, saves with that picture as the dish photo.
- Non-goal: a preview of the picture on the review screen. Change/Remove on the recipe screen corrects a bad pick.
- Non-goal: text imports (they have no picture).
- Anti-goal: an import must never fail, or block saving, because of its picture.

## Approaches
- Screenshots: (A, chosen) the AI returns the page and a normalized box for the dish picture, and the app crops it automatically. (B) The person picks a page and crops it by hand: more accurate but adds a step and new UI. The user picked A.
- Websites: the server must fetch the image, because the browser can't read other sites' images (CORS) and the UI never calls the network directly. The server has no image decoder and adding one (sharp) would be a new dependency, so the server passes the bytes through unchanged and the app re-encodes them with `preparePhoto`.

## Design
- `importDraftSchema` gains an optional `image`: `{ url }` (http(s)) or `{ page, box: [x0, y0, x1, y1] }` (box values 0..1, x0 < x1, y0 < y1, page within the import). An invalid image is dropped, never failing the draft.
- URL imports: `draftFromJsonLd` reads the Recipe's `image` (a string, an ImageObject, or a list of either). When the page is parsed by the AI, the server adds the `og:image` link to the draft (or uses it as a fallback when JSON-LD has no image).
- Photo imports: the prompt `parse-recipe-photo.v3.md` and `RECORD_RECIPE_TOOL` (photo variant) ask for `dish_image: { page, box } | null`. The server validates it.
- `GET /api/imports/:id/image`: as the user, it reads the import's draft `image.url` and fetches it with the SSRF-guarded fetcher (accept `image/*`, 3 MB limit), then returns the bytes with their content type. It accepts no URL from the client.
- On save from review (writers only): the app gets the bytes (from the endpoint, or by cropping the local page file), runs them through `preparePhoto`, and saves them with `setDishPhoto`. If that fails, the recipe is still saved and a short status message says the picture could not be added.
- Tests: domain (schema, JSON-LD image), API (og:image, photo `dish_image`, image endpoint), mobile (crop maths), fake-AI fixture.

## Left to the builder
The exact status message and the max edge for dish photos (reuse the existing dish-photo constant).
