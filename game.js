/* ============================================================
   BROKEN CITY — game.js
   Engine + UI + Leaflet/OpenStreetMap rendering. Vanilla JS, no build step.
   Section map:
     1. Utilities
     2. State setup (zones, adjacency, factions)
     3. Combat / economy / training math
     4. Game loop (tick)
     5. Simple AI
     6. Leaflet map rendering
     7. UI panels & interaction
     8. Boot
   ============================================================ */

'use strict';

/* ---------------------------------------------------------------
   1. UTILITIES
   --------------------------------------------------------------- */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, h)));
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function byId(id) { return document.getElementById(id); }
function unitDefOf(factionId, unitKey) {
  const f = FACTIONS[factionId];
  return f ? f.units[unitKey] : null;
}
function totalGarrisonCount(garrison) {
  if (!garrison) return 0;
  return Object.values(garrison).reduce((s, c) => s + c, 0);
}

/* ---------------------------------------------------------------
   2. STATE SETUP
   --------------------------------------------------------------- */
const STATE = {
  zones: {},          // id -> zone runtime object
  adjacency: {},       // id -> [ids]
  factions: {},        // id -> { fund }
  playerFaction: null,
  marches: [],          // active troop movements
  selectedZone: null,
  attackSourceZone: null,
  pickingTarget: false,
  gameOver: false,
  startedAt: 0,
  lastTick: 0,
  map: null,
  markers: {},          // zoneId -> Leaflet circleMarker
  edgeLines: [],         // all adjacency polylines
  highlightLines: [],     // currently highlighted polylines (from selected zone)
  marchMarkers: {}        // marchId -> Leaflet circleMarker (the moving troop dot)
};

function buildAdjacency() {
  const adj = {};
  ZONES.forEach(z => { adj[z.id] = new Set(); });
  ZONES.forEach(z => {
    const dists = ZONES.filter(o => o.id !== z.id)
      .map(o => ({ id: o.id, d: haversineKm(z, o) }))
      .sort((a, b) => a.d - b.d);
    dists.slice(0, BALANCE.maxAdjacencyPerZone).forEach(n => {
      if (n.d <= BALANCE.maxAdjacencyKm) {
        adj[z.id].add(n.id);
        adj[n.id].add(z.id);
      }
    });
  });
  // safety net: guarantee every zone has at least 1 connection
  ZONES.forEach(z => {
    if (adj[z.id].size === 0) {
      const nearest = ZONES.filter(o => o.id !== z.id)
        .sort((a, b) => haversineKm(z, a) - haversineKm(z, b))[0];
      if (nearest) { adj[z.id].add(nearest.id); adj[nearest.id].add(z.id); }
    }
  });
  const out = {};
  Object.keys(adj).forEach(k => { out[k] = Array.from(adj[k]); });
  return out;
}

function setupInitialZones() {
  const zones = {};
  ZONES.forEach(z => {
    const garrison = {};
    if (z.start) {
      const faction = FACTIONS[z.start];
      // unit roster is always ordered [light, standard, elite] in config.js
      const standardKey = Object.keys(faction.units)[1];
      garrison[standardKey] = z.capital ? BALANCE.capitalGarrison.infantryLike : 3;
    }
    zones[z.id] = {
      ...z,
      owner: z.start || null,
      garrison,
      stamina: BALANCE.staminaMax,
      trainingQueue: [], // { unitKey, remainingSec, totalSec }
      lastCombatAt: 0
    };
  });
  return zones;
}

function setupFactions() {
  const f = {};
  Object.keys(FACTIONS).forEach(id => { f[id] = { fund: BALANCE.startingFund }; });
  return f;
}

/* ---------------------------------------------------------------
   3. COMBAT / ECONOMY / TRAINING MATH
   --------------------------------------------------------------- */
// Returns the combined multiplier for one unit type given context.
function getUnitMultiplier(unitDef, when, terrainId, hpPct) {
  let mult = 1.0;
  const terrain = TERRAIN[terrainId];
  if (terrain) mult *= (when === 'attack' ? terrain.attack : terrain.defense);
  (unitDef.modifiers || []).forEach(mod => {
    if (mod.when !== when) return;
    if (mod.belowHpPct !== undefined && !(hpPct !== undefined && hpPct < mod.belowHpPct)) return;
    if (mod.terrain === null) { mult *= mod.mult; return; }
    if (mod.terrain === 'notcity' && terrainId !== 'city') { mult *= mod.mult; return; }
    if (mod.terrain === terrainId) { mult *= mod.mult; }
  });
  return mult;
}

function staminaFactor(stamina) {
  // below 40 stamina, units start losing effectiveness, down to 60% at 0 stamina
  if (stamina >= 40) return 1.0;
  return 0.6 + (stamina / 40) * 0.4;
}

// Power of a set of units (garrison object) belonging to factionId, fighting at terrainId.
function computeSidePower(garrison, factionId, when, terrainId, stamina, hpPct) {
  if (!factionId) return 0; // neutral handled separately
  let power = 0;
  Object.keys(garrison || {}).forEach(unitKey => {
    const count = garrison[unitKey];
    if (!count) return;
    const def = unitDefOf(factionId, unitKey);
    if (!def) return;
    const stat = when === 'attack' ? def.atk : def.hp;
    power += count * stat * getUnitMultiplier(def, when, terrainId, hpPct);
  });
  return power * staminaFactor(stamina !== undefined ? stamina : BALANCE.staminaMax);
}

function neutralDefensePower(zone) {
  return BALANCE.neutralBaseDefense[zone.fund] * TERRAIN[zone.terrain].defense;
}

function travelTimeSec(fromZone, toZone, garrison, factionId) {
  const distKm = Math.max(0.15, haversineKm(fromZone, toZone));
  // average speed multiplier of the units being sent, weighted by count
  let totalCount = 0, weighted = 0;
  Object.keys(garrison).forEach(k => {
    const def = unitDefOf(factionId, k);
    if (!def || !garrison[k]) return;
    totalCount += garrison[k];
    let unitSpeed = def.speed;
    if (def.light && TERRAIN[toZone.terrain].lightSpeedBonus) unitSpeed *= TERRAIN[toZone.terrain].lightSpeedBonus;
    weighted += garrison[k] * unitSpeed;
  });
  const avgUnitSpeed = totalCount > 0 ? weighted / totalCount : 1.0;
  const terrainSpeed = (TERRAIN[fromZone.terrain].speed + TERRAIN[toZone.terrain].speed) / 2;
  const effSpeed = Math.max(0.15, avgUnitSpeed * terrainSpeed);
  const sec = (distKm * BALANCE.baseTravelSecPerKm) / effSpeed;
  return clamp(sec, BALANCE.minTravelSec, BALANCE.maxTravelSec);
}

function queueTraining(zoneId, unitKey) {
  const zone = STATE.zones[zoneId];
  if (!zone || !zone.owner) return { ok: false, msg: 'Zone has no owner.' };
  const def = unitDefOf(zone.owner, unitKey);
  if (!def) return { ok: false, msg: 'Unknown unit.' };
  const faction = STATE.factions[zone.owner];
  if (faction.fund < def.cost) return { ok: false, msg: 'Not enough fund.' };
  faction.fund -= def.cost;
  zone.trainingQueue.push({ unitKey, remainingSec: def.buildTime, totalSec: def.buildTime });
  return { ok: true };
}

function sendMarch(fromZoneId, toZoneId, pct) {
  const from = STATE.zones[fromZoneId];
  const to = STATE.zones[toZoneId];
  if (!from || !to || !from.owner) return { ok: false, msg: 'Invalid source.' };
  if (!STATE.adjacency[fromZoneId].includes(toZoneId)) return { ok: false, msg: 'Not adjacent.' };

  const sent = {};
  let any = false;
  Object.keys(from.garrison).forEach(k => {
    const n = Math.floor((from.garrison[k] || 0) * pct);
    if (n > 0) { sent[k] = n; any = true; }
  });
  if (!any) return { ok: false, msg: 'No units to send.' };

  Object.keys(sent).forEach(k => { from.garrison[k] -= sent[k]; });
  from.stamina = clamp(from.stamina - 10, 0, BALANCE.staminaMax);

  const dur = travelTimeSec(from, to, sent, from.owner);
  const march = {
    id: 'm_' + Math.random().toString(36).slice(2, 9),
    faction: from.owner,
    from: fromZoneId,
    to: toZoneId,
    units: sent,
    stamina: from.stamina,
    departAt: performance.now(),
    arriveAt: performance.now() + dur * 1000,
    durSec: dur
  };
  STATE.marches.push(march);
  if (typeof onMarchCreated === 'function') onMarchCreated(march);
  return { ok: true, march };
}

function resolveCombat(march) {
  const to = STATE.zones[march.to];
  const attackerFaction = march.faction;
  const attackPower = computeSidePower(march.units, attackerFaction, 'attack', to.terrain, march.stamina, undefined);

  let defensePower, defenderFaction = to.owner;
  const hpPctOfDefender = to.owner ? clamp(totalGarrisonCount(to.garrison) / 15, 0, 1) : undefined;

  if (!to.owner) {
    defensePower = neutralDefensePower(to);
  } else if (to.owner === attackerFaction) {
    // reinforcing own zone (target was originally adjacent & friendly) — just merge, no battle
    Object.keys(march.units).forEach(k => { to.garrison[k] = (to.garrison[k] || 0) + march.units[k]; });
    return { captured: false, reinforced: true };
  } else {
    defensePower = computeSidePower(to.garrison, to.owner, 'defense', to.terrain, to.stamina, hpPctOfDefender);
  }

  const result = { captured: false, reinforced: false, attackerWon: false, from: march.from, to: march.to, faction: attackerFaction };

  if (attackPower > defensePower && attackPower > 0) {
    const survivorRatio = defensePower >= attackPower ? 0 : (attackPower - defensePower) / attackPower;
    const newGarrison = {};
    Object.keys(march.units).forEach(k => {
      const n = Math.max(survivorRatio > 0 ? 1 : 0, Math.floor(march.units[k] * survivorRatio));
      if (n > 0) newGarrison[k] = n;
    });
    if (totalGarrisonCount(newGarrison) === 0) {
      // ensure at least a token garrison so the zone isn't instantly free again
      const firstKey = Object.keys(march.units)[0];
      if (firstKey) newGarrison[firstKey] = 1;
    }
    to.owner = attackerFaction;
    to.garrison = newGarrison;
    to.stamina = clamp(to.stamina - 25, 0, BALANCE.staminaMax);
    to.trainingQueue = []; // queue belonged to old owner
    result.captured = true;
    result.attackerWon = true;
  } else {
    // attacker repelled — defender takes proportional losses
    const dmgRatio = defensePower > 0 ? clamp(attackPower / defensePower, 0, 1) : 1;
    if (to.owner) {
      Object.keys(to.garrison).forEach(k => {
        to.garrison[k] = Math.max(0, Math.floor(to.garrison[k] * (1 - dmgRatio * 0.6)));
      });
    }
    to.stamina = clamp(to.stamina - 10, 0, BALANCE.staminaMax);
    result.attackerWon = false;
  }
  return result;
}

/* ---------------------------------------------------------------
   4. GAME LOOP
   --------------------------------------------------------------- */
function economyTick(dtSec) {
  Object.values(STATE.zones).forEach(z => {
    if (!z.owner) return;
    STATE.factions[z.owner].fund += (FUND_TIERS[z.fund] || 0) * dtSec;
  });
}

function trainingTick(dtSec) {
  Object.values(STATE.zones).forEach(z => {
    if (!z.trainingQueue.length) return;
    const job = z.trainingQueue[0];
    job.remainingSec -= dtSec;
    if (job.remainingSec <= 0) {
      z.garrison[job.unitKey] = (z.garrison[job.unitKey] || 0) + 1;
      z.trainingQueue.shift();
      if (STATE.selectedZone === z.id) updatePanel();
    }
  });
}

function staminaTick(dtSec) {
  Object.values(STATE.zones).forEach(z => {
    if (!z.owner) return;
    const regen = TERRAIN[z.terrain].staminaRegen * 2 * dtSec;
    z.stamina = clamp(z.stamina + regen, 0, BALANCE.staminaMax);
  });
}

function marchesTick(now) {
  const arrived = STATE.marches.filter(m => now >= m.arriveAt);
  if (!arrived.length) return;
  STATE.marches = STATE.marches.filter(m => now < m.arriveAt);
  arrived.forEach(m => {
    const result = resolveCombat(m);
    if (typeof onMarchResolved === 'function') onMarchResolved(m, result);
  });
}

function checkWinCondition() {
  if (STATE.gameOver) return;
  const counts = { DF: 0, CLF: 0, PPNF: 0 };
  Object.values(STATE.zones).forEach(z => { if (z.owner) counts[z.owner]++; });
  const total = ZONES.length;
  Object.keys(counts).forEach(f => {
    if (counts[f] >= Math.ceil(total * BALANCE.winZonePct)) {
      endGame(f);
    }
  });
  // player eliminated
  if (counts[STATE.playerFaction] === 0 && (STATE.startedAt && performance.now() - STATE.startedAt > 15000)) {
    const enemies = Object.keys(counts).filter(f => f !== STATE.playerFaction);
    const winner = enemies.sort((a, b) => counts[b] - counts[a])[0];
    endGame(winner);
  }
}

function endGame(winnerFaction) {
  if (STATE.gameOver) return;
  STATE.gameOver = true;
  const youWon = winnerFaction === STATE.playerFaction;
  showBanner(youWon
    ? `VICTORY — ${FACTIONS[winnerFaction].name} controls Parepare.`
    : `DEFEAT — ${FACTIONS[winnerFaction].name} has taken the city.`);
}

let lastFrameTime = performance.now();
function gameLoop() {
  const now = performance.now();
  const dtSec = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (!STATE.gameOver) {
    economyTick(dtSec);
    trainingTick(dtSec);
    staminaTick(dtSec);
    marchesTick(now);
    checkWinCondition();
  }
  updateHud();
  updateMarchAnimations(now);
  requestAnimationFrame(gameLoop);
}

let aiTimer = 0;
function aiHeartbeat() {
  if (!STATE.gameOver) {
    Object.keys(FACTIONS).forEach(f => { if (f !== STATE.playerFaction) aiThink(f); });
  }
  setTimeout(aiHeartbeat, BALANCE.aiTickEverySec * 1000);
}

/* ---------------------------------------------------------------
   5. SIMPLE AI
   --------------------------------------------------------------- */
function aiThink(factionId) {
  const faction = STATE.factions[factionId];
  const owned = Object.values(STATE.zones).filter(z => z.owner === factionId);
  if (!owned.length) return;

  // 1. Maybe train a unit at a random owned zone (prefer frontline zones)
  const unitKeys = Object.keys(FACTIONS[factionId].units);
  const affordable = unitKeys.filter(k => FACTIONS[factionId].units[k].cost <= faction.fund * 0.8);
  if (affordable.length) {
    const pick = affordable[Math.floor(Math.random() * affordable.length)];
    const zone = owned[Math.floor(Math.random() * owned.length)];
    if (zone.trainingQueue.length < 3) queueTraining(zone.id, pick);
  }

  // 2. Try one attack from a frontier zone against its weakest non-owned neighbor
  const frontier = owned.filter(z =>
    STATE.adjacency[z.id].some(nId => STATE.zones[nId].owner !== factionId)
  );
  if (!frontier.length) return;
  const src = frontier[Math.floor(Math.random() * frontier.length)];
  const targets = STATE.adjacency[src.id]
    .map(id => STATE.zones[id])
    .filter(z => z.owner !== factionId);
  if (!targets.length) return;

  let best = null, bestDef = Infinity;
  targets.forEach(t => {
    const def = t.owner ? computeSidePower(t.garrison, t.owner, 'defense', t.terrain, t.stamina, undefined) : neutralDefensePower(t);
    if (def < bestDef) { bestDef = def; best = t; }
  });
  if (!best) return;
  const myPower = computeSidePower(src.garrison, factionId, 'attack', best.terrain, src.stamina, undefined);
  if (myPower > bestDef * 1.15 && totalGarrisonCount(src.garrison) >= 3) {
    sendMarch(src.id, best.id, 0.7);
  }
}

/* ---------------------------------------------------------------
   6. LEAFLET MAP RENDERING (OpenStreetMap, no API key needed)
   --------------------------------------------------------------- */
function initMap() {
  try {
    if (typeof L === 'undefined') throw new Error('Leaflet failed to load');
    STATE.map = L.map(byId('map'), {
      center: [MAP_CENTER.lat, MAP_CENTER.lng],
      zoom: MAP_ZOOM,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19
    }).addTo(STATE.map);
    STATE.map.on('click', () => deselectZone());
    byId('start-screen').classList.remove('hidden');
  } catch (err) {
    console.error('Broken City: failed to init map', err);
    byId('maps-error').classList.remove('hidden');
  }
}

function zoneRadius(zoneId) {
  const total = totalGarrisonCount(STATE.zones[zoneId].garrison);
  return clamp(8 + Math.sqrt(total) * 2.6, 8, 30);
}

function buildMarkersAndEdges() {
  ZONES.forEach(z => {
    const marker = L.circleMarker([z.lat, z.lng], zoneStyle(z.id));
    marker.bindTooltip(zoneLabelText(z.id), {
      permanent: true, direction: 'center', className: 'zone-label', interactive: false
    });
    marker.on('click', () => onZoneClick(z.id));
    marker.addTo(STATE.map);
    STATE.markers[z.id] = marker;
  });

  const drawn = new Set();
  Object.keys(STATE.adjacency).forEach(id => {
    STATE.adjacency[id].forEach(otherId => {
      const key = [id, otherId].sort().join('|');
      if (drawn.has(key)) return;
      drawn.add(key);
      const line = L.polyline(
        [[STATE.zones[id].lat, STATE.zones[id].lng], [STATE.zones[otherId].lat, STATE.zones[otherId].lng]],
        { color: '#3a4252', opacity: 0.55, weight: 1.5, interactive: false }
      ).addTo(STATE.map);
      STATE.edgeLines.push(line);
    });
  });
}

function isZoneVisible(zoneId) {
  const z = STATE.zones[zoneId];
  if (z.owner === STATE.playerFaction) return true;
  const adj = STATE.adjacency[zoneId] || [];
  let visible = adj.some(id => STATE.zones[id].owner === STATE.playerFaction);
  if (!visible) {
    // mountain vision extends 2 hops for the player's own mountain zones
    Object.values(STATE.zones).forEach(p => {
      if (p.owner === STATE.playerFaction && p.terrain === 'mountain') {
        if ((STATE.adjacency[p.id] || []).some(id => (STATE.adjacency[id] || []).includes(zoneId))) visible = true;
      }
    });
  }
  return visible;
}

function zoneStyle(zoneId) {
  const z = STATE.zones[zoneId];
  const ownerColor = z.owner ? FACTIONS[z.owner].color : '#5a6172';
  const isSelected = STATE.selectedZone === zoneId;
  const isCandidateTarget = STATE.pickingTarget && (STATE.adjacency[STATE.attackSourceZone || ''] || []).includes(zoneId);
  return {
    radius: zoneRadius(zoneId),
    color: isSelected ? '#ffd23f' : (isCandidateTarget ? '#7CFC9A' : '#0c0f14'),
    weight: isSelected || isCandidateTarget ? 3.5 : (z.capital ? 2.5 : 1.4),
    fillColor: ownerColor,
    fillOpacity: z.owner ? 0.92 : 0.55
  };
}

function zoneLabelText(zoneId) {
  const z = STATE.zones[zoneId];
  const visible = isZoneVisible(zoneId);
  let countText = '–';
  if (z.owner) {
    let total = totalGarrisonCount(z.garrison);
    if (!visible) {
      if (z.terrain === 'forest') {
        countText = '?';
      } else {
        total = Math.round(total * (0.65 + Math.random() * 0.3));
        countText = '~' + total;
      }
    } else {
      countText = '' + total;
    }
  } else {
    countText = '' + Math.round(neutralDefensePower(z));
  }
  return TERRAIN[z.terrain].emoji + ' ' + countText;
}

function renderZone(zoneId) {
  const marker = STATE.markers[zoneId];
  if (!marker) return;
  marker.setStyle(zoneStyle(zoneId));
  marker.setTooltipContent(zoneLabelText(zoneId));
}

function renderAllZones() {
  Object.keys(STATE.markers).forEach(renderZone);
}

function clearHighlightLines() {
  STATE.highlightLines.forEach(l => l.remove());
  STATE.highlightLines = [];
}

function highlightAdjacency(zoneId) {
  clearHighlightLines();
  (STATE.adjacency[zoneId] || []).forEach(otherId => {
    const line = L.polyline(
      [[STATE.zones[zoneId].lat, STATE.zones[zoneId].lng], [STATE.zones[otherId].lat, STATE.zones[otherId].lng]],
      { color: '#ffd23f', opacity: 0.9, weight: 2.5, interactive: false }
    ).addTo(STATE.map);
    STATE.highlightLines.push(line);
  });
}

function onMarchCreated(march) {
  const marker = L.circleMarker([STATE.zones[march.from].lat, STATE.zones[march.from].lng], {
    radius: 5,
    color: '#fff',
    weight: 1,
    fillColor: FACTIONS[march.faction].color,
    fillOpacity: 1,
    interactive: false
  }).addTo(STATE.map);
  STATE.marchMarkers[march.id] = marker;
  renderZone(march.from);
}

function updateMarchAnimations(now) {
  STATE.marches.forEach(m => {
    const marker = STATE.marchMarkers[m.id];
    if (!marker) return;
    const t = clamp((now - m.departAt) / (m.arriveAt - m.departAt), 0, 1);
    const from = STATE.zones[m.from], to = STATE.zones[m.to];
    marker.setLatLng([
      from.lat + (to.lat - from.lat) * t,
      from.lng + (to.lng - from.lng) * t
    ]);
  });
}

function onMarchResolved(march, result) {
  const marker = STATE.marchMarkers[march.id];
  if (marker) { marker.remove(); delete STATE.marchMarkers[march.id]; }
  renderZone(march.to);
  renderZone(march.from);
  if (march.faction === STATE.playerFaction || result.captured) {
    let msg;
    if (result.reinforced) msg = `Reinforced ${STATE.zones[march.to].name}.`;
    else if (result.captured) msg = `${FACTIONS[march.faction].short} captured ${STATE.zones[march.to].name}!`;
    else msg = `Attack on ${STATE.zones[march.to].name} was repelled.`;
    pushToast(msg);
  }
  if (STATE.selectedZone === march.to || STATE.selectedZone === march.from) updatePanel();
}

/* ---------------------------------------------------------------
   7. UI PANELS & INTERACTION
   --------------------------------------------------------------- */
function updateHud() {
  if (!STATE.playerFaction) return;
  byId('hud-fund').textContent = fmt(STATE.factions[STATE.playerFaction].fund);
  const owned = Object.values(STATE.zones).filter(z => z.owner === STATE.playerFaction).length;
  byId('hud-zones').textContent = `${owned}/${ZONES.length}`;
  const elapsed = STATE.startedAt ? Math.floor((performance.now() - STATE.startedAt) / 1000) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  byId('hud-clock').textContent = `${mm}:${ss}`;
}

function onZoneClick(zoneId) {
  if (STATE.gameOver) return;
  if (STATE.pickingTarget) {
    if (STATE.adjacency[STATE.attackSourceZone].includes(zoneId) && zoneId !== STATE.attackSourceZone) {
      openSendPanel(zoneId);
      return;
    }
    if (zoneId === STATE.attackSourceZone) { exitAttackMode(); return; }
  }
  selectZone(zoneId);
}

function selectZone(zoneId) {
  STATE.selectedZone = zoneId;
  STATE.pickingTarget = false;
  STATE.attackSourceZone = null;
  clearHighlightLines();
  renderAllZones();
  updatePanel();
}

function deselectZone() {
  STATE.selectedZone = null;
  STATE.pickingTarget = false;
  STATE.attackSourceZone = null;
  clearHighlightLines();
  renderAllZones();
  byId('panel').classList.add('hidden');
  byId('send-modal').classList.add('hidden');
}

function enterAttackMode(zoneId) {
  STATE.attackSourceZone = zoneId;
  STATE.pickingTarget = true;
  highlightAdjacency(zoneId);
  renderAllZones();
  pushToast('Tap a connected zone to send your forces.');
}

function exitAttackMode() {
  STATE.pickingTarget = false;
  STATE.attackSourceZone = null;
  clearHighlightLines();
  renderAllZones();
}

function updatePanel() {
  const zoneId = STATE.selectedZone;
  if (!zoneId) { byId('panel').classList.add('hidden'); return; }
  const z = STATE.zones[zoneId];
  const panel = byId('panel');
  panel.classList.remove('hidden');

  const terrain = TERRAIN[z.terrain];
  const ownerName = z.owner ? FACTIONS[z.owner].name : 'Unclaimed';
  const ownerColor = z.owner ? FACTIONS[z.owner].color : '#7a8190';
  const visible = isZoneVisible(zoneId);

  byId('panel-title').textContent = (z.capital ? '★ ' : '') + z.name;
  byId('panel-owner').textContent = ownerName;
  byId('panel-owner').style.color = ownerColor;
  byId('panel-terrain').textContent = `${terrain.emoji} ${terrain.name} — ${terrain.desc}`;
  byId('panel-fund').textContent = `Fund output: ${FUND_TIERS[z.fund]}/s`;
  byId('panel-stamina').textContent = `Stamina: ${Math.round(z.stamina)}/100`;

  const garrisonEl = byId('panel-garrison');
  garrisonEl.innerHTML = '';
  if (z.owner && (visible || z.owner === STATE.playerFaction)) {
    Object.keys(z.garrison).forEach(k => {
      const count = z.garrison[k];
      if (!count) return;
      const def = unitDefOf(z.owner, k);
      const row = document.createElement('div');
      row.className = 'garrison-row';
      row.textContent = `${def ? def.name : k} × ${count}`;
      garrisonEl.appendChild(row);
    });
    if (!Object.values(z.garrison).some(c => c > 0)) {
      garrisonEl.innerHTML = '<div class="garrison-row dim">No active garrison</div>';
    }
  } else if (z.owner) {
    garrisonEl.innerHTML = '<div class="garrison-row dim">Garrison hidden — scout an adjacent zone</div>';
  } else {
    garrisonEl.innerHTML = `<div class="garrison-row dim">Local resistance ≈ ${Math.round(neutralDefensePower(z))}</div>`;
  }

  if (z.trainingQueue.length) {
    const job = z.trainingQueue[0];
    const def = unitDefOf(z.owner, job.unitKey);
    const pct = Math.round(100 * (1 - job.remainingSec / job.totalSec));
    byId('panel-training').classList.remove('hidden');
    byId('panel-training').innerHTML = `Training ${def.name}… ${pct}% <span class="dim">(+${z.trainingQueue.length - 1} queued)</span>`;
  } else {
    byId('panel-training').classList.add('hidden');
  }

  const actions = byId('panel-actions');
  actions.innerHTML = '';
  if (z.owner === STATE.playerFaction) {
    const trainWrap = document.createElement('div');
    trainWrap.className = 'train-grid';
    Object.values(FACTIONS[STATE.playerFaction].units).forEach(u => {
      const btn = document.createElement('button');
      btn.className = 'btn train-btn';
      btn.innerHTML = `<b>${u.name}</b><span>${u.cost}f · ${u.buildTime}s</span>`;
      btn.title = u.trait;
      btn.onclick = () => {
        const r = queueTraining(zoneId, u.key);
        if (!r.ok) pushToast(r.msg); else updatePanel();
      };
      trainWrap.appendChild(btn);
    });
    actions.appendChild(trainWrap);

    if (totalGarrisonCount(z.garrison) > 0 && (STATE.adjacency[zoneId] || []).length) {
      const atkBtn = document.createElement('button');
      atkBtn.className = 'btn attack-btn';
      atkBtn.textContent = STATE.pickingTarget && STATE.attackSourceZone === zoneId
        ? 'Cancel targeting'
        : 'Send forces ▸';
      atkBtn.onclick = () => {
        if (STATE.pickingTarget && STATE.attackSourceZone === zoneId) exitAttackMode();
        else enterAttackMode(zoneId);
        updatePanel();
      };
      actions.appendChild(atkBtn);
    }
  }
}

let pendingSendTarget = null;
function openSendPanel(targetZoneId) {
  pendingSendTarget = targetZoneId;
  const to = STATE.zones[targetZoneId];
  byId('send-modal-title').textContent = `Send forces to ${to.name}`;
  byId('send-modal').classList.remove('hidden');
}
function confirmSend(pct) {
  if (!pendingSendTarget) return;
  const r = sendMarch(STATE.attackSourceZone, pendingSendTarget, pct);
  if (!r.ok) pushToast(r.msg);
  byId('send-modal').classList.add('hidden');
  exitAttackMode();
  updatePanel();
  pendingSendTarget = null;
}

let toastTimer = null;
function pushToast(msg) {
  const el = byId('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function showBanner(text) {
  byId('banner-text').textContent = text;
  byId('banner').classList.remove('hidden');
}

/* ---------------------------------------------------------------
   8. BOOT
   --------------------------------------------------------------- */
function startGame(factionId) {
  STATE.playerFaction = factionId;
  STATE.zones = setupInitialZones();
  STATE.adjacency = buildAdjacency();
  STATE.factions = setupFactions();
  STATE.marches = [];
  STATE.gameOver = false;
  STATE.startedAt = performance.now();
  lastFrameTime = performance.now();

  byId('start-screen').classList.add('hidden');
  byId('hud').classList.remove('hidden');
  byId('legend-toggle').classList.remove('hidden');
  byId('banner').classList.add('hidden');

  buildMarkersAndEdges();
  STATE.map.setView([MAP_CENTER.lat, MAP_CENTER.lng], MAP_ZOOM);

  requestAnimationFrame(gameLoop);
  setTimeout(aiHeartbeat, BALANCE.aiTickEverySec * 1000);
}

function restartGame() {
  location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();

  document.querySelectorAll('.faction-card').forEach(card => {
    card.addEventListener('click', () => startGame(card.dataset.faction));
  });
  document.querySelectorAll('.send-pct').forEach(btn => {
    btn.addEventListener('click', () => confirmSend(parseFloat(btn.dataset.pct)));
  });
  byId('send-cancel').addEventListener('click', () => {
    byId('send-modal').classList.add('hidden');
    pendingSendTarget = null;
  });
  byId('panel-close').addEventListener('click', deselectZone);
  byId('legend-toggle').addEventListener('click', () => byId('legend-panel').classList.toggle('hidden'));
  byId('legend-close').addEventListener('click', () => byId('legend-panel').classList.add('hidden'));
  byId('banner-restart').addEventListener('click', restartGame);
});
