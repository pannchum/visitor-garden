// critters.js: butterflies by day, fireflies at night. The bigger the garden, the more of them.
// It uses px(), ctx, HEIGHT and clamp01() from main.js.

let critters = [];
const WING_COLORS = ["#ffd6e8", "#fff1b8", "#d9c9f2", "#ffc9a8"];

// One butterfly per 10 flowers (at least 1 once there is a flower, at most 6).
// Each butterfly also brings 2 fireflies for the night.
function setupCritters(flowerCount) {
  const butterflies = flowerCount < 1 ? 0 : Math.min(6, Math.max(1, Math.floor(flowerCount / 10)));
  critters = [];
  for (let i = 0; i < butterflies; i++) {
    critters.push({ kind: "butterfly", wing: WING_COLORS[i % WING_COLORS.length] });
  }
  for (let i = 0; i < butterflies * 2; i++) {
    critters.push({ kind: "firefly" });
  }
}

function drawButterfly(x, y, wing, flapOpen) {
  if (flapOpen) {
    px(x - 3, y - 2, 3, 3, wing);
    px(x + 1, y - 2, 3, 3, wing);
  } else {
    px(x - 2, y - 2, 2, 3, wing);
    px(x + 1, y - 2, 2, 3, wing);
  }
  px(x, y - 1, 1, 3, "#6b4a3a"); // the body
}

function drawCritters(time, tod) {
  // 0 in daylight, 1 at night: butterflies fade out as fireflies fade in.
  const night = clamp01((tod.alpha - 0.12) / 0.08);
  const centerY = HEIGHT * 0.45;
  const rangeY = HEIGHT * 0.32;

  critters.forEach((c, i) => {
    const s = i + 1; // each critter gets its own path, worked out from its number
    const x = Math.round(80 + 62 * Math.sin(time * (0.00035 + (s % 4) * 0.00008) + s * 1.9));
    const bob = 2 * Math.sin(time * 0.008 + s);
    const y = Math.round(centerY + rangeY * Math.sin(time * (0.0005 + (s % 3) * 0.0001) + s * 2.7) + bob);

    if (c.kind === "butterfly" && night < 1) {
      ctx.globalAlpha = 1 - night;
      drawButterfly(x, y, c.wing, Math.floor(time / 150 + s) % 2 === 0); // flaps ~3 times a second
    } else if (c.kind === "firefly" && night > 0) {
      const glow = Math.max(0, Math.sin(time * 0.003 + s * 1.3)); // slow blinking
      const a = night * (0.25 + 0.75 * glow);
      ctx.globalAlpha = a * 0.3;
      px(x - 1, y - 1, 3, 3, "#fff6a0"); // soft halo
      ctx.globalAlpha = a;
      px(x, y, 1, 1, "#fffbd0");         // the light itself
    }
  });
  ctx.globalAlpha = 1;
}