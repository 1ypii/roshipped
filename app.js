const PAGE = 60;
const LIVE = "/api/live";

const state = { games: [], events: [], gaps: new Map(), query: "", from: 0, to: Infinity, sort: "newest", view: "grid", shown: PAGE, generated: null };

const cards = document.getElementById("cards");
const feed = document.getElementById("feed");
const empty = document.getElementById("empty");
const more = document.getElementById("more");
const search = document.getElementById("search");
const tabs = document.getElementById("tabs");
const views = document.getElementById("views");
const bar = document.getElementById("grid");
const sort = document.getElementById("sort");

const placeholder = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 44 44%22%3E%3Crect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%2321262c%22/%3E%3C/svg%3E";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ESC[c]);
}

function digits(text) {
  return [...String(text)].map(ch => `<span class="roll">${ch}</span>`).join("");
}

function badge(on) {
  return on ? `<img class="verified" src="verified.svg" alt="verified" title="verified">` : "";
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ago(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 90) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${plural(mins, "minute")} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${plural(days, "day")} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${plural(months, "month")} ago`;
  return `${plural(Math.floor(days / 365), "year")} ago`;
}

function gapText(hours) {
  if (hours < 48) return plural(Math.max(Math.round(hours), 1), "hour");
  const days = Math.round(hours / 24);
  if (days < 31) return plural(days, "day");
  return plural(Math.round(days / 30), "month");
}

function compact(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "b";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function stale(iso) {
  return Date.now() - new Date(iso) > 30 * 86400000;
}

function card(g, i) {
  const gap = state.gaps.get(g.id);
  const note = gap && gap >= 72 ? `<span class="note">${gapText(gap)} without an update before this</span>` : "";
  return `<button class="card${stale(g.updated) ? " is-quiet" : ""}" data-id="${g.id}" style="animation-delay:${Math.min(i, 18) * 16}ms">
    <span class="card-head">
      <img class="icon" src="${g.icon || placeholder}" alt="" loading="lazy" onerror="this.src='${placeholder}'">
      <span class="card-title">
        <span class="name">${esc(g.name)}</span>
        <span class="creator">${esc(g.creator)}${badge(g.creatorVerified)}${g.genre ? `<span class="tag">${esc(g.genre)}</span>` : ""}</span>
      </span>
    </span>
    <span class="card-rows">
      <span class="line"><label>shipped</label><b>${ago(g.updated)}</b></span>
      <span class="line"><label>playing</label><span class="v-playing">${digits(compact(g.playing))}</span></span>
      <span class="line"><label>visits</label><span class="v-visits">${digits(compact(g.visits))}</span></span>
    </span>
    ${note}
  </button>`;
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  let list = state.games;

  if (state.from > 0 || state.to < Infinity) {
    const newest = Date.now() - state.from * 86400000;
    const oldest = state.to === Infinity ? -Infinity : Date.now() - state.to * 86400000;
    list = list.filter(g => {
      const t = new Date(g.updated).getTime();
      return t <= newest && t > oldest;
    });
  }
  if (q) {
    list = list.filter(g => (g.name + " " + g.creator).toLowerCase().includes(q));
  }

  const sorted = list.slice();
  if (state.sort === "playing") sorted.sort((a, b) => b.playing - a.playing);
  else if (state.sort === "visits") sorted.sort((a, b) => b.visits - a.visits);
  else if (state.sort === "gap") sorted.sort((a, b) => (state.gaps.get(b.id) || 0) - (state.gaps.get(a.id) || 0));
  else sorted.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  return sorted;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((start - day) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}`;
}

function eventRow(e) {
  const gap = e.previous ? gapText((new Date(e.at) - new Date(e.previous)) / 3600000) + " since last" : "first ship seen";
  const inner = `<img class="icon" src="${e.icon || placeholder}" alt="" loading="lazy" onerror="this.src='${placeholder}'">
    <span class="event-name">${esc(e.name)}</span>
    <span class="event-gap">${gap}</span>
    <span class="event-playing">${compact(e.playing)} playing</span>
    <span class="event-when">${ago(e.at)}</span>`;
  return state.games.some(g => g.id === e.id)
    ? `<button class="event" data-id="${e.id}">${inner}</button>`
    : `<a class="event" href="https://www.roblox.com/games/${e.place}" target="_blank" rel="noopener">${inner}</a>`;
}

function renderFeed() {
  const slice = state.events.slice(0, state.shown);
  let html = "";
  let day = "";
  for (const e of slice) {
    const label = dayLabel(e.at);
    if (label !== day) {
      day = label;
      html += `<h3 class="day">${label}</h3>`;
    }
    html += eventRow(e);
  }
  feed.innerHTML = html;

  const left = state.events.length - slice.length;
  more.hidden = left <= 0;
  more.textContent = `show ${Math.min(left, PAGE)} more of ${left.toLocaleString()}`;
  empty.hidden = state.events.length > 0;
}

function render() {
  if (state.view === "feed") {
    renderFeed();
    return;
  }

  const list = filtered();
  const slice = list.slice(0, state.shown);
  cards.innerHTML = slice.map(card).join("");

  const left = list.length - slice.length;
  more.hidden = left <= 0;
  more.textContent = `show ${Math.min(left, PAGE)} more of ${left.toLocaleString()}`;
  empty.hidden = list.length > 0;
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function within(days) {
  const cutoff = Date.now() - days * 86400000;
  return state.games.filter(g => new Date(g.updated).getTime() >= cutoff).length;
}

const counters = new Map();

function count(id, value) {
  const el = document.getElementById(id);
  const from = counters.get(id);
  counters.set(id, value);

  if (from === undefined || from === value || reduced) {
    el.textContent = value.toLocaleString();
    return;
  }

  const diff = value - from;
  const t0 = performance.now();
  function step(t) {
    const p = Math.min((t - t0) / 600, 1);
    el.textContent = Math.round(from + diff * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderStats() {
  count("stat-shipped", within(1));
  count("stat-tracked", state.games.length);
  count("stat-week", within(7));
  count("stat-cold", state.games.length - within(30));
  document.getElementById("stat-checked").textContent = state.generated ? ago(state.generated) : "–";

  for (const tab of tabs.querySelectorAll(".tab")) {
    const from = Number(tab.dataset.from);
    const to = tab.dataset.to ? Number(tab.dataset.to) : Infinity;
    const newest = Date.now() - from * 86400000;
    const oldest = to === Infinity ? -Infinity : Date.now() - to * 86400000;
    const n = state.games.filter(g => {
      const t = new Date(g.updated).getTime();
      return t <= newest && t > oldest;
    }).length;
    tab.querySelector(".tab-n").textContent = n.toLocaleString();
  }
}

async function load() {
  try {
    const [games, events] = await Promise.all([
      fetch("data/games.json", { cache: "no-store" }).then(r => r.json()),
      fetch("data/events.json", { cache: "no-store" }).then(r => r.json()).catch(() => ({ events: [] }))
    ]);
    if (games.generated === state.generated) return;
    state.generated = games.generated;
    state.games = games.games || [];
    state.events = (events.events || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    state.gaps = new Map();
    for (const e of state.events) {
      if (state.gaps.has(e.id)) continue;
      state.gaps.set(e.id, (new Date(e.at) - new Date(e.previous)) / 3600000);
    }
    renderStats();
    render();
    loadLive();
  } catch {}
}

async function liveCounts() {
  const ids = state.games.map(g => g.id).join(",");
  try {
    const res = await fetch(`${LIVE}?ids=${ids}`, { cache: "no-store" });
    if (res.ok) return res.json();
  } catch {}
  return fetch("data/live.json", { cache: "no-store" }).then(r => r.json());
}

let primed = false;

function tick(el, text, delta) {
  if (!el || el.textContent === text) return;

  const chars = [...text];
  if (el.children.length !== chars.length) {
    el.innerHTML = digits(text);
    return;
  }

  const climbing = delta > 0;
  for (let i = 0; i < chars.length; i++) {
    const slot = el.children[i];
    if (slot.textContent === chars[i]) continue;

    const previous = slot.textContent;
    slot.textContent = chars[i];
    if (!primed || !delta) continue;

    slot.dataset.old = previous;
    slot.classList.remove("tick-up", "tick-down");
    void slot.offsetWidth;
    slot.classList.add(climbing ? "tick-up" : "tick-down");
  }
}

async function loadLive() {
  if (!state.games.length || document.hidden) return;
  try {
    const live = await liveCounts();
    const fresh = live.games || {};
    const moves = new Map();

    for (const g of state.games) {
      const now = fresh[g.id];
      if (!now) continue;
      if (g.playing !== now.playing || g.visits !== now.visits || g.favorites !== now.favorites) {
        moves.set(g.id, {
          playing: now.playing - g.playing,
          visits: now.visits - g.visits,
          favorites: (now.favorites || g.favorites) - g.favorites
        });
      }
      g.playing = now.playing;
      g.visits = now.visits;
      if (now.favorites) g.favorites = now.favorites;
    }

    if (!moves.size) {
      primed = true;
      return;
    }

    for (const el of cards.querySelectorAll(".card")) {
      const id = Number(el.dataset.id);
      const move = moves.get(id);
      if (!move) continue;
      const g = state.games.find(x => x.id === id);
      tick(el.querySelector(".v-playing"), compact(g.playing), move.playing);
      tick(el.querySelector(".v-visits"), compact(g.visits), move.visits);
    }

    const move = !sheet.hidden && moves.get(openId);
    if (move) {
      const g = state.games.find(x => x.id === openId);
      tick(sheetBody.querySelector(".v-playing"), g.playing.toLocaleString(), move.playing);
      tick(sheetBody.querySelector(".v-visits"), g.visits.toLocaleString(), move.visits);
      tick(sheetBody.querySelector(".v-favorites"), g.favorites.toLocaleString(), move.favorites);
    }

    primed = true;
  } catch {}
}

setInterval(load, 120000);
setInterval(loadLive, 12000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadLive();
});

setInterval(() => {
  if (state.generated) renderStats();
}, 60000);

load();

const sheet = document.getElementById("sheet");
const sheetBody = document.getElementById("sheet-body");
let extras = null;
let extrasPending = null;

function loadExtras() {
  if (extras) return Promise.resolve(extras);
  if (!extrasPending) {
    extrasPending = Promise.all([
      fetch("data/details.json", { cache: "no-store" }).then(r => r.json()),
      fetch("data/creators.json", { cache: "no-store" }).then(r => r.json()),
      fetch("data/badges.json", { cache: "no-store" }).then(r => r.json()).catch(() => ({ creators: {} }))
    ]).then(([details, creators, badges]) => {
      extras = { games: details.games || {}, creators: creators.creators || {}, badges: badges.creators || {} };
      return extras;
    });
  }
  return extrasPending;
}

function date(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function ratio(g) {
  const total = g.up + g.down;
  if (!total) return "–";
  return `${Math.round((g.up / total) * 100)}%`;
}

function fact(label, value, cls) {
  return `<div class="fact"><label>${label}</label><span${cls ? ` class="${cls}"` : ""}>${value}</span></div>`;
}

function person(p, sub) {
  return `<a class="person" href="https://www.roblox.com/users/${p.id}/profile" target="_blank" rel="noopener">
    <img src="${p.avatar || placeholder}" alt="" loading="lazy" onerror="this.src='${placeholder}'">
    <span>
      <span class="person-name shine" data-text="${esc(p.display || p.name)}">${esc(p.display || p.name)}${badge(p.verified)}</span>
      <span class="person-sub">${esc(sub || "@" + p.name)}</span>
    </span>
  </a>`;
}

function badgeNote(record) {
  if (!record || !record.changed) return "";
  return `<p class="badge-note">${record.verified ? "got the verified badge" : "lost the verified badge"} ${ago(record.changed)}</p>`;
}

function creatorBlock(profile, record) {
  if (!profile) return "";

  const verified = record ? record.verified : Boolean(profile.verified);

  if (profile.type === "user") {
    return `<section class="block">
      <h3>creator</h3>
      <div class="people">${person({ ...profile, verified }, "@" + profile.name)}</div>
      ${badgeNote(record)}
      ${profile.description ? `<p class="bio">${esc(profile.description)}</p>` : ""}
      <div class="facts">${fact("joined", date(profile.created))}</div>
    </section>`;
  }

  const roles = profile.roles.map(r => `<div class="role">
    <span class="role-name">${esc(r.name)}</span>
    <span class="role-rank">rank ${r.rank}</span>
    <span class="role-count">${r.members.toLocaleString()}</span>
  </div>`).join("");

  const staff = profile.staff.length
    ? `<h4>ranked members</h4><div class="people">${profile.staff.map(s => person(s, s.role)).join("")}</div>`
    : "";

  return `<section class="block">
    <h3>group</h3>
    <div class="group-head">
      <a class="group-name shine" data-text="${esc(profile.name)}" href="https://www.roblox.com/groups/${profile.id}" target="_blank" rel="noopener">${esc(profile.name)}${badge(verified)}</a>
      <span class="group-sub">${profile.members.toLocaleString()} members<span class="tag">${profile.open ? "open to join" : "invite only"}</span></span>
    </div>
    ${badgeNote(record)}
    ${profile.description ? `<p class="bio">${esc(profile.description)}</p>` : ""}
    ${profile.shout ? `<p class="shout">shout: ${esc(profile.shout)}</p>` : ""}
    ${profile.owner ? `<h4>owner</h4><div class="people">${person(profile.owner)}</div>` : `<p class="bio">no owner, the group is unclaimed</p>`}
    ${staff}
    <h4>roles</h4>
    <div class="roles">${roles}</div>
  </section>`;
}

let openId = null;

function openSheet(id) {
  const g = state.games.find(x => x.id === Number(id));
  if (!g) return;

  openId = g.id;

  if (closing) {
    clearTimeout(closing);
    closing = null;
    sheet.classList.remove("closing");
  }

  sheet.hidden = false;
  document.body.classList.add("locked");
  sheetBody.innerHTML = `<div class="loading">loading</div>`;

  loadExtras().then(data => {
    const d = data.games[g.id] || {};
    const profile = d.creatorKey ? data.creators[d.creatorKey] : null;
    const record = d.creatorKey ? data.badges[d.creatorKey] : null;
    const gap = state.gaps.get(g.id);
    const history = state.events.filter(e => e.id === g.id);

    const ships = history.length ? `<section class="block">
      <h3>recent ships</h3>
      <div class="ships">${history.slice(0, 10).map(e => `<div class="ship">
        <span class="ship-when">${ago(e.at)}</span>
        <span class="ship-gap">${e.previous ? "after " + gapText((new Date(e.at) - new Date(e.previous)) / 3600000) : ""}</span>
        <span class="ship-playing">${compact(e.playing)} playing</span>
      </div>`).join("")}</div>
    </section>` : "";

    sheetBody.innerHTML = `
      ${d.shots && d.shots.length ? `<div class="banner"><img src="${d.shots[0]}" alt="" loading="lazy"></div>` : ""}
      <div class="sheet-head">
        <img class="icon" src="${g.icon || placeholder}" alt="" onerror="this.src='${placeholder}'">
        <div>
          <h2>${esc(g.name)}</h2>
          <p>by ${esc(g.creator)}${badge(record ? record.verified : g.creatorVerified)}${(d.genres || []).map(x => `<span class="tag">${esc(x)}</span>`).join("")}</p>
        </div>
        <a class="play shine" data-text="open on roblox" href="https://www.roblox.com/games/${g.place}" target="_blank" rel="noopener">open on roblox</a>
      </div>

      <div class="facts">
        ${fact("last shipped", ago(g.updated))}
        ${fact("created", date(g.created))}
        ${fact("playing", digits(g.playing.toLocaleString()), "v-playing")}
        ${fact("visits", digits(g.visits.toLocaleString()), "v-visits")}
        ${fact("favourites", digits(g.favorites.toLocaleString()), "v-favorites")}
        ${fact("likes", `${ratio(g)} of ${(g.up + g.down).toLocaleString()}`)}
        ${fact("max players", d.maxPlayers || "–")}
        ${fact("private servers", d.vip ? "allowed" : "off")}
        ${fact("copy locked", d.copying ? "no" : "yes")}
        ${fact("avatar type", (d.avatarType || "").replace("MorphTo", "") || "–")}
        ${gap ? fact("gap before this update", gapText(gap)) : ""}
        ${fact("on charts", g.chart ? "yes" : "dropped off")}
      </div>

      ${ships}

      ${d.description ? `<section class="block"><h3>description</h3><p class="bio">${esc(d.description)}</p></section>` : ""}

      ${creatorBlock(profile, record)}

      ${d.shots && d.shots.length > 1 ? `<section class="block"><h3>screenshots</h3><div class="shots">${d.shots.slice(1).map(s => `<img src="${s}" alt="" loading="lazy">`).join("")}</div></section>` : ""}
    `;
  }).catch(() => {
    sheetBody.innerHTML = `<div class="loading">could not load the details</div>`;
  });
}

let closing = null;

function closeSheet() {
  if (closing) return;
  sheet.classList.add("closing");
  closing = setTimeout(() => {
    sheet.classList.remove("closing");
    sheet.hidden = true;
    sheetBody.innerHTML = "";
    document.body.classList.remove("locked");
    closing = null;
  }, reduced ? 0 : 220);
}

cards.addEventListener("click", e => {
  const hit = e.target.closest(".card");
  if (hit) openSheet(hit.dataset.id);
});

feed.addEventListener("click", e => {
  const hit = e.target.closest("button.event");
  if (hit) openSheet(hit.dataset.id);
});

function setView(view) {
  state.view = view;
  state.shown = PAGE;
  views.querySelectorAll("a").forEach(a => a.classList.toggle("is-on", a.dataset.view === view));
  bar.hidden = view !== "grid";
  cards.hidden = view !== "grid";
  feed.hidden = view !== "feed";
  render();
}

views.addEventListener("click", e => {
  const link = e.target.closest("a[data-view]");
  if (!link) return;
  e.preventDefault();
  if (state.view !== link.dataset.view) setView(link.dataset.view);
});

sort.addEventListener("change", () => {
  state.sort = sort.value;
  state.shown = PAGE;
  render();
});

document.getElementById("sheet-back").addEventListener("click", closeSheet);
document.getElementById("sheet-close").addEventListener("click", closeSheet);

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !sheet.hidden) closeSheet();
});

search.addEventListener("input", e => {
  state.query = e.target.value;
  state.shown = PAGE;
  render();
});

tabs.addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  state.from = Number(tab.dataset.from);
  state.to = tab.dataset.to ? Number(tab.dataset.to) : Infinity;
  tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-on", t === tab));
  state.shown = PAGE;
  render();
});

more.addEventListener("click", () => {
  state.shown += PAGE;
  render();
});
