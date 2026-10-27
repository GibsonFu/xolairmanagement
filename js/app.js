/* Xolair 經營島 — 介面、資料與互動 */
(function () {
  const W = XI.world;
  const KEY = 'xolair-island-v2';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const hash = s => { let h = 5381; for (const c of String(s)) h = (h * 33 ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };
  const daysAgo = d => Math.round((new Date(today()) - new Date(d)) / 864e5);
  const COLORS = ['#1f6f78', '#d9822b', '#3b82c4', '#c2593f', '#7a5bb5', '#5f9e5a', '#23201c', '#e0a030'];

  /* ---------- 狀態 ---------- */
  let S = load();
  let ui = { tab: 'islands', selected: null, expanded: null, logFilter: 'all', q: '' };

  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.hospitals) return s; } catch (e) { }
    return fresh();
  }
  function fresh() {
    const s = { hospitals: rowsToHospitals(XI.SAMPLE_ROWS.map(r => ({ hospital: r[0], tier: r[1], region: r[2], dept: r[3], doctor: r[4], title: r[5], level: r[6], note: r[7] }))), activities: [], todos: [
      { id: uid(), t: '確認明天門診時段', done: false }, { id: uid(), t: '整理上週 Meal 簽到表', done: false }], rep: { name: '', territory: '', color: '#1f6f78' }, time: 'day', toured: false, sample: true };
    // 範例活動
    const h = s.hospitals; const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    if (h.length > 2) {
      s.activities.push(act('detailing', h[0], [h[0].doctors[0]], d(-3), '10:30', '難治型氣喘病人辨識', 'done'));
      s.activities.push(act('meal', h[1], h[1].doctors.slice(0, 2), d(-1), '12:10', '科內午間交流', 'done'));
      s.activities.push(act('rtd', h[0], h[0].doctors.slice(1, 3), d(5), '18:30', 'CSU 治療流程討論', 'plan'));
      s.activities.push(act('detailing', h[2], [h[2].doctors[0]], d(0), '09:30', '回覆上次問題', 'plan'));
    }
    return s;
  }
  function act(type, h, docs, date, time, topic, status) {
    return { id: uid(), type, hospitalId: h.id, hospitalName: h.name, doctorIds: docs.filter(Boolean).map(x => x.id), doctorNames: docs.filter(Boolean).map(x => x.name), date, time, topic, note: '', status };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('瀏覽器無法儲存資料（可能是無痕模式）'); } }

  /* ---------- 名單處理 ---------- */
  function rowsToHospitals(rows) {
    const map = new Map();
    rows.forEach(r => {
      const name = String(r.hospital || '').trim(); if (!name) return;
      const id = 'h_' + hash(name);
      if (!map.has(id)) map.set(id, { id, name, tier: normTier(r.tier, name), region: (r.region || '').trim(), doctors: [] });
      const h = map.get(id);
      if (!h.region && r.region) h.region = r.region.trim();
      const dn = String(r.doctor || '').trim(); if (!dn) return;
      const did = id + '_' + hash(dn + '|' + (r.dept || ''));
      if (h.doctors.some(x => x.id === did)) return;
      h.doctors.push({ id: did, name: dn, dept: (r.dept || '').trim(), title: (r.title || '').trim(), level: normLevel(r.level), note: (r.note || '').trim() });
    });
    const order = { '醫學中心': 0, '區域醫院': 1, '地區醫院': 2, '診所': 3 };
    return [...map.values()].sort((a, b) => order[a.tier] - order[b.tier] || a.name.localeCompare(b.name, 'zh-Hant'));
  }
  function normTier(t, name) {
    t = String(t || '');
    if (/中心|medical/i.test(t)) return '醫學中心';
    if (/區域|regional/i.test(t)) return '區域醫院';
    if (/地區|district/i.test(t)) return '地區醫院';
    if (/診所|clinic/i.test(t) || /診所/.test(name)) return '診所';
    if (/醫學中心/.test(name)) return '醫學中心';
    return '地區醫院';
  }
  function normLevel(l) { l = String(l || '').trim().toUpperCase(); return ['A', 'B', 'C'].includes(l[0]) ? l[0] : 'B'; }

  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim()));
  }
  function mapRows(table) {
    if (!table.length) return { rows: [], missing: ['醫院名稱'] };
    const head = table[0].map(h => String(h).trim().toLowerCase());
    const idx = {};
    for (const [k, al] of Object.entries(XI.HEADER_ALIASES)) idx[k] = head.findIndex(h => al.some(a => h === a.toLowerCase()));
    for (const [k, al] of Object.entries(XI.HEADER_ALIASES)) if (idx[k] < 0) idx[k] = head.findIndex(h => al.some(a => h.includes(a.toLowerCase())));
    const missing = []; if (idx.hospital < 0) missing.push('醫院名稱');
    const rows = table.slice(1).map(r => { const o = {}; for (const k in idx) o[k] = idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : ''; return o; });
    return { rows, missing };
  }
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('無法載入 Excel 解析程式，請改用 CSV 或確認網路')); document.head.appendChild(s); });
  }
  async function readFile(file) {
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      await loadXLSX();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    }
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) { try { text = new TextDecoder('big5').decode(buf); } catch (e) { } }
    return parseCSV(text);
  }
  function download(name, content, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function csvCell(v) { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  /* ---------- 查詢工具 ---------- */
  const hospById = id => S.hospitals.find(h => h.id === id);
  const zoneById = id => XI.ZONES.find(z => z.id === id);
  const actsOf = (hid) => S.activities.filter(a => a.hospitalId === hid);
  const sortActs = list => list.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  function lastContact(did) {
    const a = sortActs(S.activities.filter(x => x.status === 'done' && x.doctorIds.includes(did)))[0];
    return a ? a.date : null;
  }
  function monthActs() { const m = today().slice(0, 7); return S.activities.filter(a => a.date.startsWith(m)); }
  function kpis() {
    const docs = S.hospitals.flatMap(h => h.doctors);
    const A = docs.filter(d => d.level === 'A');
    const reachedA = A.filter(d => { const l = lastContact(d.id); return l && daysAgo(l) <= 30; }).length;
    const touched = new Set(S.activities.filter(a => a.status === 'done' && daysAgo(a.date) <= 30).map(a => a.hospitalId)).size;
    const m = monthActs();
    return { docs: docs.length, A: A.length, reachedA, touched, hosp: S.hospitals.length,
      det: m.filter(a => a.type === 'detailing').length, meal: m.filter(a => a.type === 'meal').length, rtd: m.filter(a => a.type === 'rtd').length,
      planned: S.activities.filter(a => a.status === 'plan' && a.date >= today()).length };
  }

  /* ---------- 3D 初始化 ---------- */
  W.init($('#stage'), id => select(id, { fly: true }));
  W.setHospitals(S.hospitals);
  W.setTime(S.time || 'day');
  W.home();
  W.onArrive = id => {
    const a = W._pendingPop; W._pendingPop = null;
    W.pop(id, a ? XI.ACT_TYPES[a].icon : '📍');
  };

  /* ---------- 3D 標籤 ---------- */
  let labelEls = {};
  function buildLabels() {
    const box = $('#labels'); box.innerHTML = ''; labelEls = {};
    XI.ZONES.forEach(z => {
      const el = document.createElement('div'); el.className = 'lbl zone';
      el.innerHTML = `<span class="no">${z.no}</span>${esc(z.name)}`;
      el.onclick = () => select(z.id, { fly: true }); box.appendChild(el); labelEls[z.id] = el;
    });
    const mc = {}; monthActs().forEach(a => mc[a.hospitalId] = (mc[a.hospitalId] || 0) + 1);
    S.hospitals.forEach((h, i) => {
      const el = document.createElement('div'); el.className = 'lbl hosp';
      el.innerHTML = `<span class="no">H${String(i + 1).padStart(2, '0')}</span>${esc(h.name)}${mc[h.id] ? `<span class="badge">${mc[h.id]}</span>` : ''}`;
      el.onclick = () => select(h.id, { fly: true }); box.appendChild(el); labelEls[h.id] = el;
    });
    const me = document.createElement('div'); me.className = 'lbl me'; box.appendChild(me); labelEls.__me = me; updateMe();
  }
  function updateMe() { if (labelEls.__me) labelEls.__me.innerHTML = `我 <b>${esc(S.rep.name || 'Xolair 業務')}</b>`; }
  W.onFrame = () => {
    const on = W.labelsOn(); const far = W.camRadius() > 330;
    for (const id in labelEls) {
      const el = labelEls[id];
      const p = id === '__me' ? W.projectRep() : W.project(id);
      if (!p || !on) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      el.classList.toggle('far', far && el.classList.contains('hosp') && id !== ui.selected);
      el.classList.toggle('sel', id === ui.selected);
      el.style.zIndex = p.d ? Math.round(1000 - p.d) : 1001;
    }
  };

  /* ---------- 協作線 ---------- */
  function refreshLines() {
    const agg = {};
    S.activities.forEach(a => {
      const k = a.hospitalId + a.type; agg[k] = agg[k] || { from: XI.ACT_TYPES[a.type].zone, to: a.hospitalId, weight: 0, color: XI.ACT_TYPES[a.type].color }; agg[k].weight++;
    });
    const links = Object.values(agg);
    S.hospitals.forEach(h => { if (!S.activities.some(a => a.hospitalId === h.id)) links.push({ from: 'core', to: h.id, weight: 0, color: '#b9ad9b' }); });
    W.updateLines(links);
  }

  /* ---------- 面板 ---------- */
  function renderMeta() {
    const k = kpis();
    $('#metaLine').innerHTML = `${k.hosp} 家醫院 ／ ${k.docs} 位醫師 ／ 本月 ${k.det + k.meal + k.rtd} 場活動<br>${S.sample ? '目前為範例名單，匯入你的名單就會換成你的醫院。' : '選一座島，走進它的經營風景。'}`;
    $('#cntCust').textContent = k.hosp; $('#cntLog').textContent = S.activities.length;
    $('#repNameBrand').textContent = S.rep.name || '業務';
  }
  function renderList() {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const L = $('#list'); const q = ui.q.trim().toLowerCase();
    if (ui.tab === 'islands') L.innerHTML = islandsTab(q);
    if (ui.tab === 'customers') L.innerHTML = customersTab(q);
    if (ui.tab === 'log') L.innerHTML = logTab(q);
  }
  function islandsTab(q) {
    let h = '<div class="group-h">經營場景</div>';
    XI.ZONES.forEach(z => {
      if (q && !(z.name + z.tagline + z.items.map(i => i.t).join()).toLowerCase().includes(q)) return;
      const cnt = z.id in XI.ACT_TYPES ? S.activities.filter(a => a.type === z.id).length : z.items.length;
      h += `<div class="row ${ui.selected === z.id ? 'sel' : ''}" data-sel="${z.id}"><div class="num">${z.no}</div><div class="t"><b>${esc(z.name)}</b><small>${esc(z.tagline)}</small></div><div class="r">${cnt} ↗</div></div>`;
      if (ui.selected === z.id) h += `<div class="sub"><a class="go" data-fly="${z.id}">探索此島 ↗</a>${z.items.map((it, i) => `<a data-sel="${z.id}">${'①②③④⑤⑥'[i] || '·'}　${esc(it.t)}</a>`).join('')}</div>`;
    });
    h += '<div class="group-h" style="display:flex;justify-content:space-between;align-items:center">醫院客戶<button class="btn" data-addhosp="1" style="padding:5px 10px;font-size:12px">＋ 新增醫院</button></div>';
    const hs = S.hospitals.filter(x => !q || (x.name + x.region + x.doctors.map(d => d.name + d.dept).join()).toLowerCase().includes(q));
    if (!hs.length) h += '<div class="empty">沒有符合的醫院</div>';
    hs.forEach(x => {
      const i = S.hospitals.indexOf(x);
      h += `<div class="row ${ui.selected === x.id ? 'sel' : ''}" data-sel="${x.id}"><div class="num">${String(i + 1).padStart(2, '0')}</div><div class="t"><b>${esc(x.name)}</b><small>${esc(x.tier)}${x.region ? ' · ' + esc(x.region) : ''} · ${x.doctors.length} 位醫師</small></div><div class="r">${actsOf(x.id).length} ↗</div></div>`;
    });
    return h;
  }
  function customersTab(q) {
    let h = `<button class="btn" data-addhosp="1" style="width:100%;margin-top:6px">＋ 新增醫院</button><div class="filters">${['全部', 'A', 'B', 'C'].map(l => `<button data-lv="${l}" class="${(ui.lv || '全部') === l ? 'on' : ''}">${l === '全部' ? '全部醫師' : l + ' 級'}</button>`).join('')}</div>`;
    const lv = ui.lv && ui.lv !== '全部' ? ui.lv : null;
    let any = false;
    S.hospitals.forEach(x => {
      const docs = x.doctors.filter(d => (!lv || d.level === lv) && (!q || (x.name + d.name + d.dept + d.title + d.note).toLowerCase().includes(q)));
      if (!docs.length && (lv || q)) return;
      any = true;
      h += `<div class="group-h" style="display:flex;justify-content:space-between;cursor:pointer" data-sel="${x.id}"><span>${esc(x.name)}</span><span class="tier">${esc(x.tier)}</span></div>`;
      docs.forEach(d => h += docRow(x, d));
    });
    if (!any) h += '<div class="empty">沒有符合的醫師<br>試試其他關鍵字，或匯入你的名單</div>';
    return h;
  }
  function docRow(x, d) {
    const l = lastContact(d.id);
    return `<div class="doc"><span class="lv ${d.level}">${d.level}</span><div class="t"><b>${esc(d.name)}</b> <small style="display:inline">${esc(d.title)}</small><small>${esc(d.dept)}${l ? ` · 上次接觸 ${daysAgo(l)} 天前` : ' · 尚無紀錄'}${d.note ? ' · ' + esc(d.note) : ''}</small></div>
      <div class="mini"><button title="Detailing" data-new="detailing" data-h="${x.id}" data-d="${d.id}">💬</button><button title="Meal" data-new="meal" data-h="${x.id}" data-d="${d.id}">🍱</button><button title="RTD" data-new="rtd" data-h="${x.id}" data-d="${d.id}">🗣️</button></div></div>`;
  }
  function logTab(q) {
    const k = kpis();
    let h = `<div class="kpis">
      <div class="kpi"><b>${k.det}</b><small>本月 Detailing</small></div>
      <div class="kpi"><b>${k.meal + k.rtd}</b><small>本月 Meal + RTD</small></div>
      <div class="kpi"><b>${k.reachedA}<span style="font-size:15px;color:var(--ink-3)">/${k.A}</span></b><small>A 級醫師 30 天內接觸</small><div class="bar"><i style="width:${k.A ? k.reachedA / k.A * 100 : 0}%"></i></div></div>
      <div class="kpi"><b>${k.touched}<span style="font-size:15px;color:var(--ink-3)">/${k.hosp}</span></b><small>30 天內拜訪的醫院</small><div class="bar"><i style="width:${k.hosp ? k.touched / k.hosp * 100 : 0}%;background:var(--accent)"></i></div></div></div>`;
    h += `<div class="filters">${[['all', '全部'], ['plan', '計畫中'], ['done', '已完成'], ['detailing', 'Detailing'], ['meal', 'Meal'], ['rtd', 'RTD']].map(([k, n]) => `<button data-lf="${k}" class="${ui.logFilter === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    let list = sortActs(S.activities);
    const f = ui.logFilter;
    if (f === 'plan' || f === 'done') list = list.filter(a => a.status === f); else if (f !== 'all') list = list.filter(a => a.type === f);
    if (q) list = list.filter(a => (a.hospitalName + a.doctorNames.join() + a.topic + a.note + XI.ACT_TYPES[a.type].name).toLowerCase().includes(q));
    h += list.length ? list.map(actRow).join('') : '<div class="empty">還沒有活動紀錄<br>按下方「＋ 新增活動」開始</div>';
    h += `<div style="margin-top:14px"><button class="btn" id="btnExportLog">匯出日誌 CSV</button></div>`;
    return h;
  }
  function actRow(a) {
    const t = XI.ACT_TYPES[a.type];
    return `<div class="act" data-edit="${a.id}"><div class="ic" style="background:${t.color}22">${t.icon}</div><div class="t"><b>${esc(a.topic || t.name)}<span class="st ${a.status}">${a.status === 'done' ? '已完成' : '計畫中'}</span></b><small>${t.name} · ${esc(a.hospitalName)}${a.doctorNames.length ? ' · ' + esc(a.doctorNames.join('、')) : ''}</small></div><div class="d">${a.date.slice(5).replace('-', '/')}<br>${esc(a.time || '')}</div></div>`;
  }

  /* ---------- 詳細卡 ---------- */
  function select(id, { fly } = {}) {
    ui.selected = id;
    if (fly) W.flyTo(id);
    renderDetail(); renderList();
    if (W.isMobile()) $('#panel').classList.remove('open');
    const row = document.querySelector(`.row[data-sel="${id}"]`); row && row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function closeDetail() { ui.selected = null; $('#detail').classList.add('hidden'); renderList(); }

  function renderDetail() {
    const D = $('#detail'); const id = ui.selected;
    if (!id) { D.classList.add('hidden'); return; }
    D.classList.remove('hidden');
    const z = zoneById(id);
    D.innerHTML = z ? zoneDetail(z) : hospDetail(hospById(id));
  }
  function walkBtn(id) { return `<button class="btn" data-walk="${id}" style="padding:6px 10px;font-size:12px">🚶 走過去</button>`; }
  function zoneDetail(z) {
    const icon = { core: '✳️', daily: '☕', detailing: '💬', meal: '🍱', rtd: '🗣️' }[z.id];
    let body = '';
    if (z.id === 'core') {
      const k = kpis();
      body += `<div class="sec-h">經營總覽</div><div class="kpis"><div class="kpi"><b>${k.hosp}</b><small>醫院</small></div><div class="kpi"><b>${k.docs}</b><small>醫師（A 級 ${k.A}）</small></div><div class="kpi"><b>${k.det + k.meal + k.rtd}</b><small>本月活動</small></div><div class="kpi"><b>${k.planned}</b><small>待執行計畫</small></div></div>`;
    }
    if (z.id === 'daily') {
      const td = sortActs(S.activities.filter(a => a.date === today())).reverse();
      body += `<div class="sec-h">今天的行程（${today()}）</div>` + (td.length ? td.map(actRow).join('') : '<div class="empty" style="padding:12px">今天還沒有安排活動</div>');
      body += `<div class="sec-h">待辦清單</div>` + S.todos.map(t => `<div class="todo ${t.done ? 'done' : ''}"><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.t)}</span><button class="del" data-deltodo="${t.id}">✕</button></div>`).join('') +
        `<form class="todo-add" id="todoForm"><input id="todoIn" placeholder="新增待辦…"><button class="btn">加入</button></form>`;
    }
    body += `<div class="sec-h">${z.id === 'daily' ? '一天的節奏' : z.id === 'core' ? '重點內容' : '執行步驟'}</div>` +
      z.items.map((it, i) => `<details class="item" ${i === 0 ? 'open' : ''}><summary>${esc(it.t)}<span class="tg">${esc(it.tag)}</span></summary><p>${esc(it.d)}</p></details>`).join('');
    if (z.id in XI.ACT_TYPES) {
      const list = sortActs(S.activities.filter(a => a.type === z.id));
      body += `<div class="sec-h">${XI.ACT_TYPES[z.id].name} 紀錄（${list.length}）</div>` + (list.length ? list.slice(0, 12).map(actRow).join('') : '<div class="empty" style="padding:12px">還沒有紀錄</div>');
      body += `<button class="btn primary" style="width:100%;margin-top:12px;background:${z.color};border-color:${z.color}" data-new="${z.id}">＋ 新增 ${XI.ACT_TYPES[z.id].name}</button>`;
    }
    if (z.id === 'core') body += `<p class="fine" style="margin-top:12px">產品資訊僅為內部整理範本，請以核准仿單與公司核可資料為準。內容可在 js/data.js 修改。</p>`;
    return `<div class="head"><button class="x" data-close="detail">✕</button><div class="ico" style="background:${z.color}22">${icon}</div><div class="eyebrow">ISLAND ${z.no}</div><h2>${esc(z.name)}</h2>
      <p class="tagline">${esc(z.tagline)}</p><blockquote>${esc(z.quote)}</blockquote><div class="chips"><span>${z.items.length} 個重點</span>${walkBtn(z.id)}</div></div><div class="body">${body}</div>`;
  }
  function hospDetail(h) {
    if (!h) return '';
    const i = S.hospitals.indexOf(h); const acts = sortActs(actsOf(h.id));
    const lv = { A: 0, B: 0, C: 0 }; h.doctors.forEach(d => lv[d.level]++);
    const depts = [...new Set(h.doctors.map(d => d.dept).filter(Boolean))];
    return `<div class="head"><button class="x" data-close="detail">✕</button><div class="ico" style="background:#d94a3d1c">🏥</div><div class="eyebrow">HOSPITAL ${String(i + 1).padStart(2, '0')} · ${esc(h.tier)}</div><h2>${esc(h.name)}</h2>
      <p class="tagline">${esc(h.region || '未填區域')} · ${depts.length ? esc(depts.join('、')) : '未填科別'}</p>
      <div class="chips"><span>${h.doctors.length} 位醫師</span><span>A ${lv.A} · B ${lv.B} · C ${lv.C}</span><span>${acts.length} 場活動</span>${walkBtn(h.id)}</div>
      <div class="act-btns">${Object.entries(XI.ACT_TYPES).map(([k, t]) => `<button style="background:${t.color}" data-new="${k}" data-h="${h.id}">＋ ${t.name}</button>`).join('')}</div></div>
      <div class="body"><div class="sec-h" style="display:flex;justify-content:space-between;align-items:center">醫師名單<span class="row-btns"><button class="btn" data-addhosp="${h.id}" style="padding:4px 9px;font-size:12px">✎ 編輯 / ＋ 醫師</button></span></div>${h.doctors.length ? h.doctors.slice().sort((a, b) => a.level.localeCompare(b.level)).map(d => docRow(h, d)).join('') : '<div class="empty">這家醫院還沒有醫師資料</div>'}
      <div class="sec-h">活動紀錄</div>${acts.length ? acts.map(actRow).join('') : '<div class="empty" style="padding:12px">尚無活動，從上方按鈕新增</div>'}</div>`;
  }

  /* ---------- 活動表單 ---------- */
  function openActivity(opts = {}) {
    const ex = opts.id ? S.activities.find(a => a.id === opts.id) : null;
    const a = ex ? { ...ex } : { type: opts.type || 'detailing', hospitalId: opts.h || (hospById(ui.selected) ? ui.selected : S.hospitals[0]?.id), doctorIds: opts.d ? [opts.d] : [], date: today(), time: '', topic: '', note: '', status: 'plan' };
    if (!S.hospitals.length) { toast('請先匯入客戶名單'); return openImport(); }
    const draw = () => {
      const h = hospById(a.hospitalId);
      $('#modalCard').className = 'modal-card';
      $('#modalCard').innerHTML = `<button class="x" data-close="modal" style="top:16px;right:16px">✕</button>
        <div class="eyebrow">${ex ? 'EDIT ACTIVITY' : 'NEW ACTIVITY'}</div><h3>${ex ? '編輯活動' : '新增活動'}</h3>
        <label class="f">活動類型</label><div class="seg">${Object.entries(XI.ACT_TYPES).map(([k, t]) => `<button type="button" data-type="${k}" class="${a.type === k ? 'on' : ''}" style="${a.type === k ? `background:${t.color};border-color:${t.color}` : ''}">${t.icon} ${t.name}</button>`).join('')}</div>
        <div class="two"><label class="f">日期<input type="date" id="fDate" value="${a.date}"></label><label class="f">時間<input type="time" id="fTime" value="${a.time}"></label></div>
        <label class="f">醫院<select id="fHosp">${S.hospitals.map(x => `<option value="${x.id}" ${x.id === a.hospitalId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${ex && !h ? `<option selected value="${a.hospitalId}">${esc(a.hospitalName)}（已不在名單）</option>` : ''}</select></label>
        <label class="f">參與醫師</label><div class="docpick">${h ? h.doctors.map(d => `<label><input type="checkbox" value="${d.id}" ${a.doctorIds.includes(d.id) ? 'checked' : ''}><span class="lv ${d.level}" style="width:18px;height:18px;font-size:10px">${d.level}</span>${esc(d.name)}<small style="color:var(--ink-3)">${esc(d.dept)}</small></label>`).join('') || '<span class="fine">此醫院沒有醫師資料</span>' : ''}</div>
        <label class="f">主題<input id="fTopic" value="${esc(a.topic)}" placeholder="${{ detailing: '例如：難治型氣喘病人辨識', meal: '例如：科內午間交流', rtd: '例如：CSU 治療流程討論' }[a.type]}"></label>
        <label class="f">備註 / 下一步<textarea id="fNote" rows="3" placeholder="醫師回饋、下次行動…">${esc(a.note)}</textarea></label>
        <label class="f">狀態</label><div class="radio"><label><input type="radio" name="st" value="plan" ${a.status === 'plan' ? 'checked' : ''}>計畫中</label><label><input type="radio" name="st" value="done" ${a.status === 'done' ? 'checked' : ''}>已完成</label></div>
        <div class="foot">${ex ? '<button class="btn danger" style="margin:0;width:auto" id="fDel">刪除</button>' : '<span></span>'}<div class="row-btns"><button class="btn" data-close="modal">取消</button><button class="btn primary" id="fSave">儲存並出發 🚶</button></div></div>`;
    };
    const grab = () => {
      a.date = $('#fDate').value || today(); a.time = $('#fTime').value; a.topic = $('#fTopic').value.trim(); a.note = $('#fNote').value.trim();
      a.status = document.querySelector('input[name=st]:checked').value;
      a.doctorIds = [...document.querySelectorAll('.docpick input:checked')].map(i => i.value);
    };
    draw(); showModal();
    $('#modalCard').onclick = e => {
      const tb = e.target.closest('[data-type]'); if (tb) { grab(); a.type = tb.dataset.type; draw(); return; }
      if (e.target.id === 'fSave') {
        grab(); const h = hospById(a.hospitalId);
        if (h) { a.hospitalName = h.name; a.doctorNames = a.doctorIds.map(id => h.doctors.find(d => d.id === id)?.name).filter(Boolean); }
        if (ex) Object.assign(ex, a); else S.activities.push({ ...a, id: uid() });
        save(); hideModal(); refreshAll();
        W._pendingPop = a.type; W.walkRepTo(a.hospitalId);
        toast(`${XI.ACT_TYPES[a.type].icon} 已${ex ? '更新' : '新增'}，正在前往 ${a.hospitalName}`);
      }
      if (e.target.id === 'fDel' && confirm('確定刪除這筆活動？')) { S.activities = S.activities.filter(x => x.id !== ex.id); save(); hideModal(); refreshAll(); toast('已刪除'); }
    };
    $('#modalCard').onchange = e => { if (e.target.id === 'fHosp') { grab(); a.hospitalId = e.target.value; a.doctorIds = []; draw(); } };
  }

  /* ---------- 新增 / 編輯醫院 ---------- */
  function openHospital(editId) {
    const ex = editId ? hospById(editId) : null;
    const f = ex ? { name: ex.name, tier: ex.tier, region: ex.region, doctors: ex.doctors.map(d => ({ ...d })) }
      : { name: '', tier: '區域醫院', region: '', doctors: [{ name: '', dept: '', title: '', level: 'B', note: '' }] };
    const grab = () => {
      f.name = $('#hName').value.trim(); f.tier = $('#hTier').value; f.region = $('#hRegion').value.trim();
      document.querySelectorAll('.drow').forEach((r, i) => {
        const v = k => r.querySelector(`[data-k=${k}]`).value.trim();
        Object.assign(f.doctors[i], { name: v('name'), dept: v('dept'), title: v('title'), level: v('level') });
      });
    };
    const draw = () => {
      $('#modalCard').className = 'modal-card';
      $('#modalCard').innerHTML = `<button class="x" data-close="modal" style="top:16px;right:16px">✕</button>
        <div class="eyebrow">${ex ? 'EDIT HOSPITAL' : 'NEW HOSPITAL'}</div><h3>${ex ? '編輯醫院' : '新增醫院'}</h3>
        ${ex ? '' : '<p>儲存後，外圈會長出一座新的醫院島。</p>'}
        <label class="f">醫院名稱<input id="hName" value="${esc(f.name)}" placeholder="例如：○○紀念醫院"></label>
        <div class="two"><label class="f">醫院層級<select id="hTier">${XI.TIERS.map(t => `<option ${t === f.tier ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="f">區域<input id="hRegion" value="${esc(f.region)}" placeholder="例如：台北"></label></div>
        <div class="sec-h" style="margin-top:18px">醫師</div>
        ${f.doctors.map((d, i) => `<div class="drow" style="display:grid;grid-template-columns:1.2fr 1.2fr 1fr 64px 30px;gap:6px;margin-bottom:6px">
          <input data-k="name" value="${esc(d.name)}" placeholder="姓名" style="margin:0">
          <input data-k="dept" value="${esc(d.dept)}" placeholder="科別" style="margin:0">
          <input data-k="title" value="${esc(d.title)}" placeholder="職稱" style="margin:0">
          <select data-k="level" style="margin:0">${XI.LEVELS.map(l => `<option ${l === d.level ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button type="button" data-rmdoc="${i}" title="移除" style="color:var(--ink-3)">✕</button></div>`).join('')}
        <button type="button" class="btn" id="hAddDoc" style="padding:6px 12px;font-size:13px">＋ 再加一位醫師</button>
        <div class="foot">${ex ? '<button class="btn danger" style="margin:0;width:auto" id="hDel">刪除醫院</button>' : '<span></span>'}
        <div class="row-btns"><button class="btn" data-close="modal">取消</button><button class="btn primary" id="hSave">${ex ? '儲存' : '建立醫院島 🏝️'}</button></div></div>`;
    };
    draw(); showModal(); $('#hName').focus();
    $('#modalCard').onclick = e => {
      if (e.target.id === 'hAddDoc') { grab(); f.doctors.push({ name: '', dept: '', title: '', level: 'B', note: '' }); draw(); return; }
      const rm = e.target.closest('[data-rmdoc]'); if (rm) { grab(); f.doctors.splice(+rm.dataset.rmdoc, 1); draw(); return; }
      if (e.target.id === 'hDel') {
        if (!confirm(`確定刪除「${ex.name}」？這家醫院的活動紀錄會保留在日誌裡。`)) return;
        S.hospitals = S.hospitals.filter(h => h.id !== ex.id); S.sample = false; save(); hideModal();
        ui.selected = null; W.setHospitals(S.hospitals); refreshAll(); toast('已刪除醫院'); return;
      }
      if (e.target.id === 'hSave') {
        grab();
        if (!f.name) { toast('請填醫院名稱'); $('#hName').focus(); return; }
        const id = ex ? ex.id : 'h_' + hash(f.name);
        if (!ex && hospById(id)) { toast('名單裡已經有這家醫院'); return; }
        const doctors = f.doctors.filter(d => d.name).map(d => ({ ...d, id: d.id || id + '_' + hash(d.name + '|' + d.dept + '|' + uid()), note: d.note || '' }));
        if (ex) Object.assign(ex, { name: f.name, tier: f.tier, region: f.region, doctors });
        else S.hospitals.push({ id, name: f.name, tier: f.tier, region: f.region, doctors });
        S.sample = false; save(); hideModal();
        W.setHospitals(S.hospitals, ex ? null : id); refreshAll();
        if (!ex) { W.home(); setTimeout(() => select(id, { fly: true }), 900); toast(`🏝️ ${f.name} 島長出來了`); }
        else { renderDetail(); toast('已更新'); }
      }
    };
  }

  /* ---------- 匯入名單 ---------- */
  function openImport() {
    let parsed = null;
    $('#modalCard').className = 'modal-card';
    $('#modalCard').innerHTML = `<button class="x" data-close="modal" style="top:16px;right:16px">✕</button>
      <div class="eyebrow">IMPORT CUSTOMERS</div><h3>匯入我的客戶名單</h3>
      <p>每一列是一位醫師。同一家醫院的醫師會聚在同一座島上；醫院層級決定建築大小，客戶分級決定小人白袍的顏色（<b style="color:var(--red)">A 紅</b>、<b style="color:var(--amber)">B 黃</b>、<b style="color:var(--green)">C 綠</b>）。</p>
      <table class="cols"><tr><th>欄位</th><th>範例</th></tr>
        <tr><td><b>醫院名稱</b>（必填）</td><td>北區示範醫學中心</td></tr><tr><td>醫院層級</td><td>醫學中心／區域醫院／地區醫院／診所</td></tr>
        <tr><td>區域</td><td>台北</td></tr><tr><td>科別</td><td>胸腔內科</td></tr><tr><td>醫師姓名</td><td>陳醫師</td></tr><tr><td>職稱</td><td>主任</td></tr><tr><td>客戶分級</td><td>A／B／C</td></tr><tr><td>備註</td><td>難治型氣喘門診</td></tr></table>
      <button class="btn" id="dlTpl">⬇ 下載範本（CSV，可用 Excel 開啟）</button>
      <label class="drop" id="drop"><input type="file" id="fileIn" accept=".csv,.xlsx,.xls,.txt" hidden><b>點這裡選擇檔案</b>，或把檔案拖進來<br><small>支援 .csv、.xlsx、.xls</small></label>
      <div id="pv"></div>`;
    showModal();
    const handle = async file => {
      try {
        const { rows, missing } = mapRows(await readFile(file));
        if (missing.length) { $('#pv').innerHTML = `<div class="preview" style="color:var(--red)">找不到欄位：${missing.join('、')}。請確認第一列是標題列。</div>`; return; }
        parsed = rowsToHospitals(rows);
        const docs = parsed.reduce((s, h) => s + h.doctors.length, 0);
        $('#pv').innerHTML = `<div class="preview">讀到 <b>${parsed.length}</b> 家醫院、<b>${docs}</b> 位醫師（${esc(file.name)}）<br><small>${parsed.slice(0, 6).map(h => esc(h.name)).join('、')}${parsed.length > 6 ? '…' : ''}</small></div>
          <div class="radio"><label><input type="radio" name="mode" value="replace" checked>取代目前名單</label><label><input type="radio" name="mode" value="merge">合併到目前名單</label></div>
          <div class="foot"><span class="fine">活動紀錄會保留</span><button class="btn primary" id="doImport">建立我的島嶼 🏝️</button></div>`;
      } catch (err) { $('#pv').innerHTML = `<div class="preview" style="color:var(--red)">${esc(err.message)}</div>`; }
    };
    $('#fileIn').onchange = e => e.target.files[0] && handle(e.target.files[0]);
    const drop = $('#drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); };
    $('#modalCard').onclick = e => {
      if (e.target.id === 'dlTpl') {
        const rows = [XI.TEMPLATE_HEADER, ...XI.SAMPLE_ROWS];
        download('Xolair經營島_客戶名單範本.csv', '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
      }
      if (e.target.id === 'doImport' && parsed) {
        const mode = document.querySelector('input[name=mode]:checked').value;
        if (mode === 'replace') S.hospitals = parsed;
        else {
          parsed.forEach(p => { const ex = hospById(p.id); if (!ex) S.hospitals.push(p); else p.doctors.forEach(d => { if (!ex.doctors.some(x => x.id === d.id)) ex.doctors.push(d); }); });
        }
        S.sample = false; save(); hideModal();
        ui.selected = null; W.setHospitals(S.hospitals); refreshAll(); W.home();
        toast(`🏝️ 已建立 ${S.hospitals.length} 座醫院島`);
      }
    };
  }

  /* ---------- 導覽 ---------- */
  const TOUR = [
    ['HELLO, XOLAIR / 01', '每座島是一個經營場景', '中央是 Xolair 核心島；內圈是業務日常、Detailing、Meal、RTD 四座活動島；外圈是你的醫院客戶，靠環島步道連在一起。'],
    ['YOUR ACCOUNTS / 02', '匯入名單，醫院就長出來', '用 CSV 或 Excel 匯入客戶名單，每家醫院自動變成一座島，醫師就是島上穿白袍的小人：紅色 A 級、黃色 B 級、綠色 C 級。'],
    ['ON THE ROAD / 03', '記一筆活動，小人就出發', '在醫院或醫師旁按 💬 Detailing、🍱 Meal、🗣️ RTD，你的業務小人會沿著步道走過去，日誌與 KPI 會即時更新。'],
    ['EXPLORE / 04', '自由探索', '拖曳旋轉、右鍵或雙指平移、滾輪或捏合縮放。左上可以切換清晨到夜晚、顯示協作線、鳥瞰全島、跟隨你的小人。']
  ];
  function openTour(step = 0) {
    const [eb, h, p] = TOUR[step];
    $('#modalCard').className = 'modal-card tour';
    $('#modalCard').innerHTML = `<div class="eyebrow">${eb}</div><h3>${h}</h3><p>${p}</p>
      <div class="foot"><button class="btn" data-close="modal">略過</button><div class="dots">${TOUR.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn primary" id="tNext">${step === TOUR.length - 1 ? '開始經營 →' : '下一步 →'}</button></div>`;
    showModal();
    $('#modalCard').onclick = e => {
      if (e.target.id === 'tNext') { if (step < TOUR.length - 1) openTour(step + 1); else hideModal(); }
    };
    S.toured = true; save();
  }

  /* ---------- 角色 ---------- */
  function renderRole() {
    $('#repName').value = S.rep.name; $('#repTerritory').value = S.rep.territory;
    $('#swatches').innerHTML = COLORS.map(c => `<button style="background:${c}" data-color="${c}" class="${S.rep.color === c ? 'on' : ''}" aria-label="${c}"></button>`).join('');
  }

  /* ---------- 共用 ---------- */
  function showModal() { $('#modal').classList.remove('hidden'); }
  function hideModal() { $('#modal').classList.add('hidden'); $('#modalCard').onclick = null; $('#modalCard').onchange = null; }
  let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }
  function refreshAll() { renderMeta(); renderList(); renderDetail(); buildLabels(); refreshLines(); }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-sel],[data-fly],[data-new],[data-edit],[data-walk],[data-close],[data-lv],[data-lf],[data-deltodo],[data-go],[data-color],[data-addhosp]');
    if (!t) return;
    const d = t.dataset;
    if (d.new) { e.stopPropagation(); return openActivity({ type: d.new, h: d.h, d: d.d }); }
    if (d.edit) return openActivity({ id: d.edit });
    if (d.walk) { W.walkRepTo(d.walk); toast('🚶 出發中…'); return; }
    if (d.fly) return select(d.fly, { fly: true });
    if (d.sel) return select(d.sel, { fly: true });
    if (d.close === 'detail') return closeDetail();
    if (d.close === 'modal') return hideModal();
    if (d.close === 'role') return $('#role').classList.add('hidden');
    if (d.lv) { ui.lv = d.lv; return renderList(); }
    if (d.lf) { ui.logFilter = d.lf; return renderList(); }
    if (d.addhosp) return openHospital(d.addhosp === '1' ? null : d.addhosp);
    if (d.deltodo) { S.todos = S.todos.filter(x => x.id !== d.deltodo); save(); return renderDetail(); }
    if (d.go) { W.walkRepTo(d.go); $('#role').classList.add('hidden'); return; }
    if (d.color) { S.rep.color = d.color; W.repColor(d.color); save(); return renderRole(); }
  });
  document.addEventListener('change', e => {
    if (e.target.dataset.todo) { const x = S.todos.find(t => t.id === e.target.dataset.todo); x.done = e.target.checked; save(); renderDetail(); }
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'todoForm') { e.preventDefault(); const v = $('#todoIn').value.trim(); if (v) { S.todos.push({ id: uid(), t: v, done: false }); save(); renderDetail(); $('#todoIn')?.focus(); } }
  });
  document.addEventListener('click', e => { if (e.target.id === 'btnExportLog') exportLog(); });
  function exportLog() {
    const rows = [['日期', '時間', '類型', '狀態', '醫院', '醫師', '主題', '備註'], ...sortActs(S.activities).map(a => [a.date, a.time, XI.ACT_TYPES[a.type].name, a.status === 'done' ? '已完成' : '計畫中', a.hospitalName, a.doctorNames.join('、'), a.topic, a.note])];
    download(`Xolair經營島_日誌_${today()}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; renderList(); });
  $('#search').oninput = e => { ui.q = e.target.value; renderList(); };
  $('#btnImport').onclick = openImport;
  $('#fabAdd').onclick = () => openActivity();
  $('#btnHelp').onclick = () => openTour(0);
  $('#btnHome').onclick = () => { setTool('follow', false); setTool('bird', false); W.home(); };
  $('#btnRole').onclick = () => { renderRole(); $('#role').classList.toggle('hidden'); };
  $('#btnList').onclick = () => $('#panel').classList.toggle('open');
  $('#panelGrip').onclick = () => $('#panel').classList.remove('open');
  $('#zIn').onclick = () => W.zoom(0.75);
  $('#zOut').onclick = () => W.zoom(1.33);
  $('#modal').onclick = e => { if (e.target.id === 'modal') hideModal(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideModal(); $('#role').classList.add('hidden'); } });

  $('#repName').oninput = e => { S.rep.name = e.target.value; save(); updateMe(); renderMeta(); };
  $('#repTerritory').oninput = e => { S.rep.territory = e.target.value; save(); };
  $('#btnExport').onclick = () => download(`Xolair經營島_備份_${today()}.json`, JSON.stringify(S, null, 2), 'application/json');
  $('#fileBackup').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!s.hospitals || !s.activities) throw 0; S = s; save(); W.setHospitals(S.hospitals); W.repColor(S.rep.color); refreshAll(); renderRole(); toast('已還原備份'); }
    catch (err) { toast('這不是有效的備份檔'); }
    e.target.value = '';
  };
  $('#btnReset').onclick = () => { if (!confirm('確定清除所有名單、活動與設定？此動作無法復原。')) return; S = fresh(); save(); W.setHospitals(S.hospitals); W.repColor(S.rep.color); ui.selected = null; refreshAll(); renderRole(); toast('已回到範例資料'); };

  // 時段
  document.querySelectorAll('#timePill button').forEach(b => {
    b.classList.toggle('on', b.dataset.time === (S.time || 'day'));
    b.onclick = () => { S.time = b.dataset.time; save(); W.setTime(S.time); document.querySelectorAll('#timePill button').forEach(x => x.classList.toggle('on', x === b)); };
  });
  // 工具
  const tools = { labels: true, follow: false, lines: false, pause: false, bird: false };
  function setTool(k, v) {
    tools[k] = v; document.querySelector(`[data-tool="${k}"]`).classList.toggle('on', v);
    if (k === 'labels') W.setLabels(v);
    if (k === 'follow') W.setFollow(v);
    if (k === 'lines') { W.setLines(v); if (v) refreshLines(); }
    if (k === 'pause') W.setPaused(v);
    if (k === 'bird') { W.birdsEye(v); if (v && tools.follow) setTool('follow', false); }
  }
  document.querySelectorAll('#toolPill button').forEach(b => b.onclick = () => {
    const k = b.dataset.tool;
    if (k === 'log') { ui.tab = 'log'; renderList(); if (W.isMobile()) $('#panel').classList.add('open'); return; }
    setTool(k, !tools[k]);
  });

  /* ---------- 啟動 ---------- */
  W.repColor(S.rep.color);
  refreshAll();
  if (!S.toured) setTimeout(() => openTour(0), 900);
})();
