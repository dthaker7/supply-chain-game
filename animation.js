/* ════════════════════════════════════════════════════════════════
   animation.js — VISUAL LAYER ONLY
   --------------------------------------------------------------
   This file does NOT define any game logic. It never writes to
   GS.inv / GS.pipe / GS.cash / etc. It only READS state that the
   existing sim.html already computes (GS, UI, PRODS) and turns it
   into motion on the <canvas id="SC"> element.

   How it hooks in (without editing sim.html's existing script):
     • sim.html's inline script declares `function loop(){...}` and
       calls it (unqualified) from _launchGame() every time a game
       starts/resumes. Because this file is loaded via a <script>
       tag AFTER that inline script, our `function loop(){...}`
       below simply becomes the live global — the same trick lets
       the old drawStoreMap()/spawnCust()/spawnPart() keep existing
       untouched (they're just no longer called by anything, since
       only `loop` gets invoked from outside).
     • placeOrder() is wrapped (not replaced) so the original
       ordering logic runs exactly as before; we just piggy-back a
       visual afterward.
   ════════════════════════════════════════════════════════════════ */

(function(){
  const CFG = window.ANIM_CONFIG;
  const CAR_TYPES = ['carA', 'carB', 'carC', 'carD', 'carE', 'carF'];
  // ── Sprite cache (separate from the old SPR object so we can't
  //    collide with it; pure image loading, no logic) ──
  const _img = {};
  function img(key, src){
    if(!src) return null;
    let im = _img[key];
    if(!im){ im = new Image(); im.src = src; _img[key] = im; }
    return im;
  }
  function ready(im){ return !!(im && im.complete && im.naturalWidth); }

  // ── Reuse the math helpers already defined in sim.html instead
  //    of duplicating them (toCanvas / pathPoint / drawCarSprite /
  //    drawBoxCluster / CAR_DEFAULT_ANGLE / MAP_W / MAP_H) ──

  // sim.html's coverTransform() always centers the crop on the
  // map's raw geometric center, which — on a canvas narrower than
  // it is tall — pushed the storage/cafe/parking/entrance area
  // toward one edge and mostly showed empty road/trees on the
  // other.
  //
  // CFG.fit controls how the 1373×1145 map art is placed inside
  // whatever pixel box the canvas ends up being (that box's W/H
  // come from #canvas-wrap's CSS in sim.html — see the note above
  // CFG.fit in config.js):
  //   'cover'   → map fills the box edge-to-edge, cropping whichever
  //               dimension overflows. CFG.focus (in config.js)
  //               picks WHICH part of the map stays on-screen.
  //   'contain' → the whole map is scaled down to fit inside the box
  //               with nothing cropped, leaving letterbox bars on
  //               the two edges that don't touch. CFG.focus is
  //               unused in this mode since nothing is cropped.
  function frameTransform(W, H){
    const scale = CFG.fit === 'contain'
      ? Math.min(W/CFG.map.w, H/CFG.map.h)
      : Math.max(W/CFG.map.w, H/CFG.map.h);
    const dw = CFG.map.w*scale, dh = CFG.map.h*scale;
    if(CFG.fit === 'contain'){
      return { scale, ox:(W-dw)/2, oy:(H-dh)/2, dw, dh };
    }
    let ox = W/2 - CFG.focus.x*scale;
    let oy = H/2 - CFG.focus.y*scale;
    ox = Math.min(0, Math.max(W-dw, ox));
    oy = Math.min(0, Math.max(H-dh, oy));
    return { scale, ox, oy, dw, dh };
  }

  // ════════════════════════════════════════════════
  // BACKGROUND CACHE — the expensive scaled map draw
  // happens once per canvas size, not once per frame.
  // ════════════════════════════════════════════════
  const bg = document.createElement('canvas');
  const bgCtx = bg.getContext('2d');
  let bgW = 0, bgH = 0, bgTr = null;

  function ensureBackground(W, H){
    if(bgW === W && bgH === H && bgTr) return;
    bg.width = W; bg.height = H; bgW = W; bgH = H;
    bgTr = frameTransform(W, H);
    const mapImg = img('map', CFG.assets.mapDay);
    if(ready(mapImg)){
      bgCtx.clearRect(0,0,W,H);
      if(CFG.fit === 'contain'){
        bgCtx.fillStyle = CFG.letterboxColor;
        bgCtx.fillRect(0,0,W,H);
      }
      bgCtx.drawImage(mapImg, bgTr.ox, bgTr.oy, bgTr.dw, bgTr.dh);
    } else {
      const g = bgCtx.createLinearGradient(0,0,0,H);
      g.addColorStop(0,'#2a221b'); g.addColorStop(1,'#3a2e22');
      bgCtx.fillStyle = g; bgCtx.fillRect(0,0,W,H);
      if(mapImg && !mapImg.__hooked){
        mapImg.__hooked = true;
        mapImg.onload = () => { bgW = 0; }; // force a re-cache once it loads
      }
    }
  }

  // ════════════════════════════════════════════════
  // ROAD TRAFFIC — 4 cars, endless loop, random speed/spacing
  // ════════════════════════════════════════════════
  const traffic = [];
  function rand(a,b){ return a + Math.random()*(b-a); }
  function spawnTrafficCar(laneIdx, xOverride){
    const lane = CFG.road.laneY[laneIdx];
    const dir = laneIdx === 0 ? 1 : -1;
    const sprite = CAR_TYPES[Math.floor(Math.random() * CAR_TYPES.length)];
    const x = xOverride !== undefined ? xOverride : (dir===1 ? CFG.road.xEnter - rand(0,300) : CFG.road.xExit + rand(0,300));
    return { lane: laneIdx, y: lane, x, dir, sprite, speed: rand(CFG.road.speedRange[0], CFG.road.speedRange[1]) };
  }
  function initTraffic(){
    traffic.length = 0;
    for(let i=0;i<CFG.road.carCount;i++){
      const laneIdx = i % 2;
      const spread = CFG.road.xExit - CFG.road.xEnter;
      const x = CFG.road.xEnter + (spread/CFG.road.carCount)*i + rand(-40,40);
      traffic.push(spawnTrafficCar(laneIdx, x));
    }
  }
  function stepTraffic(dt){
    // Move cars, then clamp same-lane followers to a minimum gap behind
    // whichever car is ahead of them, so a faster car can never catch up
    // to and overlap a slower one in the same lane.
    traffic.forEach(c=>{ c.x += c.dir * c.speed * dt; });
    const minGap = (CFG.road.spacingRange && CFG.road.spacingRange[0]) || 200;
    const byLane = {};
    traffic.forEach(c=>{ (byLane[c.lane] = byLane[c.lane] || []).push(c); });
    Object.values(byLane).forEach(cars=>{
      const dir = cars[0].dir;
      // Sort leader-first: for dir=1 (moving right) the leader has the
      // largest x; for dir=-1 (moving left) the leader has the smallest x.
      cars.sort((a,b)=> dir===1 ? b.x - a.x : a.x - b.x);
      for(let i=1;i<cars.length;i++){
        const c = cars[i], leader = cars[i-1];
        if(dir===1 && c.x > leader.x - minGap) c.x = leader.x - minGap;
        else if(dir===-1 && c.x < leader.x + minGap) c.x = leader.x + minGap;
      }
    });
    traffic.forEach(c=>{
      if(c.dir===1 && c.x > CFG.road.xExit){
        Object.assign(c, spawnTrafficCar(c.lane));
      } else if(c.dir===-1 && c.x < CFG.road.xEnter){
        Object.assign(c, spawnTrafficCar(c.lane));
      }
    });
  }
  function drawTraffic(ctx, tr){
    traffic.forEach(c=>{
      const im = img(c.sprite, CFG.assets[c.sprite]);
      const p = toCanvas({x:c.x,y:c.y}, tr);
      const angle = c.dir===1 ? 0 : Math.PI;
      drawCarSprite(ctx, im, p.x, p.y, CFG.road.carW*tr.scale, CFG.road.carH*tr.scale, angle);
    });
  }

  // ════════════════════════════════════════════════
  // PARKING LOT — cars idle, then every 20-40s one
  // leaves and a new one arrives.
  // ════════════════════════════════════════════════
  const parking = [];
  function scheduleTurnover(now){
    return now + rand(CFG.parkingLot.turnoverSecRange[0], CFG.parkingLot.turnoverSecRange[1]) * 1000;
  }
  function initParking(now){
    parking.length = 0;
    CFG.parkingLot.spots.forEach(spot=>{
      parking.push({
        spot, state:'parked', sprite: CAR_TYPES[Math.floor(Math.random() * CAR_TYPES.length)],
        t:0, nextChangeAt: scheduleTurnover(now),
      });
    });
  }
  function stepParking(now, dt){
    parking.forEach(p=>{
      if(p.state==='parked' && now >= p.nextChangeAt){
        p.state='leaving'; p.t=0;
      } else if(p.state==='leaving'){
        p.t += dt/1.1;
        if(p.t>=1){ p.state='empty'; p.t=0; p.emptyUntil = now + rand(600,1800); }
      } else if(p.state==='empty' && now >= (p.emptyUntil||0)){
        p.state='arriving'; p.t=0; p.sprite = CAR_TYPES[Math.floor(Math.random() * CAR_TYPES.length)];
      } else if(p.state==='arriving'){
        p.t += dt/1.1;
        if(p.t>=1){ p.state='parked'; p.t=0; p.nextChangeAt = scheduleTurnover(now); }
      }
    });
  }
  function drawParking(ctx, tr){
    const appr = CFG.parkingLot.approach;
    parking.forEach(p=>{
      let pos, alpha=1;
      if(p.state==='parked'){
        pos = p.spot; alpha=1;
      } else if(p.state==='leaving'){
        pos = { x: p.spot.x + (appr.x-p.spot.x)*p.t, y: p.spot.y + (appr.y-p.spot.y)*p.t };
        alpha = 1-p.t;
      } else if(p.state==='arriving'){
        pos = { x: appr.x + (p.spot.x-appr.x)*p.t, y: appr.y + (p.spot.y-appr.y)*p.t };
        alpha = p.t;
      } else {
        return; // empty — nothing to draw
      }
      const im = img(p.sprite, CFG.assets[p.sprite]);
      const c = toCanvas(pos, tr);
      ctx.save(); ctx.globalAlpha = alpha;
      drawCarSprite(ctx, im, c.x, c.y, CFG.parkingLot.carW*tr.scale, CFG.parkingLot.carH*tr.scale, p.spot.angle);
      ctx.restore();
    });
  }

  // ════════════════════════════════════════════════
  // DECORATIVE CUSTOMERS — entrance -> cafe -> gone.
  // Independent of GS.customers (which the untouched
  // advDay()/spawnCust() logic still drives for sale results).
  // ════════════════════════════════════════════════
  const walkers = [];
  let nextWalkerAt = 0;
  const WALKER_PALETTE = ['#f4c27a','#d4956a','#c68642','#8d5524','#fdbcb4'];
  const WALKER_SHIRTS  = ['#ff6b35','#118ab2','#06d6a0','#9b5de5','#f72585','#4cc9f0'];
  function stepWalkers(now, dt){
    if(now >= nextWalkerAt){
      const cc = CFG.customers;
      walkers.push({ t:0, skin: WALKER_PALETTE[~~(Math.random()*WALKER_PALETTE.length)],
        shirt: WALKER_SHIRTS[~~(Math.random()*WALKER_SHIRTS.length)],
        jitterX: rand(-18,18), jitterY: rand(-14,14) });
      nextWalkerAt = now + rand(cc.spawnEveryMsRange[0], cc.spawnEveryMsRange[1]);
    }
    for(let i=walkers.length-1;i>=0;i--){
      walkers[i].t += dt / CFG.customers.walkSec;
      if(walkers[i].t >= 1) walkers.splice(i,1);
    }
  }
  function drawWalkers(ctx, tr){
    const cc = CFG.customers;
    const sp = cc.sprite || {};
    const sheet = img('walkSheet', CFG.assets.walkSheet);
    walkers.forEach(w=>{
      const bob = Math.sin(w.t*Math.PI*6) * 3;
      const prevT = Math.max(0, w.t - 0.001);
      const px = cc.entrance.x + (cc.cafeSpot.x - cc.entrance.x)*prevT + w.jitterX*Math.sin(prevT*Math.PI);
      const x = cc.entrance.x + (cc.cafeSpot.x - cc.entrance.x)*w.t + w.jitterX*Math.sin(w.t*Math.PI);
      const y = cc.entrance.y + (cc.cafeSpot.y - cc.entrance.y)*w.t + w.jitterY*Math.sin(w.t*Math.PI) + bob*0.2;
      const c = toCanvas({x,y}, tr);
      const alpha = w.t<0.08 ? w.t/0.08 : (w.t>0.92 ? (1-w.t)/0.08 : 1);
      ctx.save();
      ctx.globalAlpha = alpha;

      if(ready(sheet)){
        const frames = sp.frames || 12;
        const fw = sp.frameW || (sheet.naturalWidth / frames);
        const fh = sp.frameH || sheet.naturalHeight;
        // frame index advances with the walk cycle (time-based, loops)
        const fi = ~~(( (performance.now()/1000) * (sp.fps || 14) )) % frames;
        const h = (sp.drawH || 42) * tr.scale;
        const wpx = h * (fw / fh);
        // ground shadow
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(c.x, c.y + h*0.46, wpx*0.32, h*0.06, 0, 0, Math.PI*2); ctx.fill();
        const movingLeft = (x - px) < 0;
        ctx.translate(c.x, c.y);
        if(sp.flipWhenMovingLeft !== false && movingLeft) ctx.scale(-1, 1);
        ctx.drawImage(sheet, fi*fw, 0, fw, fh, -wpx/2, -h*0.5, wpx, h);
      } else {
        // fallback if the sprite sheet hasn't loaded yet
        const s = cc.size * tr.scale;
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(c.x,c.y+s*0.9,s*0.5,s*0.18,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = w.shirt; ctx.beginPath(); ctx.ellipse(c.x,c.y,s*0.32,s*0.42,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = w.skin; ctx.beginPath(); ctx.arc(c.x,c.y-s*0.55,s*0.26,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });
  }

  // ════════════════════════════════════════════════
  // DELIVERY TRUCK — drives the road, turns into the
  // driveway, stops, unloads, leaves. Driven by
  // UI.mode/UI.extTime, which advDay() (untouched)
  // already toggles on every Next Day.
  // ════════════════════════════════════════════════
  let exteriorStartTs = null;
  function drawDelivery(ctx, tr, now){
    if(UI.mode === 'exterior'){
      if(exteriorStartTs === null) exteriorStartTs = now;
      const elapsed = now - exteriorStartTs;
      const D = CFG.delivery;
      const driveMs = D.driveInSec*1000, unloadMs = D.unloadSec*1000;
      const im = img('deliveryTruck', CFG.assets.carA);
      if(elapsed <= driveMs){
        const p = pathPoint(D.path, elapsed/driveMs);
        const c = toCanvas(p, tr);
        drawCarSprite(ctx, im, c.x, c.y, D.truckW*tr.scale, D.truckH*tr.scale, p.ang);
      } else {
        const p = D.path[D.path.length-1];
        const c = toCanvas(p, tr);
        drawCarSprite(ctx, im, c.x, c.y, D.truckW*tr.scale, D.truckH*tr.scale, D.defaultSpriteAngle);
        const unloadT = Math.min(1, (elapsed-driveMs)/unloadMs);
        ctx.save();
        ctx.globalAlpha = 1 - Math.max(0, unloadT-0.6)/0.4;
        ctx.fillStyle='rgba(6,214,160,.92)'; ctx.font='700 11px Figtree,system-ui'; ctx.textAlign='center';
        ctx.fillText(unloadT<1 ? '📦 unloading...' : '✅ delivered', c.x, c.y-30);
        ctx.restore();
        // little crate hopping from truck bed toward the warehouse dock
        if(unloadT>0 && unloadT<1){
          const dock = toCanvas(CFG.warehouse.dock, tr);
          const cx = c.x + (dock.x-c.x)*unloadT, cy = c.y + (dock.y-c.y)*unloadT - Math.sin(unloadT*Math.PI)*14;
          ctx.save(); ctx.fillStyle='#c98a4b'; ctx.fillRect(cx-5,cy-5,10,10); ctx.restore();
        }
      }
    } else {
      exteriorStartTs = null;
    }
  }

  // ════════════════════════════════════════════════
  // "PLACE ORDER" FEEDBACK — boxes move, a truck
  // pulls away from the dock. Purely a cosmetic
  // acknowledgement of the click; the real delivery
  // (above) plays later once the order actually
  // arrives via the untouched day-advance logic.
  // ════════════════════════════════════════════════
  const orderFx = [];
  function onOrderPlaced(pid, qty){
    orderFx.push({ pid, qty, start: performance.now(), sprite: Math.random()<0.5?'carA':'carB' });
  }
  function stepAndDrawOrderFx(ctx, tr, now){
    const total = (CFG.orderLoading.boxMoveSec + CFG.orderLoading.truckDepartSec) * 1000;
    for(let i=orderFx.length-1;i>=0;i--){
      const fx = orderFx[i];
      const el = now - fx.start;
      if(el > total){ orderFx.splice(i,1); continue; }
      const dock = toCanvas(CFG.warehouse.dock, tr);
      if(el < CFG.orderLoading.boxMoveSec*1000){
        const bt = el/(CFG.orderLoading.boxMoveSec*1000);
        for(let b=0;b<3;b++){
          const bb = Math.max(0, Math.min(1, bt*3 - b*0.4));
          if(bb<=0) continue;
          ctx.save(); ctx.globalAlpha = 0.95;
          ctx.fillStyle = '#c98a4b';
          ctx.fillRect(dock.x-14+b*10, dock.y-10*bb, 8, 8);
          ctx.restore();
        }
        ctx.save(); ctx.fillStyle='rgba(232,183,112,.95)'; ctx.font='700 10px Figtree,system-ui'; ctx.textAlign='center';
        ctx.fillText('📦 loading order...', dock.x, dock.y-24);
        ctx.restore();
      } else {
        const dt2 = (el - CFG.orderLoading.boxMoveSec*1000)/(CFG.orderLoading.truckDepartSec*1000);
        const im = img(fx.sprite, fx.sprite==='carA'?CFG.assets.carA:CFG.assets.carB);
        const cx = dock.x + dt2*140, cy = dock.y - dt2*40;
        ctx.save(); ctx.globalAlpha = 1 - dt2*0.7;
        drawCarSprite(ctx, im, cx, cy, 60*tr.scale, 32*tr.scale, -0.5);
        ctx.restore();
      }
    }
  }

  // ════════════════════════════════════════════════
  // INVENTORY — never snaps. Old stack shrinks+fades
  // out while the new stack fades+grows in.
  // ════════════════════════════════════════════════
  const invTween = {};
  function stackCount(units){
    if(units<=0) return 0;
    return Math.min(CFG.stack.maxSprites, Math.max(1, Math.ceil(units/CFG.stack.unitsPerSprite)));
  }

  // ── Cookie storage — static image keyed off the SAME inventory
  //    percentage the Cookies panel already shows (Math.max(0,
  //    Math.min(1, inv/p.maxShelf)), see sim.html's inventory
  //    cards). No separate calculation, no stacking animation. ──
  function cookieImageForPct(pct){
    if(pct<=0) return img('cookie0', CFG.assets.cookie0);
    if(pct<=20) return img('cookie20', CFG.assets.cookie20);
    if(pct<=40) return img('cookie40', CFG.assets.cookie40);
    if(pct<=60) return img('cookie60', CFG.assets.cookie60);
    if(pct<=80) return img('cookie80', CFG.assets.cookie80);
    return img('cookie100', CFG.assets.cookie100);
  }
  // ── Coffee storage — same tiered-image approach as cookie above,
  //    keyed off the same inventory percentage the Coffee panel
  //    already shows. ──
  function coffeeImageForPct(pct){
    if(pct<=0) return img('coffee0', CFG.assets.coffee0);
    if(pct<=20) return img('coffee20', CFG.assets.coffee20);
    if(pct<=40) return img('coffee40', CFG.assets.coffee40);
    if(pct<=60) return img('coffee60', CFG.assets.coffee60);
    if(pct<=80) return img('coffee80', CFG.assets.coffee80);
    return img('coffee100', CFG.assets.coffee100);
  }
  function drawCookieStorage(ctx, x, y, w, h, invUnits, maxShelf){
    const r = Math.max(0, Math.min(1, invUnits/maxShelf));
    const pct = Math.round(r*100);
    const im = cookieImageForPct(pct);
    if(!ready(im)) return;
    // fit the storage image inside the given box without distortion
    const cfg = CFG.warehouse.cookieStorage;
    const s =
        Math.min(w/im.naturalWidth, h/im.naturalHeight)
        * cfg.scale;
    const dw = im.naturalWidth*s, dh = im.naturalHeight*s;
    ctx.drawImage(im, x + (w-dw)/2 + cfg.offsetX, y + (h-dh)/2 + cfg.offsetY, dw, dh);
  }
  function drawCoffeeStorage(ctx, x, y, w, h, invUnits, maxShelf){
    const r = Math.max(0, Math.min(1, invUnits/maxShelf));
    const pct = Math.round(r*100);
    const im = coffeeImageForPct(pct);
    if(!ready(im)) return;
    const cfg = CFG.warehouse.coffeeStorage;
    const s =
        Math.min(w/im.naturalWidth, h/im.naturalHeight)
        * cfg.scale;
    const dw = im.naturalWidth*s, dh = im.naturalHeight*s;
    ctx.drawImage(im, x + (w-dw)/2 + cfg.offsetX, y + (h-dh)/2 + cfg.offsetY, dw, dh);
  }

  function drawInventory(ctx, tr, now){
    const coffee = PRODS.find(p=>p.id==='coffee');
    const cookie = PRODS.find(p=>p.id==='cookie');

    const invCoffee = GS ? GS.inv[coffee.id] : coffee.initInv;
    const invCookie = GS ? GS.inv[cookie.id] : cookie.initInv;

    const rectTL = toCanvas({
      x: CFG.warehouse.rect.x,
      y: CFG.warehouse.rect.y
    }, tr);

    const rectW = CFG.warehouse.rect.w * tr.scale;
    const rectH = CFG.warehouse.rect.h * tr.scale;

    // Both get the full warehouse area.
    // Their config offsets determine their actual positions.
    drawCookieStorage(
      ctx,
      rectTL.x,
      rectTL.y,
      rectW,
      rectH,
      invCookie,
      cookie.maxShelf
    );

    drawCoffeeStorage(
      ctx,
      rectTL.x,
      rectTL.y,
      rectW,
      rectH,
      invCoffee,
      coffee.maxShelf
    );
  }
  function drawOneStack(ctx, pid, im, x, y, w, h, units, now){
    const newCount = stackCount(units);
    let tw = invTween[pid];
    if(!tw){ tw = invTween[pid] = { prevCount:newCount, fromCount:newCount, toCount:newCount, startTs:0 }; }
    if(newCount !== tw.prevCount){
      tw.fromCount = tw.prevCount; tw.toCount = newCount; tw.startTs = now; tw.prevCount = newCount;
    }
    const dur = CFG.inventoryAnim.totalMs;
    const t = tw.startTs ? Math.min(1, (now-tw.startTs)/dur) : 1;
    const minScale = CFG.inventoryAnim.minScale;
    const cx = x+w/2, cy = y+h/2;

    function drawScaled(count, scale, alpha){
      if(alpha<=0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx,cy); ctx.scale(scale,scale); ctx.translate(-cx,-cy);
      drawBoxCluster(ctx, im, x, y, w, h, count*CFG.stack.unitsPerSprite, CFG.stack.unitsPerSprite, CFG.stack.cols);
      ctx.restore();
    }

    if(t>=1){
      drawScaled(tw.toCount, 1, 1);
    } else if(t<0.5){
      drawScaled(tw.fromCount, 1-(1-minScale)*(t/0.5), 1-(t/0.5));
    } else {
      const lt=(t-0.5)/0.5;
      drawScaled(tw.toCount, minScale+(1-minScale)*lt, lt);
    }
  }

  // ════════════════════════════════════════════════
  // SALE/DELIVERY PARTICLES — same "+N" floaters the
  // original engine spawned into GS.particles; we just
  // keep rendering & aging them (visual only).
  // ════════════════════════════════════════════════
  function drawParticles(ctx){
    if(!GS || !GS.particles) return;
    GS.particles.forEach(p=>{
      ctx.save(); ctx.globalAlpha = p.l;
      ctx.font = `bold ${11+(1-p.l)*4}px Figtree,system-ui`; ctx.textAlign='center';
      ctx.fillStyle='rgba(0,0,0,.3)'; ctx.fillText(p.t,p.x+1,p.y+1);
      ctx.fillStyle=p.c; ctx.fillText(p.t,p.x,p.y); ctx.restore();
      p.y += p.vy; p.l -= 0.018;
    });
    GS.particles = GS.particles.filter(p=>p.l>0);
  }

  // ════════════════════════════════════════════════
  // HUD — day progress bar + upcoming-event banner,
  // same info the original canvas HUD showed.
  // ════════════════════════════════════════════════
  function drawHud(ctx, W, H){
    if(!GS) return;
    ctx.fillStyle='rgba(15,10,6,.78)'; ctx.fillRect(0,H-22,W,22);
    ctx.fillStyle='#2a1a10'; ctx.fillRect(8,H-14,W-16,8);
    const pct = Math.max(.02, (GS.day-1)/(GS.maxDay||30));
    const pg = ctx.createLinearGradient(8,0,8+(W-16)*pct,0);
    pg.addColorStop(0,'#d97742'); pg.addColorStop(1,'#e8b770');
    ctx.fillStyle=pg; ctx.fillRect(8,H-14,(W-16)*pct,8);
    ctx.font='600 9px Inter,system-ui'; ctx.fillStyle='#f0e4d0'; ctx.textAlign='left';
    ctx.fillText('Day '+(GS.day-1)+' / '+(GS.maxDay||30), 10, H-17);
    const dl = (GS.maxDay||30)-GS.day+1;
    ctx.textAlign='right'; ctx.fillStyle = dl<=5?'#d96860':'#cdb89a';
    ctx.fillText(dl+'d left', W-10, H-17);
    const allEvts = PRODS.flatMap(p=>(p.events||[]).filter(e=>e.d>=GS.day && e.d<=GS.day+4).map(e=>({...e,pem:p.emoji})));
    if(allEvts.length>0){
      const ne=allEvts[0], inD=ne.d-GS.day+1;
      ctx.fillStyle='rgba(232,183,112,.16)'; ctx.strokeStyle='rgba(232,183,112,.55)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.roundRect(W/2-115,3,230,20,3); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#e8b770'; ctx.font='600 9px Inter,system-ui'; ctx.textAlign='center';
      ctx.fillText(ne.pem+' '+ne.txt.slice(0,35)+'... in '+inD+'d', W/2, 15);
    }
  }

  // ════════════════════════════════════════════════
  // NIGHT/DAY AMBIENT CYCLE — decorative tint since no
  // separate night map art was supplied.
  // ════════════════════════════════════════════════
  function drawNightOverlay(ctx, W, H, now){
    const n = CFG.night;
    const phase = (now % n.cycleMs) / n.cycleMs;
    const alpha = (1 - Math.cos(2*Math.PI*phase)) / 2; // 0 (day) .. 1 (night) .. 0
    if(alpha < 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = n.overlayColor;
    ctx.fillRect(0,0,W,H);
    ctx.restore();
  }

  // ════════════════════════════════════════════════
  // MAIN FRAME
  // ════════════════════════════════════════════════
  let lastTs = 0, started = false;
  function ensureStarted(now){
    if(started) return;
    started = true;
    initTraffic();
    initParking(now);
    nextWalkerAt = now + rand(CFG.customers.spawnEveryMsRange[0], CFG.customers.spawnEveryMsRange[1]);
  }

  function drawFrame(ctx, W, H, now, dt){
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ensureBackground(W, H);
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(bg, 0, 0);

    const tr = bgTr;
    stepTraffic(dt);
    drawTraffic(ctx, tr);

    stepParking(now, dt);
    drawParking(ctx, tr);

    drawInventory(ctx, tr, now);

    stepWalkers(now, dt);
    drawWalkers(ctx, tr);

    drawDelivery(ctx, tr, now);
    stepAndDrawOrderFx(ctx, tr, now);

    drawParticles(ctx);
    drawNightOverlay(ctx, W, H, now);
    drawHud(ctx, W, H);
  }

  // Redefines the global `loop` declared in sim.html's inline
  // script. _launchGame() calls `loop()` unqualified, which — once
  // this script has loaded — resolves to this definition.
  function loop(ts){
    const now = ts || performance.now();
    const dt = lastTs ? Math.min(0.1,(now-lastTs)/1000) : 0;
    lastTs = now;
    ensureStarted(now);

    UI.time++;
    if(UI.mode==='exterior') UI.extTime++; // kept in sync for compatibility

    if(UI.cv && UI.ctx){
        const par = UI.cv.parentElement;

        if (par) {
          const dpr = window.devicePixelRatio || 1;

          const cssW = par.clientWidth;
          const cssH = par.clientHeight;

          const pixelW = Math.round(cssW * dpr);
          const pixelH = Math.round(cssH * dpr);

          if (UI.cv.width !== pixelW || UI.cv.height !== pixelH) {
            UI.cv.width = pixelW;
            UI.cv.height = pixelH;

            UI.cv.style.width = cssW + 'px';
            UI.cv.style.height = cssH + 'px';

            bgW = 0;
          }
        }
      drawFrame(UI.ctx, UI.cv.width, UI.cv.height, now, dt);
    }
    UI.raf = requestAnimationFrame(loop);
  }
  window.loop = loop;

  // ── Wrap (not replace) placeOrder so the original ordering logic
  //    is untouched; we just add a visual acknowledgement after it runs ──
  if(typeof window.placeOrder === 'function' && !window.placeOrder.__animWrapped){
    const _origPlaceOrder = window.placeOrder;
    const wrapped = function(pid){
      const qtyBefore = (window.UI && UI.decs) ? (UI.decs[pid]||0) : 0;
      _origPlaceOrder(pid);
      if(qtyBefore>0) onOrderPlaced(pid, qtyBefore);
    };
    wrapped.__animWrapped = true;
    window.placeOrder = wrapped;
  }
})();
