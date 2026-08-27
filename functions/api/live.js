const ROBLOX = "https://games.roblox.com/v1/games?universeIds=";
const MAX_IDS = 400;
const TTL = 10;

const HEADERS = {
  "content-type": "application/json",
  "cache-control": `public, max-age=${TTL}`
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export async function onRequestGet(context) {
  const raw = new URL(context.request.url).searchParams.get("ids") || "";
  const ids = [...new Set(raw.split(",").filter(x => /^\d{1,20}$/.test(x)))].sort();

  if (!ids.length) return json({ error: "no ids" }, 400);
  if (ids.length > MAX_IDS) return json({ error: "too many ids" }, 400);

  const cache = caches.default;
  const key = new Request(`https://live.gameshipped/?ids=${ids.join(",")}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  const pages = await Promise.all(chunks.map(chunk =>
    fetch(ROBLOX + chunk.join(","), { headers: { "user-agent": "gameshipped" } })
  ));

  const games = {};
  for (const page of pages) {
    if (!page.ok) return json({ error: `roblox returned ${page.status}` }, 502);
    const body = await page.json();
    for (const g of body.data) {
      games[g.id] = { playing: g.playing, visits: g.visits, favorites: g.favoritedCount };
    }
  }

  const res = json({ generated: new Date().toISOString(), games });
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
