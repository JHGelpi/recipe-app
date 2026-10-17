// Makes the photos the tests and the eval use (Task 5 of the photo plan).
// Run by hand when they need to change: `pnpm photos:samples`. The outputs
// are committed. Chromium renders a card and saves a JPEG screenshot; test
// fixtures get their text in a JPEG comment, which the fake Claude reads in
// the server tests. The phone re-encodes photos, dropping comments, so the
// fake also knows these fixtures by size (FIXTURE_PAGES in its server.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const FIXTURES = 'test-support/photos';
const SAMPLES = 'apps/api/eval/samples/photos';

function withComment(jpeg, text) {
  const body = Buffer.from(text, 'utf8');
  const segment = Buffer.concat([
    Buffer.from([0xff, 0xfe, (body.length + 2) >> 8, (body.length + 2) & 0xff]),
    body,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

const card = (lines, { font = 'Georgia, serif', tilt = 0, size = 30 } = {}) => `
  <body style="margin:0;background:#b9a68a;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="background:#fbf7ec;padding:48px 56px;width:78%;transform:rotate(${tilt}deg);
                box-shadow:0 12px 30px rgba(0,0,0,.35);font-family:${font};font-size:${size}px;line-height:1.45;color:#2b2118">
      ${lines.map((line, i) => (i === 0 ? `<h1 style="margin:0 0 16px">${line}</h1>` : `<div>${line}</div>`)).join('')}
    </div>
  </body>`;

async function shoot(page, html, width, height) {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  return page.screenshot({ type: 'jpeg', quality: 80 });
}

const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync(FIXTURES, { recursive: true });
mkdirSync(SAMPLES, { recursive: true });

const fixtures = [
  ['page-1.jpg', 1000, 750, 'Photo Fixture Bread\n- 500 g flour\n- 10 g salt'],
  ['page-2.jpg', 1000, 760, '1. Mix.\n2. Bake.'],
  ['big-page.jpg', 3000, 2250, 'Big Card Soup\n- 1 onion'],
];
for (const [name, width, height, text] of fixtures) {
  const jpeg = await shoot(page, card(text.split('\n')), width, height);
  writeFileSync(`${FIXTURES}/${name}`, withComment(jpeg, text));
}
writeFileSync(
  `${FIXTURES}/dish.jpg`,
  await shoot(
    page,
    '<body style="margin:0;background:radial-gradient(#e9b44c,#9b2915)"></body>',
    1200,
    900,
  ),
);

const samples = [
  [
    'printed-card-1.jpg',
    [
      'Buttermilk Pancakes',
      'Serves 4 · 20 minutes',
      '2 cups flour',
      '2 tbsp sugar',
      '2 tsp baking powder',
      '½ tsp salt',
      '2 cups buttermilk',
      '2 eggs',
      '3 tbsp melted butter',
      'Whisk the dry ingredients. Whisk the wet ones, then stir together until just combined.',
      'Cook ¼ cup at a time on a buttered griddle until bubbles form, then flip.',
    ],
  ],
  [
    'handwritten-card-1.jpg',
    [
      "Aunt Rosa's Meatballs",
      '1 lb ground beef',
      '½ lb ground pork',
      '1 cup breadcrumbs soaked in ½ cup milk',
      '2 eggs, ⅓ cup parmesan',
      '2 cloves garlic, minced',
      'Mix gently, roll into 1½" balls.',
      'Brown in olive oil, then simmer in sauce 30 min.',
    ],
    { font: '"Comic Sans MS", "Segoe Print", cursive', tilt: -2, size: 32 },
  ],
];
for (const [name, lines, style] of samples) {
  writeFileSync(`${SAMPLES}/${name}`, await shoot(page, card(lines, style), 1400, 1050));
}
const spread = [
  [
    'Lemon Chicken Traybake (page 1)',
    'Serves 4 · Prep 15 min · Cook 45 min',
    '8 chicken thighs, skin on',
    '1 kg small potatoes, halved',
    '2 lemons, sliced',
    '1 head garlic, cloves separated',
    '3 tbsp olive oil',
    '1 tbsp dried oregano',
  ],
  [
    '(continued)',
    'Heat the oven to 200°C.',
    'Toss everything in a large tray with salt and pepper.',
    'Roast 45 minutes, turning the potatoes halfway, until the chicken is golden.',
    'Rest 5 minutes and serve with the juices.',
  ],
];
for (const [index, lines] of spread.entries()) {
  writeFileSync(
    `${SAMPLES}/spread-${index + 1}.jpg`,
    await shoot(page, card(lines, { tilt: index ? 1.5 : -1 }), 1400, 1050),
  );
}
await browser.close();
console.log('photo fixtures and eval samples written');
