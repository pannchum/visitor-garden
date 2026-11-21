// main.js: loads the season's flowers from the database, plants today's flower,
// draws everything on the canvas, and animates the sway.

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

const canvas = document.getElementById("garden");
canvas.width = WIDTH;
canvas.height = HEIGHT;
const ctx = canvas.getContext("2d");

// Pick the season from today's date. Test pages (they never touch the database):
//   ?date=2027-01-15  shows another date's season
//   ?stages           shows sprouts, buds and blooms together
const params = new URLSearchParams(window.location.search);
const demoStages = params.has("stages");
const skipPlanting = params.has("date") || demoStages;
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
  const { error } = await db.from("flowers").insert({ season: season.id, color: color });
  if (error) throw error;

  try {
    localStorage.setItem("lastPlanted", todayKey());
  } catch (err) { /* ignore */ }
}

// Load this season's flowers (the newest ones) plus the total count.
async function loadGarden() {
  const { data, error, count } = await db
    .from("flowers")
    .select("id, color, planted_at", { count: "exact" })
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

// ---------- 3. Drawing ----------
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

function drawBackground() {
  px(0, 0, WIDTH, HORIZON, palette.sky);
  px(0, HORIZON, WIDTH, HEIGHT - HORIZON, palette.ground);
  // A thin line of soil under each row of flowers.
  for (let row = 0; row < rowCount; row++) px(0, FIRST_ROW_Y + row * ROW_GAP + 1, WIDTH, 1, palette.groundDark);
}

// ---------- 4. Start and animate ----------
function draw(time) {
  drawBackground();
  for (const flower of flowers) drawLily(flower, time);
}

function loop(time) {
  draw(time);
  requestAnimationFrame(loop);
}

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
