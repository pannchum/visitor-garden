// main.js: loads the season's flowers from the database, plants today's flower,
// draws everything on the canvas, and animates the sway and the sky.

// ---------- 1. Setup ----------
// The canvas is a tiny grid of "pixels"; CSS scales it up. Its height grows with the garden.
const WIDTH = 160, HORIZON = 20;
const COLS = 5, MIN_ROWS = 4, FIRST_ROW_Y = 46, ROW_GAP = 24;
const MAX_FLOWERS = 200; // the garden shows the newest 200 flowers of the season
let HEIGHT = 122;        // recalculated once we know how many rows we need
let rowCount = MIN_ROWS;
let flowers = [];

// Growth: how old a flower must be (in hours) to reach each stage.
// Change these numbers to make flowers grow faster or slower.
const HOUR = 60 * 60 * 1000;
const BUD_AFTER_HOURS = 2;
const BLOOM_AFTER_HOURS = 5;
const STEM_HEIGHT = { sprout: 5, bud: 10, bloom: 14 }; // taller as they grow

// The 5 symbols a flower can carry. The database stores the short key on the left.
const SYMBOLS = {
  smile: "(˶˃ ᵕ ˂˶)",
  heart: "♡",
  kitty: "𐔌՞ ܸ.ˬ.ܸ՞𐦯",
  cheer: "ꉂ(˵˃ ᗜ ˂˵)",
  sparkle: "( ◡̀  ̫ ◡́) ✧",
};
const SYMBOL_KEYS = Object.keys(SYMBOLS);

const canvas = document.getElementById("garden");
canvas.width = WIDTH;
canvas.height = HEIGHT;
const ctx = canvas.getContext("2d");

// Pick the season from today's date. Test pages (they never plant flowers):
//   ?date=2027-01-15  shows another date's season
//   ?stages           shows sprouts, buds and blooms together
//   ?hour=22          shows the sky at 10pm (try 2, 6, 12, 17.5, 18.5, 22)
//   ?flowers=40       pretends the garden has 40 flowers (changes the butterflies)
const params = new URLSearchParams(window.location.search);
const demoStages = params.has("stages");
const skipPlanting = params.has("date") || params.has("hour") || params.has("flowers") || demoStages;
let today = new Date(params.get("date") || Date.now());
if (isNaN(today)) today = new Date();
const season = getSeason(today);
const palette = PALETTES[season.name];

// Apply the season's colors to the page.
const rootStyle = document.documentElement.style;
rootStyle.setProperty("--page", palette.page);
rootStyle.setProperty("--text", palette.text);
rootStyle.setProperty("--frame", palette.groundDark);
const niceName = season.name[0].toUpperCase() + season.name.slice(1);
const label = document.getElementById("season-label");
label.textContent = niceName + " garden (" + season.id + ")";

// Connect to the database. If the library didn't load, db stays null.
let db = null;
try {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (err) {
  console.error("Could not create the database client:", err);
}

// ---------- 2. Talking to the database ----------
// A key like "2026-11-20" that changes once per day, used for the one-flower-a-day rule.
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

// Plant one flower, unless this browser already planted one today.
async function plantTodaysFlower() {
  try {
    if (localStorage.getItem("lastPlanted") === todayKey()) return;
  } catch (err) { /* storage unavailable: carry on */ }

  const color = palette.lilies[Math.floor(Math.random() * palette.lilies.length)];
  const symbol = SYMBOL_KEYS[Math.floor(Math.random() * SYMBOL_KEYS.length)];
  const { error } = await db.from("flowers").insert({ season: season.id, color: color, symbol: symbol });
  if (error) throw error;

  try {
    localStorage.setItem("lastPlanted", todayKey());
  } catch (err) { /* ignore */ }
}

// Load this season's flowers (the newest ones) plus the total count.
async function loadGarden() {
  const { data, error, count } = await db
    .from("flowers")
    .select("id, color, planted_at, symbol", { count: "exact" })
    .eq("season", season.id)
    .order("id", { ascending: false })
    .limit(MAX_FLOWERS);
  if (error) throw error;
  return { rows: data.reverse(), total: count };
}

// Work out each flower's spot from its order: row by row, left to right.
// Two flowers can never share a spot, and nothing about position is stored.
function layOutFlowers(rows) {
  return rows.map((row, i) => ({
    id: row.id,
    color: row.color,
    plantedAt: new Date(row.planted_at).getTime(),
    symbol: row.symbol,
    x: 16 + (i % COLS) * 32,
    y: FIRST_ROW_Y + Math.floor(i / COLS) * ROW_GAP,
  }));
}

// How grown-up is this flower? Based on its age.
function stageOf(flower) {
  const age = Date.now() - flower.plantedAt;
  if (age < BUD_AFTER_HOURS * HOUR) return "sprout";
  if (age < BLOOM_AFTER_HOURS * HOUR) return "bud";
  return "bloom";
}

// ---------- 3. Time of day ----------
// Small color helpers: colors are handled as [red, green, blue] lists so we can blend them.
const toRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (rgb) => "rgb(" + rgb.map(Math.round).join(",") + ")";
const clamp01 = (n) => Math.max(0, Math.min(1, n));

// The hour of the day (0 to 24) from the visitor's clock, or from ?hour= when testing.
function currentHour() {
  const forced = Number(params.get("hour"));
  if (params.has("hour") && !isNaN(forced)) return ((forced % 24) + 24) % 24;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

// Describes the sky at a given hour by blending between "keyframes".
// sky = sky color; tint = a color laid over the whole scene; a = how strong that tint is.
// Night is soft: a gentle navy tint (a = 0.22) so the pastel flowers stay easy to see.
// The times fit a place where the sun sets around 6pm and darkness comes quickly.
function timeOfDay(hour) {
  const night = { sky: toRgb("#4a5a8c"), tint: toRgb("#2d3a6e"), a: 0.22 };
  const day = { sky: toRgb("#c8e8f8"), tint: [255, 255, 255], a: 0 }; // light blue
  const frames = [
    { h: 0, ...night },
    { h: 5, ...night },
    { h: 5.75, sky: toRgb("#f9c9b6"), tint: toRgb("#ffb48a"), a: 0.08 }, // sunrise
    { h: 6.75, ...day },
    { h: 16.75, ...day },
    { h: 17.5, sky: toRgb("#ffb98f"), tint: toRgb("#ff9f6b"), a: 0.08 }, // sunset
    { h: 18.25, sky: toRgb("#a98bbd"), tint: toRgb("#6f5a9e"), a: 0.15 }, // dusk
    { h: 19, ...night },
    { h: 24, ...night },
  ];
  let i = 0;
  while (i < frames.length - 2 && hour >= frames[i + 1].h) i++;
  const from = frames[i], to = frames[i + 1];
  const t = clamp01((hour - from.h) / (to.h - from.h));
  return {
    hour: hour,
    sky: lerp(from.sky, to.sky, t),
    tint: lerp(from.tint, to.tint, t),
    alpha: from.a + (to.a - from.a) * t,
  };
}

const STARS = [[12, 5], [30, 10], [48, 4], [66, 12], [84, 6], [102, 11], [120, 4], [140, 9], [152, 14]];

// ---------- 4. Drawing ----------
// Draw one filled rectangle (a "pixel"). Everything else is built from this.
function px(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Sprites are drawn from text maps: # = petal or leaf, y = stamen, . = empty.
// An outline is added automatically around every shape.
const LILY_SHAPE = [
  "...###.....###...",
  "...####...####...",
  "...#####.#####...",
  "...##yy#.#yy##...",
  "..####yy#yy####..",
  ".#######y#######.",
  "####yyyyyyyyy####",
  ".#######y#######.",
  "..####yy#yy####..",
  "...##yy#.#yy##...",
  "...#####.#####...",
  "...####...####...",
  "...###.....###...",
];

const LEAF_SHAPE = [
  "##.........##",
  ".###.....###.",
  "..###...###..",
  "...###.###...",
  "....#####....",
];

// Two tiny leaves on top of a sprout.
const SPROUT_SHAPE = [
  "##...##",
  ".##.##.",
  "..###..",
];

// A closed bud, colored like the flower it will become.
const BUD_SHAPE = [
  "..#..",
  ".###.",
  ".###.",
  "#####",
  "#####",
  ".###.",
];

// colors maps each character in the shape to a color, e.g. { "#": "pink" }.
function drawSprite(shape, left, top, colors) {
  const rows = shape.length, cols = shape[0].length;
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? "." : shape[r][c]);
  for (let r = -1; r <= rows; r++) {
    for (let c = -1; c <= cols; c++) {
      const cell = at(r, c);
      if (cell !== ".") {
        px(left + c, top + r, 1, 1, colors[cell]);
      } else if (at(r - 1, c) !== "." || at(r + 1, c) !== "." || at(r, c - 1) !== "." || at(r, c + 1) !== ".") {
        px(left + c, top + r, 1, 1, palette.outline); // empty cell touching the shape = outline
      }
    }
  }
}

function drawLily(flower, time) {
  const stage = stageOf(flower);
  const height = STEM_HEIGHT[stage];

  // Each flower sways at its own speed and offset, both worked out from its id,
  // so the same flower always sways the same way.
  const speed = 0.0012 + (flower.id % 5) * 0.0003;
  const sway = Math.sin(time * speed + flower.id * 1.3); // between -1 and 1

  // The stem leans more the higher up it goes.
  const stemX = (i) => flower.x + Math.round((sway * 2 * Math.min(i, height)) / height);
  for (let i = 0; i <= height; i++) px(stemX(i) - 1, flower.y - i, 2, 1, palette.stem);

  if (stage === "sprout") {
    drawSprite(SPROUT_SHAPE, stemX(height) - 3, flower.y - height - 2, { "#": palette.leaf });
    return;
  }

  drawSprite(LEAF_SHAPE, stemX(2) - 6, flower.y - 6, { "#": palette.leaf });
  if (stage === "bud") {
    drawSprite(BUD_SHAPE, stemX(height) - 2, flower.y - height - 5, { "#": flower.color });
  } else {
    drawSprite(LILY_SHAPE, stemX(height) - 8, flower.y - height - 6, { "#": flower.color, y: palette.stamen });
  }
}

// The sky: its color, twinkling stars and a moon at night, a sun that crosses the sky by day.
function drawSky(time, tod) {
  px(0, 0, WIDTH, HORIZON, css(tod.sky));

  const night = clamp01((tod.alpha - 0.12) / 0.08); // 0 in daylight, 1 at night
  if (night > 0) {
    STARS.forEach(([x, y], i) => {
      ctx.globalAlpha = night * (0.6 + 0.4 * Math.sin(time * 0.002 + i * 2));
      px(x, y, 1, 1, "#fff6d6");
    });
    ctx.globalAlpha = night;
    px(128, 6, 3, 5, "#fff6e0");  // the moon
    px(127, 7, 5, 3, "#fff6e0");
    px(128, 8, 1, 1, "#e8dfc4");  // a little shadow on it
    ctx.globalAlpha = 1;
  }

  // The sun rises at 5:45am and sets at 5:45pm.
  if (tod.hour > 5.75 && tod.hour < 17.75) {
    const progress = (tod.hour - 5.75) / 12;                    // 0 at sunrise, 1 at sunset
    const sunX = 12 + progress * (WIDTH - 24);
    const sunY = 15 - Math.sin(progress * Math.PI) * 9;         // rises, then sets
    px(sunX - 1, sunY - 2, 3, 5, "#fff1b8");
    px(sunX - 2, sunY - 1, 5, 3, "#fff1b8");
  }
}

function drawBackground(time, tod) {
  drawSky(time, tod);
  px(0, HORIZON, WIDTH, HEIGHT - HORIZON, palette.ground);
  // A thin line of soil under each row of flowers.
  for (let row = 0; row < rowCount; row++) px(0, FIRST_ROW_Y + row * ROW_GAP + 1, WIDTH, 1, palette.groundDark);
}

// ---------- 5. Start and animate ----------
function draw(time) {
  const tod = timeOfDay(currentHour());
  drawBackground(time, tod);
  for (const flower of flowers) drawLily(flower, time);
  drawCritters(time, tod); // butterflies by day, fireflies at night (from critters.js)

  // Lay the time-of-day tint over everything (soft navy at night, warm peach at dusk).
  ctx.globalAlpha = tod.alpha;
  ctx.fillStyle = css(tod.tint);
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.globalAlpha = 1;
}

function loop(time) {
  draw(time);
  requestAnimationFrame(loop);
}

// ---------- 6. Hover or tap a flower to see its symbol ----------
const bubble = document.getElementById("bubble");
let hideTimer;

// The top edge of a flower in canvas pixels, depending on how grown it is.
function flowerTop(f) {
  const stage = stageOf(f);
  return f.y - (stage === "bloom" ? 21 : stage === "bud" ? 15 : 7);
}

function hideBubble() {
  bubble.style.display = "none";
  canvas.style.cursor = "default";
}

function showBubble(e) {
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / WIDTH;              // screen pixels per canvas pixel
  const mx = (e.clientX - rect.left) / scale;    // pointer position in canvas pixels
  const my = (e.clientY - rect.top) / scale;

  // Find the flower under the pointer (the last match is the one drawn on top).
  let hit = null;
  for (const f of flowers) {
    if (SYMBOLS[f.symbol] && Math.abs(mx - f.x) <= 9 && my >= flowerTop(f) && my <= f.y + 1) hit = f;
  }

  clearTimeout(hideTimer);
  if (!hit) {
    hideBubble();
    return;
  }

  bubble.textContent = SYMBOLS[hit.symbol];
  bubble.style.left = rect.left + window.scrollX + hit.x * scale + "px";
  bubble.style.top = rect.top + window.scrollY + flowerTop(hit) * scale - 8 + "px";
  bubble.style.display = "block";
  canvas.style.cursor = "pointer";

  // A finger never "leaves" like a mouse does, so touch bubbles fade out on their own.
  if (e.pointerType === "touch") hideTimer = setTimeout(hideBubble, 2500);
}

canvas.addEventListener("pointermove", showBubble);
canvas.addEventListener("pointerdown", showBubble);
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType !== "touch") hideBubble();
});
window.addEventListener("scroll", hideBubble);

async function start() {
  let rows = [];
  let total = 0;
  let resting = !demoStages && db === null;

  if (demoStages) {
    // Fake flowers of different ages, so you can see every stage without waiting.
    const ages = [0, 3, 6]; // hours old: a sprout, a bud, a bloom
    rows = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      color: palette.lilies[i % palette.lilies.length],
      planted_at: new Date(Date.now() - ages[i % 3] * HOUR).toISOString(),
      symbol: SYMBOL_KEYS[i % SYMBOL_KEYS.length],
    }));
    total = rows.length;
  } else if (db) {
    // Planting and loading are separate, so a failed plant doesn't hide the garden.
    if (!skipPlanting) {
      try {
        await plantTodaysFlower();
      } catch (err) {
        console.error("Could not plant a flower:", err);
      }
    }
    try {
      const garden = await loadGarden();
      rows = garden.rows;
      total = garden.total;
    } catch (err) {
      console.error("Could not load the garden:", err);
      resting = true;
    }
  }

  // Make the canvas tall enough for every row.
  rowCount = Math.max(MIN_ROWS, Math.ceil(rows.length / COLS));
  HEIGHT = FIRST_ROW_Y + (rowCount - 1) * ROW_GAP + 4;
  canvas.height = HEIGHT;
  flowers = layOutFlowers(rows);
  setupCritters(Number(params.get("flowers")) || total); // ?flowers=40 pretends the garden has 40 flowers

  label.textContent = resting
    ? "The garden is resting (couldn't reach the database)"
    : niceName + " garden (" + season.id + "): " + total + (total === 1 ? " flower" : " flowers");

  // If the visitor prefers reduced motion, draw one still frame instead of animating.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    draw(0);
  } else {
    requestAnimationFrame(loop);
  }
}

start();
