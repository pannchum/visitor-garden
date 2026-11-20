// seasons.js: the four seasons, their pastel colors, and a function that finds the season for a date.

const PALETTES = {
  spring: {
    sky: "#d8eefa", ground: "#bfe3a8", groundDark: "#a5d08c",
    stem: "#7fb87a", leaf: "#a3d99b", outline: "#8a6a8f", stamen: "#ffe27a",
    page: "#f3f9ee", text: "#4a6350",
    lilies: ["#ffffff", "#ffd6e8", "#ffe9f3", "#ead7fa"],
  },
  summer: {
    sky: "#cdeeff", ground: "#c8e8a0", groundDark: "#b0d688",
    stem: "#7cbf7a", leaf: "#a8dca0", outline: "#5f87a3", stamen: "#ffd95e",
    page: "#eefaff", text: "#35657a",
    lilies: ["#ffffff", "#fff1b8", "#ffd9c2", "#ffc9d3"],
  },
  autumn: {
    sky: "#fbe3c8", ground: "#e6c9a0", groundDark: "#d1ad82",
    stem: "#9aa56a", leaf: "#bfc98a", outline: "#9a6b57", stamen: "#ffd37a",
    page: "#fbefe0", text: "#6b4a38",
    lilies: ["#ffffff", "#ffd9b8", "#f9c7b0", "#fbe3a8"],
  },
  winter: {
    sky: "#e2ecf8", ground: "#eef3f9", groundDark: "#d3deea",
    stem: "#8fb3bd", leaf: "#b5d3d6", outline: "#7488a6", stamen: "#ffe49a",
    page: "#f1f5fb", text: "#4a5d78",
    lilies: ["#ffffff", "#d9e8fb", "#e8dcf8", "#dff3f1"],
  },
};

// Returns the season name and an id such as "2026-autumn".
// Winter runs December to February, so January and February belong to the
// winter that STARTED the previous December (Jan 2027 -> "2026-winter").
function getSeason(date) {
  const month = date.getMonth(); // 0 = January ... 11 = December
  let year = date.getFullYear();
  let name;

  if (month >= 2 && month <= 4) name = "spring";        // Mar, Apr, May
  else if (month >= 5 && month <= 7) name = "summer";   // Jun, Jul, Aug
  else if (month >= 8 && month <= 10) name = "autumn";  // Sep, Oct, Nov
  else {
    name = "winter";                                    // Dec, Jan, Feb
    if (month <= 1) year = year - 1;                    // Jan/Feb: winter began last year
  }
  return { name: name, id: year + "-" + name };
}
