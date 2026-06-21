/* ============================================================
   BROKEN CITY — config.js
   All tunable game data lives here on purpose: terrain rules,
   faction rosters, and the zone map of Parepare. Akbar, kalau
   mau rebalance unit atau nambah zona, edit di sini aja, gak
   perlu sentuh game.js.
   ============================================================ */

// ---- MAP CENTER -------------------------------------------------
// Kota Parepare, Sulawesi Selatan. Dipakai buat map.setCenter().
const MAP_CENTER = { lat: -4.0135, lng: 119.6400 };
const MAP_ZOOM = 13;

// ---- TERRAIN ------------------------------------------------------
// Semua angka adalah MULTIPLIER (1.0 = normal/baseline).
// attack  -> dikalikan ke attack power unit yang MENYERANG zona ini
// defense -> dikalikan ke defense power unit yang BERTAHAN di zona ini
// speed   -> dikalikan ke kecepatan gerak (mempercepat/memperlambat waktu deploy)
// vision  -> radius "pandangan" zona (dipakai buat fog/stealth, lihat game.js)
// staminaRegen -> seberapa cepat stamina garrison pulih per tick di zona ini
// staminaDrain -> seberapa cepat stamina terkuras saat zona ini "aktif" (combat/march)
const TERRAIN = {
  highway: {
    id: 'highway', name: 'Jalan Raya', emoji: '🛣️',
    speed: 1.50, defense: 0.85, attack: 1.00, vision: 1.00,
    staminaRegen: 1.0, staminaDrain: 1.0,
    desc: '+50% kecepatan gerak, -15% pertahanan',
    color: '#5b6472'
  },
  hill: {
    id: 'hill', name: 'Bukit', emoji: '⛰️',
    speed: 0.90, defense: 1.00, attack: 1.20, vision: 1.20,
    staminaRegen: 1.0, staminaDrain: 1.0,
    desc: '+20% daya serang (jarak tembak), sedikit lebih lambat',
    color: '#8a7355'
  },
  forest: {
    id: 'forest', name: 'Hutan', emoji: '🌲',
    speed: 0.80, defense: 1.25, attack: 0.80, vision: 0.55,
    staminaRegen: 1.0, staminaDrain: 1.0,
    desc: '+25% pertahanan, susah terdeteksi, -20% kecepatan, jarak tembak berkurang',
    color: '#2f5d3a'
  },
  mountain: {
    id: 'mountain', name: 'Gunung', emoji: '🏔️',
    speed: 0.50, defense: 1.30, attack: 1.00, vision: 1.40,
    staminaRegen: 0.9, staminaDrain: 1.0,
    desc: '+40% vision, +30% pertahanan, -50% kecepatan, unit berat susah lewat',
    color: '#6b6f76'
  },
  swamp: {
    id: 'swamp', name: 'Rawa', emoji: '🪵',
    speed: 0.60, defense: 1.20, attack: 1.00, vision: 0.85,
    staminaRegen: 0.6, staminaDrain: 1.2,
    desc: 'Musuh lebih sulit menyerang, -40% kecepatan, regenerasi stamina berkurang',
    color: '#4a5d4a'
  },
  desert: {
    id: 'desert', name: 'Gurun', emoji: '🏜️',
    speed: 1.00, defense: 0.95, attack: 1.00, vision: 1.10,
    staminaRegen: 0.8, staminaDrain: 1.4,
    lightSpeedBonus: 1.15, // tambahan khusus unit "light"
    desc: 'Unit ringan +15% kecepatan, kehilangan stamina lebih cepat',
    color: '#c2a05a'
  },
  city: {
    id: 'city', name: 'Kota', emoji: '🏙️',
    speed: 1.00, defense: 1.35, attack: 1.00, vision: 1.00,
    staminaRegen: 1.1, staminaDrain: 1.0,
    areaVulnerability: 1.5, // dipakai elite unit (dianggap bawa firepower lebih besar)
    desc: '+35% pertahanan & perlindungan bangunan, rentan unit elite/serangan area',
    color: '#7a5a8a'
  },
  river: {
    id: 'river', name: 'Sungai', emoji: '🌊',
    speed: 0.40, defense: 1.05, attack: 1.10, vision: 0.95,
    staminaRegen: 1.2, staminaDrain: 1.0,
    desc: 'Pendinginan senjata lebih cepat (+10% serangan), -60% kecepatan saat menyeberang',
    color: '#2a6f97'
  }
};

// ---- FACTIONS & UNITS ----------------------------------------------
// modifiers: array of { when:'attack'|'defense', terrain:'city'|null, mult, belowHpPct }
// 'terrain:null' artinya berlaku di semua terrain.
const FACTIONS = {
  DF: {
    id: 'DF', name: 'Dam Frut', short: 'DF', color: '#d6453d',
    tagline: 'Kekuatan jumlah & murah meriah',
    units: {
      militia: {
        key: 'militia', name: 'Militia', cost: 50, atk: 8, hp: 20,
        speed: 1.0, buildTime: 6, light: true,
        trait: 'Murah, bisa di-spam', modifiers: []
      },
      infantry: {
        key: 'infantry', name: 'Infantry', cost: 100, atk: 15, hp: 40,
        speed: 1.0, buildTime: 10, light: false,
        trait: 'Standar', modifiers: []
      },
      legioner: {
        key: 'legioner', name: 'Frut Legioner', cost: 220, atk: 30, hp: 70,
        speed: 0.9, buildTime: 18, light: false,
        trait: 'Elite', modifiers: []
      }
    }
  },
  CLF: {
    id: 'CLF', name: 'City Liberation Front', short: 'CLF', color: '#3d7ea6',
    tagline: 'Moral tinggi, bertahan dengan gigih',
    units: {
      volunteer: {
        key: 'volunteer', name: 'Volunteer', cost: 70, atk: 10, hp: 30,
        speed: 1.05, buildTime: 8, light: true,
        trait: 'Moral kuat — defense +15% saat bertahan',
        modifiers: [{ when: 'defense', terrain: null, mult: 1.15 }]
      },
      peacekeeper: {
        key: 'peacekeeper', name: 'Peacekeeper', cost: 100, atk: 14, hp: 42,
        speed: 1.0, buildTime: 10, light: false,
        trait: 'Standar (mirip Infantry)', modifiers: []
      },
      liberator: {
        key: 'liberator', name: 'Liberator', cost: 230, atk: 28, hp: 75,
        speed: 0.95, buildTime: 18, light: false,
        trait: 'Elite', modifiers: []
      }
    }
  },
  PPNF: {
    id: 'PPNF', name: 'Pare Pare Nationalist Front', short: 'PPNF', color: '#c79a2b',
    tagline: 'Spesialis kota, bertahan sampai titik darah penghabisan',
    units: {
      streetMilitia: {
        key: 'streetMilitia', name: 'Street Militia', cost: 65, atk: 9, hp: 24,
        speed: 1.0, buildTime: 7, light: true,
        trait: 'Spesialis Kota: kuat di terrain Kota, lemah di terrain lain. Bonus saat desperate defense (HP zona < 25%).',
        modifiers: [
          { when: 'attack', terrain: 'city', mult: 1.5 },
          { when: 'defense', terrain: 'city', mult: 1.5 },
          { when: 'attack', terrain: 'notcity', mult: 0.7 },
          { when: 'defense', terrain: 'notcity', mult: 0.7 },
          { when: 'defense', terrain: null, mult: 1.25, belowHpPct: 0.25 }
        ]
      },
      infantry: {
        key: 'infantry', name: 'Infantry', cost: 100, atk: 15, hp: 40,
        speed: 1.0, buildTime: 10, light: false,
        trait: 'Standar', modifiers: []
      },
      republicCorps: {
        key: 'republicCorps', name: 'Republic Corps', cost: 225, atk: 29, hp: 72,
        speed: 0.9, buildTime: 18, light: false,
        trait: 'Elite', modifiers: []
      }
    }
  }
};

// ---- FUND TIERS -----------------------------------------------------
const FUND_TIERS = { none: 0, low: 4, med: 9, high: 16 }; // fund per tick (1 tick = 1 detik in-game accrual handled fractionally)

// ---- ZONES ------------------------------------------------------------
// terrain: salah satu key di TERRAIN
// fund: salah satu key di FUND_TIERS
// start: 'DF' | 'CLF' | 'PPNF' | null (null = netral di awal game)
// capital: true untuk 1 zona awal tiap faksi (markas)
const ZONES = [
  // --- DF: pesisir selatan & pelabuhan ---
  { id: 'port_nusantara', name: 'Pelabuhan Nusantara', terrain: 'city', fund: 'high', lat: -4.0080, lng: 119.6175, start: 'DF', capital: true },
  { id: 'cappa_ujung', name: 'Cappa Ujung', terrain: 'highway', fund: 'med', lat: -4.0010, lng: 119.6195, start: 'DF', capital: false },
  { id: 'cempae', name: 'Cempae', terrain: 'highway', fund: 'low', lat: -4.0150, lng: 119.6160, start: 'DF', capital: false },

  // --- CLF: pesisir utara ---
  { id: 'soreang', name: 'Soreang', terrain: 'city', fund: 'high', lat: -3.9980, lng: 119.6325, start: 'CLF', capital: true },
  { id: 'pantai_lumpue', name: 'Pantai Lumpue', terrain: 'swamp', fund: 'low', lat: -3.9920, lng: 119.6215, start: 'CLF', capital: false },
  { id: 'watang_soreang', name: 'Watang Soreang', terrain: 'highway', fund: 'low', lat: -3.9930, lng: 119.6285, start: 'CLF', capital: false },

  // --- PPNF: pusat kota ---
  { id: 'bau_massepe', name: 'Jl. Bau Massepe', terrain: 'city', fund: 'high', lat: -4.0135, lng: 119.6285, start: 'PPNF', capital: true },
  { id: 'lapadde', name: 'Lapadde', terrain: 'city', fund: 'med', lat: -4.0195, lng: 119.6355, start: 'PPNF', capital: false },
  { id: 'mallusetasi', name: 'Mallusetasi', terrain: 'highway', fund: 'low', lat: -4.0225, lng: 119.6300, start: 'PPNF', capital: false },

  // --- Netral: bisa direbut siapa saja ---
  { id: 'ujung_sabbang', name: 'Ujung Sabbang', terrain: 'city', fund: 'med', lat: -4.0040, lng: 119.6240, start: null },
  { id: 'jl_sudirman', name: 'Jl. Sudirman', terrain: 'highway', fund: 'med', lat: -4.0100, lng: 119.6330, start: null },
  { id: 'lakessi', name: 'Lakessi', terrain: 'swamp', fund: 'low', lat: -3.9885, lng: 119.6305, start: null },
  { id: 'kampung_pisang', name: 'Kampung Pisang', terrain: 'swamp', fund: 'low', lat: -3.9845, lng: 119.6355, start: null },
  { id: 'sungai_karajae', name: 'Sungai Karajae', terrain: 'river', fund: 'none', lat: -4.0160, lng: 119.6405, start: null },
  { id: 'galung_maloang', name: 'Tambang Pasir Galung Maloang', terrain: 'desert', fund: 'low', lat: -4.0250, lng: 119.6455, start: null },
  { id: 'tiro_sompe', name: 'Tiro Sompe', terrain: 'swamp', fund: 'low', lat: -4.0300, lng: 119.6405, start: null },
  { id: 'lemoe', name: 'Lemoe', terrain: 'hill', fund: 'med', lat: -4.0080, lng: 119.6505, start: null },
  { id: 'bukit_kenari', name: 'Bukit Kenari', terrain: 'hill', fund: 'med', lat: -4.0000, lng: 119.6555, start: null },
  { id: 'kebun_jompie', name: 'Kebun Raya Jompie', terrain: 'forest', fund: 'low', lat: -3.9930, lng: 119.6450, start: null },
  { id: 'bacukiki_barat', name: 'Bacukiki Barat', terrain: 'city', fund: 'med', lat: -4.0355, lng: 119.6505, start: null },
  { id: 'bacukiki', name: 'Bacukiki', terrain: 'forest', fund: 'low', lat: -4.0405, lng: 119.6605, start: null },
  { id: 'watang_bacukiki', name: 'Watang Bacukiki', terrain: 'hill', fund: 'low', lat: -4.0300, lng: 119.6605, start: null },
  { id: 'gunung_nepo', name: 'Gunung Nepo', terrain: 'mountain', fund: 'high', lat: -4.0150, lng: 119.6700, start: null },
  { id: 'cappa_galung', name: 'Cappa Galung', terrain: 'highway', fund: 'low', lat: -3.9800, lng: 119.6430, start: null },
  { id: 'tonrangeng', name: 'Tonrangeng River Park', terrain: 'river', fund: 'low', lat: -3.9960, lng: 119.6510, start: null }
];

// ---- BALANCE CONSTANTS -----------------------------------------------
const BALANCE = {
  startingFund: 300,
  capitalGarrison: { infantryLike: 5 }, // tiap capital mulai dengan 5 unit "standard" faksinya
  neutralBaseDefense: { none: 12, low: 18, med: 26, high: 36 }, // pertahanan default zona netral (per fund tier)
  tickMs: 1000, // 1 game-tick = 1 detik nyata
  aiTickEverySec: 4,
  maxAdjacencyPerZone: 4,
  maxAdjacencyKm: 3.0,
  baseTravelSecPerKm: 7,
  minTravelSec: 3,
  maxTravelSec: 35,
  staminaMax: 100,
  winZonePct: 0.6 // a faction controlling this share of all zones wins
};

// ---- MAP TILES (Leaflet + OpenStreetMap, no API key needed) -----------
// CARTO's free "Dark Matter" tiles are built on OpenStreetMap data and give
// the dark war-room look without any signup, key, or billing.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
