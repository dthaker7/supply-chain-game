/* ════════════════════════════════════════════════════════════════
   config.js — ANIMATION CONFIG (visual layer only)
   --------------------------------------------------------------
   This file contains ONLY numbers/paths that animation.js reads.
   It does not touch game state, does not define game logic, and
   is safe to hand-tune without breaking the simulation.

   Coordinates are all in the ORIGINAL map-art pixel space
   (1373 × 1145 — the size of assets/map/map_daylight.png), the
   same space the existing sim.html canvas code already uses for
   STORAGE_RECT / DELIVERY_PATH, so everything lines up.
   ════════════════════════════════════════════════════════════════ */
window.ANIM_CONFIG = {

  // ── Sprite assets (paths verified against the actual uploaded
  //    asset folder — the placeholder paths in the old inline
  //    drawStoreMap() pointed at files that don't exist, e.g.
  //    "assets/car1.png" / "assets/storage_box.png") ──
  assets: {
    mapDay:      'assets/map/map_daylight.png',
    // No dedicated night map was supplied in the project. Rather than
    // invent a new art asset, night mode is a dark/blue color-overlay
    // applied on top of the same map art (see night.overlayColor below).
    mapNight:    null,
    // cars
    carA:        'assets/cars/car1.png',
    carB:        'assets/cars/car2.png',
    carC:        'assets/cars/car3.png',
    carD:        'assets/cars/car4.png',
    carE:        'assets/cars/car5.png',
    carF:        'assets/cars/car6.png',
    // cookie box
    cookie0:   'assets/storage/cookie/0_cookie.png',
    cookie20:  'assets/storage/cookie/20_cookie.png',
    cookie40:  'assets/storage/cookie/40_cookie.png',
    cookie60:  'assets/storage/cookie/60_cookie.png',
    cookie80:  'assets/storage/cookie/80_cookie.png',
    cookie100: 'assets/storage/cookie/100_cookie.png',
    // other
    coffeeSack:  'assets/storage/coffee/coffee_sack.png',
    // walking human sprite sheet (12 frames, 300x420 each, transparent PNG)
    walkSheet:   'assets/characters/walk_2d_spritesheet.png',
    cookieBox:   'assets/storage/cookie/cookie_box.png',
    // coffee box — same tiered-image approach as the cookie stack,
    // assumed to follow the same naming pattern as the cookie files
    // (0_cookie.png etc.) inside assets/storage/coffee/. If your
    // actual filenames differ, just update these six paths.
    coffee0:   'assets/storage/coffee/0_coffee.png',
    coffee20:  'assets/storage/coffee/20_coffee.png',
    coffee40:  'assets/storage/coffee/40_coffee.png',
    coffee60:  'assets/storage/coffee/60_coffee.png',
    coffee80:  'assets/storage/coffee/80_coffee.png',
    coffee100: 'assets/storage/coffee/100_coffee.png',
  },

  map: { w: 1373, h: 1145 },

  // ── Fit mode ─────────────────────────────────────────────────
  // The canvas pixel box itself (its W×H) is NOT set here — that
  // comes from CSS in sim.html: #main's grid-template-columns
  // (line ~485, "minmax(0,0.55fr) minmax(560px,1.45fr)") decides
  // how wide the left column is, and #canvas-wrap fills the full
  // height of that row. Resize by editing that grid-template-columns
  // ratio (bigger first fraction = wider canvas), not in this file.
  //
  // What THIS file controls is how the 1373×1145 map art gets
  // placed inside whatever box that CSS produces:
  //   'cover'   → map fills the box completely, cropping overflow.
  //               Set focus.x/focus.y below to choose what stays
  //               visible.
  //   'contain' → the WHOLE map is shown, scaled down to fit, with
  //               letterbox bars filling the leftover space. Nothing
  //               is ever cropped.
  fit: 'contain',
  letterboxColor: '#150f1e',

  // ── Camera framing (only used when fit:'cover') ────────────────
  // A plain center-crop on the whole map would crop in from both
  // sides and often center on empty road/trees instead of the
  // storage/cafe/parking/entrance area. `focus` is the map-space
  // point the crop centers on instead.
  focus: { x: 585, y: 430 },

  // ── Warehouse / storage room (reuses the rect the original code
  //    already marked out for the storage floor) ──
  warehouse: {
    rect: { x: 435, y: 130, w: 215, h: 195 },
    // loading dock just outside the storage room, used by the
    // "Place Order" loading animation before the truck pulls away
    cookieStorage: {
      scale: 1.17,
      offsetX: -15,
      offsetY: -12 
    },
    // Starting point copied from cookieStorage above — tune scale/
    // offsetX/offsetY independently once the real coffee art is in,
    // since its sprite dimensions/padding may differ from cookie's.
    coffeeStorage: {
      scale: 1.10,
      offsetX: -15,
      offsetY: 45
    },
    dock: { x: 545, y: 340 },
  },

  // How many units one drawn sprite represents, used for BOTH products.
  // 0-10 units -> 1 sack, 20 -> 2, 40 -> 4, 100 -> 10 (matches spec exactly:
  // spriteCount = clamp(ceil(units / unitsPerSprite), 1, maxSprites)).
  stack: {
    unitsPerSprite: 10,
    maxSprites: 10,
    cols: 3,
  },

  // ── Continuous background road traffic (decorative, never stops) ──
  // Car sprites (car1.png/car2.png) are natively 1536×1024 = a 3:2
  // aspect ratio. carW/carH below are kept at that ratio so sprites
  // aren't squashed/stretched — a mismatched box (the old 78×40,
  // ≈2:1) is what made cars look thin/elongated.
  road: {
    laneY: [1090, 1030],       // two lanes, opposite directions
    xEnter: -140,
    xExit: 1513,
    carCount: 4,
    speedRange: [55, 110],     // px/sec in map space
    spacingRange: [220, 520],  // min gap enforced when (re)spawning
    carW: 160, carH: 100,
  },

  // ── Parking lot: a handful of always-present bays; every so often
  //    one car leaves and a new one pulls in. Bays are stacked in a
  //    single column (verified against the original "staff sedan"
  //    spot, which is bay #2 here) because the lot art parks cars
  //    sideways, one row per horizontal white tick-mark. ──
  parkingLot: {
    spots: [
      { x: 288, y: 462, angle: Math.PI },
      { x: 288, y: 540, angle: Math.PI }, // the old "staff sedan" bay
      { x: 288, y: 620, angle: Math.PI },
      { x: 288, y: 700, angle: Math.PI },
    ],
    carW: 160, carH: 100,
    turnoverSecRange: [20, 40],
    // point just off the driveway a car arrives from / leaves toward
    approach: { x: 560, y: 700 },
  },

  // ── Delivery truck (order fulfilment) ──
  delivery: {
    path: [
      { x: 1450, y: 1018 },
      { x: 860,  y: 1018 },
      { x: 615,  y: 1018 },
      { x: 605,  y: 860  },
      { x: 565,  y: 700  },
      { x: 460,  y: 700  },
      { x: 300,  y: 610  },
    ],
    truckW: 84, truckH: 56,
    driveInSec: 2.6,
    unloadSec: 1.2,
    driveOutSec: 1.8,
    defaultSpriteAngle: Math.PI, // sprite art faces LEFT by default
  },

  // ── "Place Order" loading sequence at the warehouse dock, plays
  //    immediately when the button is pressed (before any truck has
  //    physically arrived — matches "boxes move, truck leaves") ──
  orderLoading: {
    boxMoveSec: 1.0,
    truckDepartSec: 1.2,
  },

  // ── Inventory stack transition (never an instant snap) ──
  inventoryAnim: {
    totalMs: 900,           // shrink+fade -> fade+grow, split 50/50
    minScale: 0.55,
  },

  // ── Decorative walking customers (separate from, and additive to,
  //    the existing sale-result customer sprites already in GS.customers) ──
  customers: {
    entrance: { x: 895, y: 875 },  // the double glass doors on the south wall
    cafeSpot: { x: 820, y: 340 },  // inside, among the dining tables — NOT the storage room
    spawnEveryMsRange: [3000, 7000],
    walkSec: 4.5,
    size: 14,
    // ── Sprite-sheet walk animation (replaces the old drawn blob) ──
    sprite: {
      frames: 12,          // number of frames across the sheet
      frameW: 300,         // px per frame in the sheet
      frameH: 420,
      fps: 14,             // playback speed of the walk cycle
      drawH: 100,           // on-map draw height in map pixels
      flipWhenMovingLeft: true,
    },
  },

  // ── Day/night ambient cycle (purely decorative; the sim itself is
  //    turn-based by day, so this just cycles on a real-time timer) ──
  night: {
    cycleMs: 90000,     // full day->night->day cycle length
    fadeMs: 4000,
    overlayColor: 'rgba(10,15,45,0.55)',
  },
  fps: 60,
};
