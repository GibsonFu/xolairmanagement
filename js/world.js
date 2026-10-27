/* Xolair 經營島 — 3D 世界（three.js r128） */
(function () {
  const T = THREE;
  const W = XI.world = {};

  const RING_R = 30;      // 環島步道半徑
  const HUB_R = 10;       // 核心島半徑
  const Y = 1.0;          // 可行走平面高度
  const SPOKES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const ZONE_ANGLE = { daily: Math.PI * 1.25, detailing: Math.PI * 1.75, meal: Math.PI * 0.25, rtd: Math.PI * 0.75 };

  let renderer, scene, camera, container, sky, water, waterBase, sun, hemi, clock;
  let islandGroup, hospGroup, lineGroup, propsGroup;
  const islands = {};            // id -> {group, pos, radius, angle, r, kind, labelEl, people:[]}
  const pickables = [];
  const walkers = [];            // 環島路人
  const windows = [];            // 夜間發光材質
  let rep = null;
  let paused = false, showLines = false, showLabels = true;
  let onPick = () => {};
  let hovered = null;

  /* ---------- 相機控制（旋轉 / 平移 / 縮放，支援觸控） ---------- */
  const cam = { theta: 0.6, phi: 0.95, radius: 125, target: new T.Vector3(0, 0, 0) };
  const goal = { theta: 0.6, phi: 0.95, radius: 125, target: new T.Vector3(0, 0, 0) };
  const LIM = { minR: 14, maxR: 360, minPhi: 0.12, maxPhi: 1.35 };

  function clampGoal() {
    goal.radius = Math.max(LIM.minR, Math.min(LIM.maxR, goal.radius));
    goal.phi = Math.max(LIM.minPhi, Math.min(LIM.maxPhi, goal.phi));
    const m = 110; goal.target.x = Math.max(-m, Math.min(m, goal.target.x)); goal.target.z = Math.max(-m, Math.min(m, goal.target.z));
  }

  function bindControls(el) {
    const ptrs = new Map();
    let mode = null, last = null, pinchD = 0, moved = 0;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (ptrs.size === 1) { mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate'; last = { x: e.clientX, y: e.clientY }; }
      if (ptrs.size === 2) { mode = 'pinch'; const p = [...ptrs.values()]; pinchD = dist(p[0], p[1]); last = mid(p[0], p[1]); }
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) { hoverAt(e); return; }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'pinch' && ptrs.size === 2) {
        const p = [...ptrs.values()]; const d = dist(p[0], p[1]); const m = mid(p[0], p[1]);
        goal.radius *= pinchD / d; pinchD = d;
        panBy(m.x - last.x, m.y - last.y); last = m; moved += 10; clampGoal(); return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'rotate') { goal.theta -= dx * 0.006; goal.phi -= dy * 0.005; }
      else if (mode === 'pan') panBy(dx, dy);
      clampGoal();
    });
    const up = e => {
      if (ptrs.has(e.pointerId) && ptrs.size === 1 && moved < 6 && mode !== 'pinch') clickAt(e);
      ptrs.delete(e.pointerId);
      if (ptrs.size === 1) { mode = 'rotate'; last = [...ptrs.values()][0]; } else if (!ptrs.size) mode = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); mode = null; });
    el.addEventListener('wheel', e => { e.preventDefault(); goal.radius *= Math.exp(e.deltaY * 0.0012); clampGoal(); }, { passive: false });
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function panBy(dx, dy) {
    const s = goal.radius * 0.0016;
    const fx = -Math.sin(goal.theta), fz = -Math.cos(goal.theta);   // 前方
    const rx = Math.cos(goal.theta), rz = -Math.sin(goal.theta);    // 右方
    goal.target.x += -dx * rx * s + dy * fx * s;
    goal.target.z += -dx * rz * s + dy * fz * s;
  }

  W.zoom = f => { goal.radius *= f; clampGoal(); };
  W.home = () => { goal.theta = 0.6; goal.phi = 0.95; const far = Object.values(islands).reduce((m, i) => Math.max(m, i.r + i.radius), 40);
    const asp = camera ? camera.aspect : 1.5; goal.radius = far * 2.3 / Math.min(1, Math.max(0.62, asp / 1.25)); goal.target.set(0, 0, 0); };
  W.birdsEye = on => { goal.phi = on ? 0.14 : 0.95; if (on) goal.radius = Math.max(goal.radius, 130); };
  W.flyTo = (id) => {
    const isl = islands[id]; if (!isl) return;
    goal.target.set(isl.pos.x, 0, isl.pos.z);
    goal.radius = Math.max(36, isl.radius * 5.2);
    goal.phi = 0.85;
  };
  W.isMobile = () => window.innerWidth < 860;

  /* ---------- 點選 ---------- */
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  function pickAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, true)[0];
    if (!hit) return null;
    let o = hit.object; while (o && !o.userData.islandId) o = o.parent;
    return o ? o.userData.islandId : null;
  }
  function clickAt(e) { const id = pickAt(e); if (id) onPick(id); }
  function hoverAt(e) {
    const id = pickAt(e);
    if (id !== hovered) { hovered = id; renderer.domElement.style.cursor = id ? 'pointer' : 'grab'; }
  }

  /* ---------- 材質工具 ---------- */
  const matCache = {};
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache[key]) matCache[key] = new T.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0 }, opts));
    return matCache[key];
  }
  function mesh(geo, m, cast = true, recv = true) { const o = new T.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = recv; return o; }
  function rnd(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; }
  function hash(str) { let h = 7; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h || 1; }

  function windowTexture(cols, rows, lit) {
    const c = document.createElement('canvas'); c.width = 64 * cols; c.height = 64 * rows;
    const g = c.getContext('2d');
    g.fillStyle = lit ? '#000' : '#f4efe6'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      g.fillStyle = lit ? (Math.random() > 0.35 ? '#ffd27a' : '#000') : '#7fb3c8';
      g.fillRect(i * 64 + 14, j * 64 + 16, 36, 30);
    }
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  /* ---------- 島嶼與地景 ---------- */
  function makeIsland(radius, grass, seed) {
    const g = new T.Group(); const R = rnd(seed);
    const seg = 9 + Math.floor(R() * 4);
    const top = mesh(new T.CylinderGeometry(radius, radius * 1.02, 0.9, seg), mat(grass));
    top.position.y = Y - 0.45; top.rotation.y = R() * 6; g.add(top);
    const sand = mesh(new T.CylinderGeometry(radius * 1.12, radius * 1.2, 0.8, seg), mat('#e9d7ae'));
    sand.position.y = 0.05; sand.rotation.y = top.rotation.y; g.add(sand);
    const rock = mesh(new T.CylinderGeometry(radius * 1.2, radius * 0.7, 2.6, seg), mat('#9c8f7c'), false);
    rock.position.y = -1.6; g.add(rock);
    // 邊緣石頭
    for (let i = 0; i < 4 + radius / 2; i++) {
      const a = R() * Math.PI * 2, s = 0.4 + R() * 0.7;
      const st = mesh(new T.DodecahedronGeometry(s, 0), mat('#a89c88'));
      st.position.set(Math.cos(a) * radius * 1.15, 0.2, Math.sin(a) * radius * 1.15); st.rotation.set(R(), R(), R()); g.add(st);
    }
    return g;
  }
  function tree(x, z, s = 1, R = Math.random) {
    const g = new T.Group();
    const trunk = mesh(new T.CylinderGeometry(0.12 * s, 0.18 * s, 1 * s, 5), mat('#8a6a4a')); trunk.position.y = 0.5 * s; g.add(trunk);
    const greens = ['#5f9e5a', '#76b267', '#4f8a57', '#8cbf6a'];
    if (R() > 0.5) {
      const c = mesh(new T.ConeGeometry(0.75 * s, 1.8 * s, 6), mat(greens[Math.floor(R() * 4)])); c.position.y = 1.7 * s; g.add(c);
    } else {
      const c = mesh(new T.IcosahedronGeometry(0.8 * s, 0), mat(greens[Math.floor(R() * 4)])); c.position.y = 1.6 * s; g.add(c);
    }
    g.position.set(x, Y, z); return g;
  }
  function box(w, h, d, color, x, y, z, parent) { const b = mesh(new T.BoxGeometry(w, h, d), mat(color)); b.position.set(x, y, z); parent && parent.add(b); return b; }

  function building(w, h, d, wall, roof, floors, parent, x = 0, z = 0) {
    const g = new T.Group();
    const tex = windowTexture(Math.max(2, Math.round(w)), floors, false);
    const lit = windowTexture(Math.max(2, Math.round(w)), floors, true);
    const side = new T.MeshStandardMaterial({ color: wall, map: tex, emissiveMap: lit, emissive: new T.Color('#000'), flatShading: true, roughness: 0.9 });
    windows.push(side);
    const plain = mat(wall);
    const b = mesh(new T.BoxGeometry(w, h, d), [side, side, plain, plain, side, side]);
    b.position.y = Y + h / 2; g.add(b);
    const r = mesh(new T.BoxGeometry(w + 0.3, 0.3, d + 0.3), mat(roof)); r.position.y = Y + h + 0.15; g.add(r);
    g.position.set(x, 0, z); parent.add(g); return g;
  }

  function hospitalBuilding(tier, parent, R) {
    const tiers = { '醫學中心': [6, 7.5, 4, 5], '區域醫院': [5, 5.5, 3.5, 4], '地區醫院': [4, 3.8, 3, 3], '診所': [3, 2.4, 2.6, 2] };
    const [w, h, d, fl] = tiers[tier] || tiers['地區醫院'];
    building(w, h, d, '#f7f3ea', '#d8d1c4', fl, parent);
    if (tier === '醫學中心') building(3, h * 0.65, 3, '#eef1f2', '#c9d2d4', Math.max(2, fl - 2), parent, w / 2 + 1.4, 0.4);
    // 紅十字
    const cross = new T.Group();
    box(0.5, 1.6, 0.25, '#d94a3d', 0, 0, 0, cross); box(1.6, 0.5, 0.25, '#d94a3d', 0, 0, 0, cross);
    cross.position.set(0, Y + h + 1.3, d / 2 - 0.4); parent.add(cross);
    const pole = box(0.12, 0.8, 0.12, '#888', 0, Y + h + 0.5, d / 2 - 0.4, parent);
    // 救護車
    const amb = new T.Group(); box(1.6, 0.8, 0.9, '#ffffff', 0, Y + 0.55, 0, amb); box(0.5, 0.25, 0.92, '#d94a3d', 0.2, Y + 0.65, 0, amb);
    amb.position.set(-w / 2 - 1.5, 0, d / 2 + 0.8); amb.rotation.y = R() * 0.6; parent.add(amb);
    return h;
  }

  function buildZoneProps(id, g, R) {
    if (id === 'core') {
      // 核心塔：堆疊圓柱 + 光環
      const base = mesh(new T.CylinderGeometry(3.2, 3.6, 1, 8), mat('#e9e2d3')); base.position.y = Y + 0.5; g.add(base);
      const tw = mesh(new T.CylinderGeometry(1.3, 1.7, 9, 8), mat('#1f6f78')); tw.position.y = Y + 5.5; g.add(tw);
      const cap = mesh(new T.ConeGeometry(1.5, 2.2, 8), mat('#f2c14e')); cap.position.y = Y + 11.1; g.add(cap);
      const ring = mesh(new T.TorusGeometry(2.6, 0.18, 6, 24), mat('#f2c14e', { emissive: '#7a5a10', emissiveIntensity: 0.4 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = Y + 7; ring.userData.spin = 0.6; g.add(ring);
      const ring2 = ring.clone(); ring2.scale.setScalar(0.75); ring2.position.y = Y + 4.5; ring2.userData.spin = -0.9; g.add(ring2);
      // 廣場長椅與花圃
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; box(1.6, 0.35, 0.5, '#b07a4a', Math.cos(a) * 6, Y + 0.3, Math.sin(a) * 6, g).rotation.y = -a + Math.PI / 2; }
      for (let i = 0; i < 7; i++) { const a = R() * 6.28, r = 7.5 + R(); g.add(tree(Math.cos(a) * r, Math.sin(a) * r, 0.9, R)); }
    }
    if (id === 'daily') {
      building(4, 3.2, 3.2, '#f3e3cc', '#c86f4b', 2, g, -1.5, -1);
      const roof = mesh(new T.ConeGeometry(3.2, 1.8, 4), mat('#c86f4b')); roof.position.set(-1.5, Y + 4.4, -1); roof.rotation.y = Math.PI / 4; g.add(roof);
      // 業務車
      const car = new T.Group(); box(2.4, 0.8, 1.2, '#1f6f78', 0, Y + 0.6, 0, car); box(1.3, 0.6, 1.1, '#bfe0e4', -0.1, Y + 1.25, 0, car);
      [[-0.8, 0.6], [0.8, 0.6], [-0.8, -0.6], [0.8, -0.6]].forEach(([x, z]) => { const wh = mesh(new T.CylinderGeometry(0.28, 0.28, 0.2, 8), mat('#333')); wh.rotation.x = Math.PI / 2; wh.position.set(x, Y + 0.28, z); car.add(wh); });
      car.position.set(3, 0, 1.5); car.rotation.y = -0.5; g.add(car);
      // 咖啡車
      const cart = new T.Group(); box(1.4, 1, 0.9, '#f2c14e', 0, Y + 0.5, 0, cart); box(1.6, 0.12, 1.1, '#d9822b', 0, Y + 1.7, 0, cart); box(0.08, 0.7, 0.08, '#555', 0, Y + 1.3, 0, cart);
      cart.position.set(1.5, 0, -3.2); g.add(cart);
      for (let i = 0; i < 4; i++) { const a = R() * 6.28; g.add(tree(Math.cos(a) * 5.2, Math.sin(a) * 5.2, 0.8, R)); }
    }
    if (id === 'detailing') {
      building(4.5, 3, 3, '#e8f0f7', '#3b82c4', 2, g, 0, -1.4);
      // 大型平板看板
      const pad = new T.Group(); box(3, 2, 0.2, '#22303c', 0, 0, 0, pad); box(2.6, 1.6, 0.05, '#7fc0ef', 0, 0, 0.12, pad);
      pad.position.set(0.5, Y + 2, 2.6); g.add(pad); box(0.15, 1.2, 0.15, '#555', 0.5, Y + 0.6, 2.5, g);
      // 對話桌
      const tb = mesh(new T.CylinderGeometry(0.8, 0.8, 0.12, 10), mat('#fff')); tb.position.set(-2.5, Y + 0.8, 2); g.add(tb); box(0.15, 0.8, 0.15, '#777', -2.5, Y + 0.4, 2, g);
      for (let i = 0; i < 3; i++) { const a = R() * 6.28; g.add(tree(Math.cos(a) * 5, Math.sin(a) * 5, 0.75, R)); }
    }
    if (id === 'meal') {
      building(4, 2.6, 3, '#fbe9dc', '#c2593f', 1, g, -1, -1.8);
      for (let i = 0; i < 3; i++) {
        const x = -2.5 + i * 2.5, z = 2;
        const tb = mesh(new T.CylinderGeometry(0.7, 0.7, 0.1, 10), mat('#fff')); tb.position.set(x, Y + 0.75, z); g.add(tb); box(0.12, 0.75, 0.12, '#777', x, Y + 0.37, z, g);
        const um = mesh(new T.ConeGeometry(1.3, 0.6, 8), mat(i % 2 ? '#f2c14e' : '#c2593f')); um.position.set(x, Y + 2.4, z); g.add(um); box(0.08, 2.1, 0.08, '#666', x, Y + 1.2, z, g);
      }
      for (let i = 0; i < 3; i++) { const a = R() * 6.28; g.add(tree(Math.cos(a) * 5.2, Math.sin(a) * 5.2, 0.75, R)); }
    }
    if (id === 'rtd') {
      // 涼亭 + 圓桌
      const roof = mesh(new T.ConeGeometry(4, 1.8, 8), mat('#7a5bb5')); roof.position.y = Y + 4.2; g.add(roof);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(0.2, 3.3, 0.2, '#e9e2d3', Math.cos(a) * 3.4, Y + 1.65, Math.sin(a) * 3.4, g); }
      const tb = mesh(new T.CylinderGeometry(1.6, 1.6, 0.15, 16), mat('#b07a4a')); tb.position.y = Y + 0.85; g.add(tb);
      box(0.3, 0.85, 0.3, '#7a5a3a', 0, Y + 0.42, 0, g);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(0.5, 0.5, 0.5, '#e9e2d3', Math.cos(a) * 2.3, Y + 0.25, Math.sin(a) * 2.3, g); }
      for (let i = 0; i < 4; i++) { const a = R() * 6.28; g.add(tree(Math.cos(a) * 5.4, Math.sin(a) * 5.4, 0.75, R)); }
    }
  }

  /* ---------- 小人 ---------- */
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68e65', '#f5d6bd'];
  const HAIR = ['#2b2320', '#4a3426', '#1a1a1a', '#7a5332', '#5b5b5b'];
  function makePerson(opt = {}) {
    const R = rnd(opt.seed || Math.floor(Math.random() * 1e6));
    const g = new T.Group();
    const shirt = opt.shirt || ['#4b7bb5', '#d9822b', '#5f9e5a', '#a35d8a', '#e0b84a'][Math.floor(R() * 5)];
    const pants = opt.pants || ['#2f3b4c', '#4a4038', '#38506a'][Math.floor(R() * 3)];
    const legL = box(0.22, 0.6, 0.24, pants, -0.14, 0.3, 0); const legR = box(0.22, 0.6, 0.24, pants, 0.14, 0.3, 0);
    [legL, legR].forEach(l => { l.geometry.translate(0, -0.3, 0); l.position.y = 0.6; g.add(l); });
    const body = mesh(new T.CylinderGeometry(0.3, 0.34, 0.75, 7), mat(opt.coat ? '#ffffff' : shirt)); body.position.y = 0.98; g.add(body);
    if (opt.coat) { const t = box(0.2, 0.5, 0.05, shirt, 0, 1.0, 0.31); g.add(t); }
    const armL = box(0.14, 0.6, 0.16, opt.coat ? '#ffffff' : shirt, -0.42, 0, 0); const armR = armL.clone(); armR.position.x = 0.42;
    [armL, armR].forEach(a => { a.geometry = a.geometry.clone(); a.geometry.translate(0, -0.28, 0); a.position.y = 1.3; g.add(a); });
    const head = mesh(new T.IcosahedronGeometry(0.32, 1), mat(SKIN[Math.floor(R() * 4)])); head.position.y = 1.62; g.add(head);
    const hair = mesh(new T.SphereGeometry(0.34, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(opt.hair || HAIR[Math.floor(R() * 5)])); hair.position.y = 1.66; hair.rotation.x = -0.25; g.add(hair);
    if (opt.bag) { box(0.12, 0.45, 0.55, '#3a2f28', 0.42, 0.95, 0, g); }
    g.userData.limbs = { legL, legR, armL, armR };
    g.scale.setScalar(opt.scale || 1);
    return g;
  }
  function animateLimbs(p, t, moving) {
    const L = p.userData.limbs; const s = moving ? Math.sin(t * 10) * 0.6 : 0;
    L.legL.rotation.x = s; L.legR.rotation.x = -s; L.armL.rotation.x = -s * 0.8; L.armR.rotation.x = s * 0.8;
  }

  /* ---------- 路徑 ---------- */
  const polar = (a, r) => new T.Vector3(Math.cos(a) * r, Y, Math.sin(a) * r);
  function angleOf(v) { return Math.atan2(v.z, v.x); }
  function nearestSpoke(a) { let best = SPOKES[0], bd = 9; for (const s of SPOKES) { const d = Math.abs(angDiff(a, s)); if (d < bd) { bd = d; best = s; } } return best; }
  function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  function arcPoints(a1, a2, r) {
    const d = angDiff(a1, a2), n = Math.max(1, Math.ceil(Math.abs(d) / 0.12)); const pts = [];
    for (let i = 1; i <= n; i++) pts.push(polar(a1 + d * i / n, r)); return pts;
  }
  // 從目前位置走到某島（經由環島步道）
  function routeTo(from, id) {
    const to = islands[id]; const pts = [];
    const fr = Math.hypot(from.x, from.z); let fa = angleOf(from);
    const toCore = id === 'core';
    let ta = toCore ? nearestSpoke(fa) : to.angle;
    if (fr < HUB_R + 2) {               // 從核心島出發
      const s = toCore ? fa : nearestSpoke(to.angle);
      if (toCore) { pts.push(polar(fa, 2.5)); return pts; }
      pts.push(polar(s, HUB_R - 1)); pts.push(polar(s, RING_R)); fa = s;
    } else if (Math.abs(fr - RING_R) > 1.5) {
      pts.push(polar(fa, RING_R));       // 先走回環島步道
    }
    pts.push(...arcPoints(fa, ta, RING_R));
    if (toCore) { pts.push(polar(ta, HUB_R - 1)); pts.push(polar(ta, 2.5)); }
    else {
      const end = to.r === RING_R ? polar(ta, RING_R) : polar(ta, to.r - to.radius * 0.35);
      if (to.r !== RING_R) pts.push(polar(ta, to.r - to.radius - 0.5));
      pts.push(end);
    }
    return pts;
  }

  /* ---------- 建立場景 ---------- */
  W.init = function (el, pickCb) {
    container = el; onPick = pickCb;
    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = 'grab';
    scene = new T.Scene();
    scene.fog = new T.Fog('#cfe6ea', 160, 420);
    camera = new T.PerspectiveCamera(38, 1, 1, 1200);
    clock = new T.Clock();

    // 天空漸層
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { top: { value: new T.Color('#8fc9e8') }, bottom: { value: new T.Color('#f3eee2') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.1,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0);}'
    });
    sky = new T.Mesh(new T.SphereGeometry(600, 24, 12), skyMat); scene.add(sky);

    hemi = new T.HemisphereLight('#ffffff', '#8a9a7a', 0.65); scene.add(hemi);
    sun = new T.DirectionalLight('#fff4e0', 0.95);
    sun.position.set(60, 90, 40); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.far = 300;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    // 海
    const wg = new T.PlaneGeometry(900, 900, 90, 90); wg.rotateX(-Math.PI / 2);
    waterBase = wg.attributes.position.array.slice();
    water = mesh(wg, new T.MeshStandardMaterial({ color: '#3fa4b8', flatShading: true, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.94 }), false, true);
    water.position.y = -0.2; scene.add(water);
    const shallow = mesh(new T.CircleGeometry(115, 48), new T.MeshStandardMaterial({ color: '#7fd0d6', roughness: 1 }), false, false);
    shallow.rotation.x = -Math.PI / 2; shallow.position.y = -0.9; scene.add(shallow);

    // 遠山
    const RR = rnd(42);
    for (let i = 0; i < 46; i++) {
      const a = i / 46 * Math.PI * 2 + RR() * 0.1, r = 230 + RR() * 60, h = 25 + RR() * 45;
      const m = mesh(new T.ConeGeometry(18 + RR() * 22, h, 6), mat(['#8fb38a', '#7aa37c', '#9cbf91'][i % 3]), false, false);
      m.position.set(Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r); m.rotation.y = RR() * 6; scene.add(m);
    }
    // 雲
    W.clouds = [];
    for (let i = 0; i < 12; i++) {
      const c = new T.Group(); const n = 3 + Math.floor(RR() * 3);
      for (let j = 0; j < n; j++) { const s = mesh(new T.IcosahedronGeometry(3 + RR() * 3, 0), mat('#ffffff', { roughness: 1 }), false, false); s.position.set(j * 4 - n * 2, RR() * 2, RR() * 3); c.add(s); }
      c.position.set((RR() - 0.5) * 360, 45 + RR() * 25, (RR() - 0.5) * 360); scene.add(c); W.clouds.push(c);
    }

    islandGroup = new T.Group(); hospGroup = new T.Group(); lineGroup = new T.Group(); propsGroup = new T.Group();
    scene.add(islandGroup, hospGroup, lineGroup, propsGroup);
    lineGroup.visible = false;

    buildPaths();
    // 固定島
    addIsland('core', 0, 0, HUB_R, '#86b96d', 'zone');
    for (const z of XI.ZONES) if (z.id !== 'core') addIsland(z.id, ZONE_ANGLE[z.id], RING_R, 7.2, '#8cbf6a', 'zone');

    // 環島路人
    for (let i = 0; i < 9; i++) {
      const p = makePerson({ seed: 100 + i, scale: 0.9 });
      const a = Math.random() * 6.28; p.position.copy(polar(a, RING_R));
      p.userData.walk = { a, dir: Math.random() > 0.5 ? 1 : -1, speed: 0.025 + Math.random() * 0.02 };
      propsGroup.add(p); walkers.push(p);
    }
    // 小船
    W.boats = [];
    for (let i = 0; i < 3; i++) {
      const b = new T.Group(); box(2.4, 0.5, 1, '#f4efe6', 0, 0, 0, b); box(0.1, 2.4, 0.1, '#7a5a3a', 0, 1.2, 0, b);
      const sail = mesh(new T.ConeGeometry(0.9, 2, 3), mat(['#f2c14e', '#c2593f', '#ffffff'][i])); sail.position.set(0.3, 1.5, 0); b.add(sail);
      b.userData.a = i * 2.1; b.userData.r = 96 + i * 7; scene.add(b); W.boats.push(b);
    }

    // 業務本人
    rep = makePerson({ shirt: '#1f6f78', pants: '#22303c', bag: true, seed: 7, scale: 1.25 });
    rep.position.copy(islands.daily.pos).add(new T.Vector3(0, 0, 0));
    rep.userData.path = []; rep.userData.at = 'daily';
    scene.add(rep);
    const ringMark = mesh(new T.RingGeometry(0.7, 0.95, 24), new T.MeshBasicMaterial({ color: '#d9822b', transparent: true, opacity: 0.8, side: T.DoubleSide }), false, false);
    ringMark.rotation.x = -Math.PI / 2; ringMark.position.y = 0.05; rep.add(ringMark);

    bindControls(renderer.domElement);
    window.addEventListener('resize', resize); resize();
    W.home();
    cam.radius = 260; cam.phi = 0.5;   // 開場拉近效果
    loop();
  };

  function buildPaths() {
    // 環島步道（木棧道）
    const ring = mesh(new T.RingGeometry(RING_R - 1.3, RING_R + 1.3, 96), mat('#c9a77a', { side: T.DoubleSide }), false, true);
    ring.rotation.x = -Math.PI / 2; ring.position.y = Y - 0.05; islandGroup.add(ring);
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      [RING_R - 1.3, RING_R + 1.3].forEach(r => { const p = mesh(new T.CylinderGeometry(0.15, 0.15, 2.2, 5), mat('#7a5a3a'), false); p.position.set(Math.cos(a) * r, -0.1, Math.sin(a) * r); islandGroup.add(p); });
    }
    SPOKES.forEach(a => bridge(a, HUB_R - 0.5, RING_R - 1.2, islandGroup));
  }
  function bridge(a, r1, r2, parent) {
    const len = r2 - r1; const g = new T.Group();
    const deck = mesh(new T.BoxGeometry(len, 0.25, 2.2), mat('#c9a77a')); deck.position.set(len / 2, Y - 0.12, 0); g.add(deck);
    for (let x = 0; x <= len; x += 2.5) {
      [-1.1, 1.1].forEach(z => { box(0.14, 0.8, 0.14, '#7a5a3a', x, Y + 0.3, z, g); const p = mesh(new T.CylinderGeometry(0.14, 0.14, 2.2, 5), mat('#7a5a3a'), false); p.position.set(x, -0.1, z); g.add(p); });
    }
    [-1.1, 1.1].forEach(z => box(len, 0.1, 0.1, '#7a5a3a', len / 2, Y + 0.7, z, g));
    g.rotation.y = -a; g.position.set(Math.cos(a) * r1, 0, Math.sin(a) * r1);
    parent.add(g); return g;
  }

  function addIsland(id, angle, r, radius, grass, kind, extra = {}) {
    const pos = r === 0 ? new T.Vector3(0, 0, 0) : polar(angle, r).setY(0);
    const seed = hash(id + (extra.name || ''));
    const g = makeIsland(radius, grass, seed);
    g.position.copy(pos); g.userData.islandId = id;
    const R = rnd(seed + 3);
    if (kind === 'zone') buildZoneProps(id, g, R);
    (kind === 'hospital' ? hospGroup : islandGroup).add(g);
    pickables.push(g);
    islands[id] = { id, group: g, pos, radius, angle, r, kind, people: [], name: extra.name };
    return islands[id];
  }

  /* ---------- 醫院島（依名單產生） ---------- */
  // 固定槽位：每家醫院依加入順序取得固定位置，新增醫院不會打亂原本的島
  const RING_CAP = [12, 18, 24, 30, 36];
  function slotOf(k) {
    let ri = 0; while (ri < RING_CAP.length - 1 && k >= RING_CAP[ri]) { k -= RING_CAP[ri]; ri++; }
    const cap = RING_CAP[ri], used = new Set();
    let s = 0;
    for (let i = 0; i <= k; i++) { s = Math.floor(((i * 0.6180339887) % 1) * cap); while (used.has(s)) s = (s + 1) % cap; used.add(s); }
    const off = ri % 2 ? Math.PI / cap : 0.12;
    return { r: 52 + ri * 20, a: off + s / cap * Math.PI * 2 };
  }

  W.setHospitals = function (hospitals, growId) {
    // 清除舊的
    for (const id of Object.keys(islands)) if (islands[id].kind === 'hospital') {
      const i = pickables.indexOf(islands[id].group); if (i >= 0) pickables.splice(i, 1);
      delete islands[id];
    }
    while (hospGroup.children.length) hospGroup.remove(hospGroup.children[0]);

    if (!hospitals.length) { W.updateLines([]); return; }
    hospitals.forEach((h, k) => {
      {
        const { r, a } = slotOf(k);
        const radius = { '醫學中心': 7.5, '區域醫院': 6.4, '地區醫院': 5.4, '診所': 4.4 }[h.tier] || 5.4;
        const isl = addIsland(h.id, a, r, radius, ['#8cbf6a', '#9cc77a', '#7fb46a'][k % 3], 'hospital', { name: h.name });
        const R = rnd(hash(h.id) + 11);
        const hh = hospitalBuilding(h.tier, isl.group, R);
        isl.group.children.forEach(c => { if (c.type === 'Group') c.rotation.y = 0; });
        // 建築朝向中心
        isl.group.rotation.y = -a - Math.PI / 2;
        isl.topY = hh;
        for (let t = 0; t < 3; t++) { const ta = R() * 6.28, tr = radius * (0.72 + R() * 0.15); isl.group.add(tree(Math.cos(ta) * tr, Math.sin(ta) * tr, 0.7, R)); }
        // 醫師小人
        h.doctors.slice(0, 4).forEach((d, di) => {
          const p = makePerson({ coat: true, seed: hash(d.id), shirt: { A: '#d94a3d', B: '#e0a030', C: '#5f9e5a' }[d.level] || '#4b7bb5', scale: 0.95 });
          const pa = R() * 6.28; p.userData.home = { a: pa, r: radius * 0.6, speed: 0.15 + R() * 0.2 };
          p.position.set(Math.cos(pa) * radius * 0.6, Y, Math.sin(pa) * radius * 0.6);
          isl.group.add(p); isl.people.push(p);
        });
        const br = bridge(a, RING_R + 1.2, r - radius * 1.05, hospGroup);
        if (h.id === growId) { isl.grow = 0; isl.group.scale.setScalar(0.01); br.scale.set(0.01, 1, 1); isl.bridge = br; }
      }
    });
  };

  /* ---------- 協作線 ---------- */
  W.updateLines = function (links) {
    while (lineGroup.children.length) lineGroup.remove(lineGroup.children[0]);
    links.forEach(l => {
      const a = islands[l.from], b = islands[l.to]; if (!a || !b) return;
      const p1 = a.pos.clone().setY(3), p2 = b.pos.clone().setY(3);
      const m = p1.clone().add(p2).multiplyScalar(0.5); m.y = 10 + p1.distanceTo(p2) * 0.18;
      const curve = new T.QuadraticBezierCurve3(p1, m, p2);
      const geo = new T.TubeGeometry(curve, 32, 0.12 + Math.min(l.weight, 8) * 0.05, 5, false);
      const ln = new T.Mesh(geo, new T.MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0.75 }));
      lineGroup.add(ln);
    });
  };

  /* ---------- 環境設定 ---------- */
  const TIMES = {
    dawn:  { top: '#f2b9a0', bottom: '#fbe6cf', fog: '#f4d9c4', sun: '#ffc9a0', si: 0.7, hemi: 0.55, sp: [-80, 30, 40], water: '#5aa8b8', glow: 0.3 },
    day:   { top: '#8fc9e8', bottom: '#f3eee2', fog: '#cfe6ea', sun: '#fff4e0', si: 0.95, hemi: 0.65, sp: [60, 90, 40], water: '#3fa4b8', glow: 0 },
    dusk:  { top: '#6b6fb2', bottom: '#f4a47a', fog: '#d7a58f', sun: '#ff9a5c', si: 0.65, hemi: 0.45, sp: [80, 25, -40], water: '#3c7d98', glow: 0.6 },
    night: { top: '#0e1a33', bottom: '#2b3a5c', fog: '#1c2944', sun: '#9fb3ff', si: 0.25, hemi: 0.25, sp: [-40, 80, -60], water: '#1d4660', glow: 1.0 }
  };
  W.setTime = function (key) {
    const t = TIMES[key] || TIMES.day;
    sky.material.uniforms.top.value.set(t.top); sky.material.uniforms.bottom.value.set(t.bottom);
    scene.fog.color.set(t.fog); sun.color.set(t.sun); sun.intensity = t.si; hemi.intensity = t.hemi;
    sun.position.set(...t.sp); water.material.color.set(t.water);
    windows.forEach(m => { m.emissive.set(t.glow ? '#ffffff' : '#000000'); m.emissiveIntensity = t.glow; });
    W._glow = t.glow;
  };

  let follow = false;
  W.setFollow = v => { follow = v; if (v) goal.radius = Math.min(goal.radius, 55); };
  W.setPaused = v => { paused = v; };
  W.setLines = v => { showLines = v; lineGroup.visible = v; };
  W.setLabels = v => { showLabels = v; };
  W.islandIds = () => Object.keys(islands);

  /* ---------- 業務小人移動 ---------- */
  W.walkRepTo = function (id) {
    if (!islands[id] || rep.userData.at === id && !rep.userData.path.length) return;
    const from = rep.position.clone();
    rep.userData.path = routeTo(from, id);
    rep.userData.at = id;
  };
  W.repColor = c => { rep.children.forEach(ch => { if (ch.geometry && ch.geometry.type === 'CylinderGeometry' && ch.position.y > 0.9 && ch.position.y < 1.1) ch.material = mat(c); }); rep.userData.limbs.armL.material = mat(c); rep.userData.limbs.armR.material = mat(c); };
  W.repAt = () => rep.userData.at;

  // 活動完成時，島上冒出的圖示
  const pops = [];
  W.pop = function (id, emoji) {
    const isl = islands[id]; if (!isl) return;
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#fffaf2'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill(); g.font = '68px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 64, 70);
    const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true }));
    s.position.copy(isl.pos).setY(8); s.scale.setScalar(4); scene.add(s); pops.push({ s, t: 0 });
  };

  /* ---------- 標籤投影 ---------- */
  const v3 = new T.Vector3();
  W.project = function (id, yOff = 0) {
    const isl = islands[id]; if (!isl) return null;
    v3.copy(isl.pos); v3.y = (isl.topY || (isl.kind === 'zone' ? (id === 'core' ? 13 : 5) : 5)) + 2.5 + yOff;
    v3.project(camera);
    if (v3.z > 1) return null;
    const r = renderer.domElement.getBoundingClientRect();
    return { x: (v3.x + 1) / 2 * r.width, y: (1 - v3.y) / 2 * r.height, d: camera.position.distanceTo(isl.pos) };
  };
  W.projectRep = function () {
    v3.copy(rep.position); v3.y += 3.1; v3.project(camera);
    if (v3.z > 1) return null;
    const r = renderer.domElement.getBoundingClientRect();
    return { x: (v3.x + 1) / 2 * r.width, y: (1 - v3.y) / 2 * r.height };
  };
  W.labelsOn = () => showLabels;
  W.camRadius = () => cam.radius;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  W.resize = resize;

  /* ---------- 主迴圈 ---------- */
  let tAcc = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const k = 1 - Math.pow(0.002, dt);
    cam.theta += (goal.theta - cam.theta) * k; cam.phi += (goal.phi - cam.phi) * k;
    cam.radius += (goal.radius - cam.radius) * k; cam.target.lerp(goal.target, k);
    if (follow && rep) { goal.target.set(rep.position.x, 0, rep.position.z); }
    camera.position.set(
      cam.target.x + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
      cam.target.y + cam.radius * Math.cos(cam.phi),
      cam.target.z + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(cam.target);

    if (!paused) {
      tAcc += dt;
      // 海浪
      const p = water.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = waterBase[i * 3], z = waterBase[i * 3 + 2];
        p.array[i * 3 + 1] = Math.sin(x * 0.08 + tAcc * 1.2) * 0.35 + Math.cos(z * 0.07 + tAcc * 0.9) * 0.35;
      }
      p.needsUpdate = true; water.geometry.computeVertexNormals();
      W.clouds.forEach((c, i) => { c.position.x += dt * (1.5 + i % 3); if (c.position.x > 220) c.position.x = -220; });
      W.boats.forEach(b => { b.userData.a += dt * 0.03; const a = b.userData.a; b.position.set(Math.cos(a) * b.userData.r, Math.sin(tAcc * 2 + a) * 0.15, Math.sin(a) * b.userData.r); b.rotation.y = -a; });
      islandGroup.traverse(o => { if (o.userData.spin) o.rotation.z += dt * o.userData.spin; });
      // 路人
      walkers.forEach(w => {
        const u = w.userData.walk; u.a += u.dir * u.speed * dt * 6 / RING_R * 6;
        const off = (u.dir > 0 ? 0.6 : -0.6);
        w.position.copy(polar(u.a, RING_R + off)); w.rotation.y = -u.a - (u.dir > 0 ? 0 : Math.PI);
        animateLimbs(w, tAcc + u.a * 3, true);
      });
      // 醫師小人在島上踱步
      Object.values(islands).forEach(isl => isl.people.forEach(pp => {
        const h = pp.userData.home; h.a += dt * h.speed;
        pp.position.set(Math.cos(h.a) * h.r, Y, Math.sin(h.a) * h.r); pp.rotation.y = -h.a + Math.PI;
        animateLimbs(pp, tAcc * 0.7 + h.a, true);
      }));
      // 業務
      const path = rep.userData.path;
      if (path.length) {
        const target = path[0]; const d = target.clone().sub(rep.position); d.y = 0;
        const step = 11 * dt;
        if (d.length() <= step) { rep.position.x = target.x; rep.position.z = target.z; path.shift(); if (!path.length && W.onArrive) W.onArrive(rep.userData.at); }
        else { d.normalize(); rep.position.addScaledVector(d, step); rep.rotation.y = Math.atan2(d.x, d.z); }
        animateLimbs(rep, tAcc, true);
      } else animateLimbs(rep, tAcc, false);
      rep.position.y = Y;
    }
    Object.values(islands).forEach(isl => {
      if (isl.grow === undefined) return;
      isl.grow += dt; const t = Math.min(1, isl.grow / 1.4);
      const e = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);   // 彈出效果
      isl.group.scale.setScalar(Math.max(0.01, e)); isl.bridge.scale.x = Math.max(0.01, Math.min(1, t * 1.6));
      if (t >= 1) { isl.group.scale.setScalar(1); isl.bridge.scale.x = 1; delete isl.grow; }
    });
    for (let i = pops.length - 1; i >= 0; i--) {
      const q = pops[i]; q.t += dt; q.s.position.y += dt * 2.5; q.s.material.opacity = Math.max(0, 1 - q.t / 2.6);
      if (q.t > 2.6) { scene.remove(q.s); pops.splice(i, 1); }
    }
    renderer.render(scene, camera);
    if (W.onFrame) W.onFrame();
  }
})();
