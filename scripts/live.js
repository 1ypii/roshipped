const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "user-agent": "roshipped" } });
    if (res.ok) return res.json();
    if (i === tries - 1) throw new Error(`${res.status} on ${url}`);
    await sleep(res.status === 429 ? 4000 * (i + 1) : 1200 * (i + 1));
  }
}

async function main() {
  const file = path.join(DATA, "games.json");
  if (!fs.existsSync(file)) throw new Error("no games.json to refresh yet");

  const ids = JSON.parse(fs.readFileSync(file, "utf8")).games.map(g => g.id);
  const out = {};

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await get(`https://games.roblox.com/v1/games?universeIds=${chunk.join(",")}`);
    for (const g of res.data) {
      out[g.id] = { playing: g.playing, visits: g.visits, favorites: g.favoritedCount };
    }
    await sleep(400);
  }

  fs.writeFileSync(path.join(DATA, "live.json"), JSON.stringify({ generated: new Date().toISOString(), games: out }));

  const playing = Object.values(out).reduce((sum, g) => sum + g.playing, 0);
  console.log(`refreshed ${Object.keys(out).length} games, ${playing.toLocaleString()} playing right now`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
