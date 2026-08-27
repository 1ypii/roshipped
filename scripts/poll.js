const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const SORTS_URL = "https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=roshipped&device=computer&country=all";
const MAX_EVENTS = 1000;
const ROSTER_DAYS = 30;
const CREATOR_DAYS = 7;
const CREATOR_BUDGET = 70;
const STAFF_LIMIT = 25;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "user-agent": "roshipped" } });
    if (res.ok) return res.json();
    if (i === tries - 1) throw new Error(`${res.status} on ${url}`);
    await sleep(res.status === 429 ? 4000 * (i + 1) : 1200 * (i + 1));
  }
}

async function post(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "roshipped" },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    if (i === tries - 1) throw new Error(`${res.status} on ${url}`);
    await sleep(res.status === 429 ? 4000 * (i + 1) : 1200 * (i + 1));
  }
}

async function collect() {
  const sorts = await get(SORTS_URL);
  const seed = new Map();
  for (const sort of sorts.sorts) {
    if (!sort.games) continue;
    for (const g of sort.games) {
      if (g.isSponsored || seed.has(g.universeId)) continue;
      seed.set(g.universeId, { up: g.totalUpVotes || 0, down: g.totalDownVotes || 0, genre: g.genreL1 || "" });
    }
  }
  return seed;
}

async function details(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await get(`https://games.roblox.com/v1/games?universeIds=${chunk.join(",")}`);
    out.push(...res.data);
    await sleep(500);
  }
  return out;
}

async function icons(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${chunk.join(",")}&size=256x256&format=Png`);
    for (const t of res.data) {
      if (t.state === "Completed") map.set(t.targetId, t.imageUrl);
    }
    await sleep(500);
  }
  return map;
}

async function shots(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const res = await get(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${chunk.join(",")}&size=768x432&format=Png&countPerUniverse=3`);
    for (const entry of res.data) {
      const urls = (entry.thumbnails || []).filter(t => t.state === "Completed").map(t => t.imageUrl);
      if (urls.length) map.set(entry.universeId, urls);
    }
    await sleep(500);
  }
  return map;
}

async function votes(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await get(`https://games.roblox.com/v1/games/votes?universeIds=${chunk.join(",")}`);
    for (const v of res.data) map.set(v.id, { up: v.upVotes, down: v.downVotes });
    await sleep(500);
  }
  return map;
}

async function headshots(userIds) {
  const map = new Map();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const res = await get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${chunk.join(",")}&size=150x150&format=Png`);
    for (const t of res.data) {
      if (t.state === "Completed") map.set(t.targetId, t.imageUrl);
    }
    await sleep(400);
  }
  return map;
}

async function userBadges(userIds) {
  const map = new Map();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    try {
      const res = await post("https://users.roblox.com/v1/users", { userIds: chunk, excludeBannedUsers: false }, 6);
      for (const u of res.data) map.set(u.id, Boolean(u.hasVerifiedBadge));
    } catch (err) {
      console.log(`badge lookup failed for ${chunk.length} users: ${err.message}`);
    }
    await sleep(1000);
  }
  return map;
}

async function groupProfile(id) {
  const info = await get(`https://groups.roblox.com/v1/groups/${id}`);
  await sleep(400);
  const roleData = await get(`https://groups.roblox.com/v1/groups/${id}/roles`);
  await sleep(400);

  const roles = roleData.roles
    .filter(r => r.memberCount > 0)
    .sort((a, b) => b.rank - a.rank)
    .map(r => ({ id: r.id, name: r.name, rank: r.rank, members: r.memberCount }));

  const staff = [];
  for (const role of roles.slice(0, 2)) {
    if (role.members > STAFF_LIMIT) continue;
    try {
      const members = await get(`https://groups.roblox.com/v1/groups/${id}/roles/${role.id}/users?limit=25&sortOrder=Asc`, 2);
      for (const u of members.data) {
        staff.push({ id: u.userId, name: u.username, display: u.displayName, role: role.name, rank: role.rank, verified: Boolean(u.hasVerifiedBadge) });
      }
    } catch {}
    await sleep(400);
  }

  return {
    type: "group",
    id,
    name: info.name,
    description: info.description || "",
    members: info.memberCount,
    verified: Boolean(info.hasVerifiedBadge),
    open: Boolean(info.publicEntryAllowed),
    shout: info.shout ? info.shout.body : "",
    owner: info.owner ? { id: info.owner.userId, name: info.owner.username, display: info.owner.displayName, verified: Boolean(info.owner.hasVerifiedBadge) } : null,
    roles: roles.map(r => ({ name: r.name, rank: r.rank, members: r.members })),
    staff: staff.slice(0, 20)
  };
}

async function userProfile(id) {
  const info = await get(`https://users.roblox.com/v1/users/${id}`);
  await sleep(400);
  return {
    type: "user",
    id,
    name: info.name,
    display: info.displayName,
    description: info.description || "",
    created: info.created,
    verified: Boolean(info.hasVerifiedBadge)
  };
}

async function creators(games, cached) {
  const out = {};
  const stale = Date.now() - CREATOR_DAYS * 86400000;
  const wanted = new Map();

  for (const g of games) {
    const key = `${g.creator.type.toLowerCase()}:${g.creator.id}`;
    if (!wanted.has(key)) wanted.set(key, g.creator);
  }

  let budget = CREATOR_BUDGET;
  for (const [key, creator] of wanted) {
    const old = cached[key];
    if (old && new Date(old.fetched).getTime() > stale) {
      out[key] = old;
      continue;
    }
    if (budget <= 0) {
      if (old) out[key] = old;
      continue;
    }
    budget--;
    try {
      const profile = creator.type === "Group" ? await groupProfile(creator.id) : await userProfile(creator.id);
      out[key] = { ...profile, fetched: new Date().toISOString() };
    } catch (err) {
      if (old) out[key] = old;
      console.log(`skipped ${key}: ${err.message}`);
    }
  }

  const faces = [];
  for (const profile of Object.values(out)) {
    if (profile.type === "user") faces.push(profile.id);
    if (profile.owner) faces.push(profile.owner.id);
    for (const s of profile.staff || []) faces.push(s.id);
  }

  const pending = wanted.size - Object.keys(out).length;
  if (pending) console.log(`${pending} creators left for the next run`);

  const people = [...new Set(faces)];
  const avatars = await headshots(people);
  const flags = await userBadges(people);

  for (const profile of Object.values(out)) {
    if (profile.type === "user") {
      profile.avatar = avatars.get(profile.id) || profile.avatar || "";
      if (flags.has(profile.id)) profile.verified = flags.get(profile.id);
    }
    if (profile.owner) {
      profile.owner.avatar = avatars.get(profile.owner.id) || profile.owner.avatar || "";
      if (flags.has(profile.owner.id)) profile.owner.verified = flags.get(profile.owner.id);
    }
    for (const s of profile.staff || []) {
      s.avatar = avatars.get(s.id) || s.avatar || "";
      if (flags.has(s.id)) s.verified = flags.get(s.id);
    }
  }

  return out;
}

function badges(games, previous, now) {
  const out = {};
  const changes = [];

  for (const g of games) {
    const key = `${g.creator.type.toLowerCase()}:${g.creator.id}`;
    if (out[key]) continue;

    const verified = Boolean(g.creator.hasVerifiedBadge);
    const old = previous[key];
    const flipped = old && old.verified !== verified;
    if (flipped) changes.push(`${g.creator.name} ${verified ? "got" : "lost"} the verified badge`);

    out[key] = {
      name: g.creator.name,
      type: g.creator.type,
      verified,
      changed: flipped ? now : (old && old.changed) || null
    };
  }

  for (const line of changes) console.log(line);
  return out;
}

function read(file, fallback) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function write(file, value) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(value));
}

async function main() {
  const seed = await collect();
  if (!seed.size) throw new Error("no universes returned by explore api");

  const now = new Date().toISOString();
  const roster = read("roster.json", { seen: {} }).seen;
  for (const id of seed.keys()) roster[id] = now;

  const cutoff = Date.now() - ROSTER_DAYS * 86400000;
  const ids = [];
  for (const [id, last] of Object.entries(roster)) {
    if (new Date(last).getTime() < cutoff) {
      delete roster[id];
      continue;
    }
    ids.push(Number(id));
  }

  const games = await details(ids);
  const iconMap = await icons(ids);
  const shotMap = await shots(ids);
  const voteMap = await votes(ids);
  const creatorMap = await creators(games, read("creators.json", { creators: {} }).creators);
  const badgeMap = badges(games, read("badges.json", { creators: {} }).creators, now);

  for (const [key, profile] of Object.entries(creatorMap)) {
    if (badgeMap[key]) profile.verified = badgeMap[key].verified;
  }

  const previous = read("games.json", { games: [] });
  const before = new Map(previous.games.map(g => [g.id, g]));
  const stored = read("events.json", { events: [] });
  const events = stored.events;

  const detail = {};

  const list = games.map(g => {
    const s = seed.get(g.id);
    const old = before.get(g.id);
    const vote = voteMap.get(g.id);
    const key = `${g.creator.type.toLowerCase()}:${g.creator.id}`;

    detail[g.id] = {
      description: (g.description || "").slice(0, 1200),
      shots: shotMap.get(g.id) || [],
      creatorKey: creatorMap[key] ? key : "",
      maxPlayers: g.maxPlayers,
      copying: Boolean(g.copyingAllowed),
      vip: Boolean(g.createVipServersAllowed),
      avatarType: g.universeAvatarType,
      genres: [g.genre_l1, g.genre_l2].filter(Boolean),
      created: g.created
    };

    return {
      id: g.id,
      place: g.rootPlaceId,
      name: g.name,
      creator: g.creator.name,
      creatorType: g.creator.type,
      creatorVerified: Boolean(g.creator.hasVerifiedBadge),
      icon: iconMap.get(g.id) || (old && old.icon) || "",
      genre: (s && s.genre) || g.genre_l1 || (old && old.genre) || "",
      chart: Boolean(s),
      playing: g.playing,
      visits: g.visits,
      favorites: g.favoritedCount,
      up: (vote && vote.up) || (s && s.up) || (old && old.up) || 0,
      down: (vote && vote.down) || (s && s.down) || (old && old.down) || 0,
      created: g.created,
      updated: g.updated
    };
  });

  let shipped = 0;
  for (const g of list) {
    const old = before.get(g.id);
    if (!old || new Date(g.updated) <= new Date(old.updated)) continue;
    events.unshift({
      id: g.id,
      place: g.place,
      name: g.name,
      icon: g.icon,
      at: g.updated,
      previous: old.updated,
      playing: g.playing,
      detected: now
    });
    shipped++;
  }

  list.sort((a, b) => new Date(b.updated) - new Date(a.updated));

  write("games.json", { generated: now, count: list.length, games: list });
  write("events.json", { generated: now, events: events.slice(0, MAX_EVENTS) });
  write("roster.json", { seen: roster });
  write("details.json", { generated: now, games: detail });
  write("creators.json", { generated: now, creators: creatorMap });
  write("badges.json", { generated: now, creators: badgeMap });

  const groups = Object.values(creatorMap).filter(c => c.type === "group").length;
  const verified = Object.values(badgeMap).filter(b => b.verified).length;
  console.log(`tracked ${list.length} games, ${shipped} new updates, ${events.length} events stored, ${groups} groups profiled, ${verified} verified creators`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
