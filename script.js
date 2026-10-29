// <core>
const PROC_MS = 2;

function dijkstra(nodes, links, src, dst) {
  const dist = {}, prev = {}, done = {}, byId = {}, steps = [];
  nodes.forEach(n => { dist[n.id] = Infinity; byId[n.id] = n; });
  if (!byId[src] || !byId[dst]) return null;
  dist[src] = 0;
  while (true) {
    let u = null, best = Infinity;
    for (const n of nodes) {
      if (!done[n.id] && dist[n.id] < best) { best = dist[n.id]; u = n.id; }
    }
    if (u === null) break;
    done[u] = true;
    const expand = !(byId[u].type === 'pc' && u !== src) && u !== dst;
    if (expand) {
      for (const l of links) {
        let v;
        if (l.a === u) v = l.b; else if (l.b === u) v = l.a; else continue;
        if (done[v]) continue;
        const alt = dist[u] + l.w;
        if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
      }
    }
    steps.push({ n: steps.length + 1, u, expand, dist: Object.assign({}, dist), prev: Object.assign({}, prev), done: Object.assign({}, done) });
    if (u === dst) break;
  }
  if (dist[dst] === Infinity) return null;
  const path = [];
  for (let c = dst; c !== undefined; c = prev[c]) path.unshift(c);
  return { path, cost: dist[dst], steps };
}

function describeRoute(nodes, links, path) {
  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  const hops = [];
  let linkMs = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = links.find(x => (x.a === path[i] && x.b === path[i + 1]) || (x.a === path[i + 1] && x.b === path[i]));
    hops.push({ from: byId[path[i]].name, to: byId[path[i + 1]].name, ms: l.w, linkId: l.id });
    linkMs += l.w;
  }
  const routers = Math.max(0, path.length - 2);
  return { hops, hopCount: path.length - 1, linkMs, routers, procMs: routers * PROC_MS, totalMs: linkMs + routers * PROC_MS };
}
// </core>

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

// ---------- state ----------
const W = 800, H = 520, R = 23;
let nodes = [], links = [], counters = { pc: 0, rt: 0, id: 0, link: 0 };
let mode = 'move', sel = null, connectFrom = null, route = null, anim = null, drag = null;
let history = [];

const $ = id => document.getElementById(id);
const svg = $('stage'), linkLayer = $('linkLayer'), nodeLayer = $('nodeLayer'), packetEl = $('packet');
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const byId = id => nodes.find(n => n.id === id);
const linkOf = (a, b) => links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const autoW = (a, b) => Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 10));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pcs = () => nodes.filter(n => n.type === 'pc');

// ---------- model edits ----------
function addNode(type, x, y) {
  counters[type]++; counters.id++;
  const n = { id: 'n' + counters.id, type, name: (type === 'pc' ? 'PC' : 'R') + counters[type], x: Math.round(x), y: Math.round(y) };
  nodes.push(n); return n;
}
function addLink(a, b, w) {
  if (a === b || linkOf(a, b)) return null;
  const A = byId(a), B = byId(b);
  counters.link++;
  const l = { id: 'l' + counters.link, a, b, w: w ?? autoW(A, B), auto: w === undefined };
  links.push(l); return l;
}
function removeNode(id) { nodes = nodes.filter(n => n.id !== id); links = links.filter(l => l.a !== id && l.b !== id); }
function removeLink(id) { links = links.filter(l => l.id !== id); }

function loadSample() {
  nodes = []; links = []; counters = { pc: 0, rt: 0, id: 0, link: 0 };
  const pc1 = addNode('pc', 90, 110), pc2 = addNode('pc', 90, 410), pc3 = addNode('pc', 710, 110), pc4 = addNode('pc', 710, 410);
  const r1 = addNode('rt', 250, 160), r2 = addNode('rt', 250, 360), r3 = addNode('rt', 400, 260), r4 = addNode('rt', 550, 160), r5 = addNode('rt', 550, 360);
  [[pc1, r1], [pc2, r2], [pc3, r4], [pc4, r5], [r1, r2], [r1, r3], [r2, r3], [r3, r4], [r3, r5], [r4, r5]].forEach(p => addLink(p[0].id, p[1].id));
  addLink(r1.id, r4.id, 45); // congested direct link: fewer hops, higher delay
  sel = null; connectFrom = null;
  fillSelects(pc1.id, pc4.id);
  invalidate();
}

// ---------- canvas rendering ----------
function drawGrid() {
  const g = $('gridLayer'); g.innerHTML = '';
  for (let x = 0; x <= W; x += 40) el('line', { x1: x, y1: 0, x2: x, y2: H, class: 'grid-line' }, g);
  for (let y = 0; y <= H; y += 40) el('line', { x1: 0, y1: y, x2: W, y2: y, class: 'grid-line' }, g);
}
function routeLinkSet() {
  const s = new Set();
  if (route) for (let i = 0; i < route.path.length - 1; i++) { const l = linkOf(route.path[i], route.path[i + 1]); if (l) s.add(l.id); }
  return s;
}
function render() {
  linkLayer.innerHTML = ''; nodeLayer.innerHTML = '';
  const onR = routeLinkSet(), nodeOnR = new Set(route ? route.path : []);
  const srcId = $('src').value, dstId = $('dst').value;
  const ordered = links.slice().sort((a, b) => onR.has(a.id) - onR.has(b.id));
  for (const l of ordered) {
    const A = byId(l.a), B = byId(l.b);
    const cls = 'link' + (onR.has(l.id) ? ' link-route' : '') + (sel && sel.kind === 'link' && sel.id === l.id ? ' link-sel' : '');
    const g = el('g', { class: cls, 'data-link': l.id }, linkLayer);
    el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'link-hit' }, g);
    el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'link-line' }, g);
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, label = String(l.w);
    const pw = 12 + label.length * 7.5;
    el('rect', { x: mx - pw / 2, y: my - 10, width: pw, height: 20, rx: 10, class: 'w-pill' }, g);
    const t = el('text', { x: mx, y: my, class: 'w-text' }, g); t.textContent = label;
  }
  for (const n of nodes) {
    const cls = 'node ' + n.type + (nodeOnR.has(n.id) ? ' onroute' : '') + (sel && sel.kind === 'node' && sel.id === n.id ? ' sel' : '') + (connectFrom === n.id ? ' pending' : '');
    const g = el('g', { class: cls, 'data-node': n.id, transform: `translate(${n.x},${n.y})` }, nodeLayer);
    if (n.type === 'pc') {
      el('rect', { x: -R, y: -R, width: R * 2, height: R * 2, rx: 9, class: 'body' }, g);
      el('rect', { x: -12, y: -11, width: 24, height: 16, rx: 2, class: 'icon' }, g);
      el('path', { d: 'M-6 12H6M0 5v7', class: 'icon' }, g);
    } else {
      el('circle', { r: R, class: 'body' }, g);
      el('path', { d: 'M-11 0H11M-11 0l4-4M-11 0l4 4M11 0l-4-4M11 0l-4 4M0 -11V11M0 -11l-4 4M0 -11l4 4M0 11l-4-4M0 11l4-4', class: 'icon' }, g);
    }
    const lab = el('text', { x: 0, y: R + 17, class: 'node-label' }, g); lab.textContent = n.name;
    if (n.type === 'pc' && (n.id === srcId || n.id === dstId)) {
      const isSrc = n.id === srcId;
      el('circle', { cx: R - 3, cy: -R + 3, r: 9, class: isSrc ? 'badge-bg-src' : 'badge-bg-dst' }, g);
      const bt = el('text', { x: R - 3, y: -R + 3, class: 'badge' }, g); bt.textContent = isSrc ? 'S' : 'D';
    }
  }
  svg.appendChild(packetEl);
}

function setHint() {
  const h = {
    move: 'Drag a device to move it. Tap a device or a link to edit it.',
    pc: 'Tap an empty spot on the canvas to place a computer.',
    rt: 'Tap an empty spot on the canvas to place a router.',
    connect: connectFrom ? 'Now tap the second device to finish the link.' : 'Tap a first device, then a second device, to connect them.',
    delete: 'Tap a device or a link to delete it.'
  };
  $('hint').textContent = h[mode];
}
function setMode(m) {
  mode = m; connectFrom = null;
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  setHint(); render();
}

function syncEditor() {
  const ed = $('editor'); ed.innerHTML = '';
  if (!sel) { ed.innerHTML = '<span class="muted">Nothing selected. Tap a device to rename it, or a link to change its latency.</span>'; return; }
  if (sel.kind === 'node') {
    const n = byId(sel.id); if (!n) return;
    ed.innerHTML = `<label for="nameIn">Name</label><input class="field" id="nameIn" maxlength="10" value="${esc(n.name)}"><button class="btn" id="delSel">Delete device</button>`;
    $('nameIn').addEventListener('input', e => { n.name = e.target.value.trim() || n.name; fillSelects($('src').value, $('dst').value); render(); if (route) { showResult(route); showSteps(route); } });
  } else {
    const l = links.find(x => x.id === sel.id); if (!l) return;
    ed.innerHTML = `<label for="wIn">${esc(byId(l.a).name)} – ${esc(byId(l.b).name)} latency</label><input class="field num" id="wIn" type="number" min="1" max="999" value="${l.w}"><span class="muted">ms</span><button class="btn" id="delSel">Delete link</button>`;
    $('wIn').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (v >= 1) { l.w = Math.min(999, v); l.auto = false; invalidate(true); }
    });
  }
  $('delSel').addEventListener('click', () => {
    if (sel.kind === 'node') removeNode(sel.id); else removeLink(sel.id);
    sel = null; fillSelects($('src').value, $('dst').value); invalidate();
  });
}

function fillSelects(srcPref, dstPref) {
  const list = pcs();
  for (const [id, pref] of [['src', srcPref], ['dst', dstPref]]) {
    const s = $(id); s.innerHTML = '';
    list.forEach(n => { const o = document.createElement('option'); o.value = n.id; o.textContent = n.name; s.appendChild(o); });
    if (list.some(n => n.id === pref)) s.value = pref;
  }
  if (list.length > 1 && $('src').value === $('dst').value) $('dst').value = list.find(n => n.id !== $('src').value).id;
}

// ---------- results and step table ----------
function setStatus(text, kind) { const s = $('status'); s.textContent = text; s.className = 'status' + (kind ? ' ' + kind : ''); }
function chipHtml(id) { const n = byId(id); return `<span class="chip ${n.type}">${esc(n.name)}</span>`; }
function showResult(r) {
  const box = $('result');
  if (!r) { box.innerHTML = '<p class="note">Choose two computers and press Find route. The path, hop count and delay appear here.</p>'; return; }
  const info = describeRoute(nodes, links, r.path);
  const rows = info.hops.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.from)} → ${esc(h.to)}</td><td class="r">${h.ms} ms</td></tr>`).join('');
  box.innerHTML = `
    <div class="chips" aria-label="Route">${r.path.map(chipHtml).join('<span class="arrow">→</span>')}</div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${info.hopCount}</b><span>Hops (links)</span></div>
      <div class="stat"><b>${info.linkMs} ms</b><span>Link delay</span></div>
      <div class="stat total"><b>${info.totalMs} ms</b><span>Total delay</span></div>
    </div>
    <div class="tablewrap" style="margin-top:12px"><table>
      <thead><tr><th>Hop</th><th>Link</th><th class="r">Latency</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td></td><td>Router processing (${info.routers} × ${PROC_MS} ms)</td><td class="r">${info.procMs} ms</td></tr>
        <tr><td></td><td>Total simulated delay</td><td class="r">${info.totalMs} ms</td></tr>
      </tfoot></table></div>`;
}

function showSteps(r) {
  const box = $('stepsBox');
  if (!r) { box.innerHTML = '<div class="empty">Find a route to see how the algorithm reaches it, step by step.</div>'; return; }
  const pathSet = new Set(r.path);
  const head = nodes.map(n => `<th class="${pathSet.has(n.id) ? 'pathcol' : ''}">${esc(n.name)}</th>`).join('');
  const rows = r.steps.map(s => {
    const cells = nodes.map(n => {
      const d = s.dist[n.id], p = s.prev[n.id];
      const cls = n.id === s.u ? 'pick' : (s.done[n.id] ? 'fin' : (d === Infinity ? 'inf' : ''));
      const val = d === Infinity ? '∞' : d;
      const via = (d !== Infinity && p !== undefined && byId(p)) ? `<small>via ${esc(byId(p).name)}</small>` : '';
      return `<td class="${cls}">${val}${via}</td>`;
    }).join('');
    const note = s.expand ? 'updated neighbours' : (s.u === $('dst').value ? 'destination reached' : 'host, not expanded');
    return `<tr><td>${s.n}</td><td class="nm">${esc(byId(s.u).name)}</td>${cells}<td class="tag">${note}</td></tr>`;
  }).join('');
  box.innerHTML = `<table class="steps"><thead><tr><th>Step</th><th>Settled</th>${head}<th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('stepsSub').textContent = `From ${byId(r.path[0]).name} to ${byId(r.path[r.path.length - 1]).name}: ${r.steps.length} steps, shortest cost ${r.cost} ms before router processing.`;
}

function computeRoute() {
  const s = $('src').value, d = $('dst').value;
  const fail = (msg) => { route = null; showResult(null); showSteps(null); setStatus(msg, 'bad'); render(); return null; };
  if (pcs().length < 2) return fail('Add at least two computers to send a packet.');
  if (s === d) return fail('Pick two different computers.');
  const r = dijkstra(nodes, links, s, d);
  if (!r) return fail(`No route from ${byId(s).name} to ${byId(d).name}. Connect them through routers.`);
  route = r; render(); showResult(r); showSteps(r);
  setStatus(`Shortest route found: ${r.path.map(id => byId(id).name).join(' → ')}.`, 'good');
  return r;
}
function invalidate(keepSel) {
  cancelAnim(); route = null;
  if (!keepSel) syncEditor();
  if (pcs().length >= 2 && $('src').value !== $('dst').value) computeRoute();
  else {
    showResult(null); showSteps(null); render();
    setStatus(pcs().length < 2 ? 'Add at least two computers to send a packet.' : 'Pick two different computers.', '');
  }
}

// ---------- animation ----------
function cancelAnim() {
  if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
  packetEl.style.display = 'none';
  $('sendBtn').disabled = false;
}
function sendPacket() {
  const r = computeRoute(); if (!r) return;
  cancelAnim();
  const segs = []; let t = 0;
  for (let i = 0; i < r.path.length - 1; i++) {
    const a = byId(r.path[i]), b = byId(r.path[i + 1]), w = linkOf(a.id, b.id).w;
    segs.push({ a, b, t0: t, t1: t + w }); t += w;
    if (i + 1 < r.path.length - 1) { segs.push({ a: b, b, t0: t, t1: t + PROC_MS }); t += PROC_MS; }
  }
  const total = t, D = clamp(total * 35, 1800, 5500), start = performance.now();
  $('sendBtn').disabled = true; packetEl.style.display = '';
  const from = byId($('src').value).name, to = byId($('dst').value).name;
  const info = describeRoute(nodes, links, r.path), pathNames = r.path.map(id => byId(id).name);
  function frame(now) {
    const p = Math.min(1, (now - start) / D), s = p * total;
    const seg = segs.find(x => s <= x.t1) || segs[segs.length - 1];
    const f = seg.t1 > seg.t0 ? clamp((s - seg.t0) / (seg.t1 - seg.t0), 0, 1) : 1;
    packetEl.setAttribute('transform', `translate(${seg.a.x + (seg.b.x - seg.a.x) * f},${seg.a.y + (seg.b.y - seg.a.y) * f})`);
    setStatus(`Packet ${from} → ${to} in flight: ${s.toFixed(1)} ms of ${total} ms`, '');
    if (p < 1) anim.raf = requestAnimationFrame(frame);
    else {
      anim = null; packetEl.style.display = 'none'; $('sendBtn').disabled = false;
      setStatus(`Delivered to ${to} after ${total} ms (${info.hopCount} hops).`, 'good');
      recordPacket({ from, to, path: pathNames, hops: info.hopCount, ms: info.totalMs, linkIds: info.hops.map(h => h.linkId) });
    }
  }
  anim = { raf: requestAnimationFrame(frame) };
}
function recordPacket(p) { history.push(p); if (history.length > 200) history.shift(); }

// ---------- pointer interaction ----------
function toSvg(e) {
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
svg.addEventListener('pointerdown', e => {
  const nodeEl = e.target.closest('[data-node]'), linkEl = e.target.closest('[data-link]');
  const pt = toSvg(e);
  if (mode === 'pc' || mode === 'rt') {
    if (nodeEl) return;
    const n = addNode(mode, clamp(pt.x, R + 4, W - R - 4), clamp(pt.y, R + 4, H - R - 24));
    sel = { kind: 'node', id: n.id }; fillSelects($('src').value, $('dst').value); invalidate(); return;
  }
  if (mode === 'connect') {
    if (!nodeEl) { connectFrom = null; setHint(); render(); return; }
    const id = nodeEl.dataset.node;
    if (!connectFrom) { connectFrom = id; setHint(); render(); return; }
    if (connectFrom === id) { connectFrom = null; setHint(); render(); return; }
    const l = addLink(connectFrom, id);
    connectFrom = null; setHint();
    if (l) { sel = { kind: 'link', id: l.id }; invalidate(); } else { setStatus('Those two devices are already connected.', 'bad'); render(); }
    return;
  }
  if (mode === 'delete') {
    if (nodeEl) { removeNode(nodeEl.dataset.node); sel = null; fillSelects($('src').value, $('dst').value); invalidate(); }
    else if (linkEl) { removeLink(linkEl.dataset.link); sel = null; invalidate(); }
    return;
  }
  if (nodeEl) {
    const n = byId(nodeEl.dataset.node);
    sel = { kind: 'node', id: n.id };
    drag = { id: n.id, dx: pt.x - n.x, dy: pt.y - n.y, moved: false };
    svg.setPointerCapture(e.pointerId); syncEditor(); render();
  } else if (linkEl) { sel = { kind: 'link', id: linkEl.dataset.link }; syncEditor(); render(); }
  else { sel = null; syncEditor(); render(); }
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  const pt = toSvg(e), n = byId(drag.id);
  if (!drag.moved) { drag.moved = true; cancelAnim(); }
  n.x = Math.round(clamp(pt.x - drag.dx, R + 4, W - R - 4));
  n.y = Math.round(clamp(pt.y - drag.dy, R + 4, H - R - 24));
  links.forEach(l => { if (l.auto && (l.a === n.id || l.b === n.id)) l.w = autoW(byId(l.a), byId(l.b)); });
  render();
});
function endDrag() {
  if (!drag) return;
  const moved = drag.moved; drag = null;
  if (moved) { route = null; computeRoute(); }
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

// ---------- dashboard ----------
function renderDashboard() {
  const P = pcs(), Rt = nodes.filter(n => n.type === 'rt');
  const avgLink = links.length ? (links.reduce((a, l) => a + l.w, 0) / links.length) : 0;

  // all-pairs delay between computers
  const cell = {}; let reach = 0, pairs = 0;
  for (const a of P) for (const b of P) {
    if (a.id === b.id) continue;
    const r = dijkstra(nodes, links, a.id, b.id), key = a.id + '|' + b.id;
    cell[key] = r ? describeRoute(nodes, links, r.path) : null;
    if (a.id < b.id) { pairs++; if (r) reach++; }
  }
  const vals = Object.values(cell).filter(Boolean).map(x => x.totalMs), maxV = Math.max(1, ...vals), minV = Math.min(...vals, Infinity);
  const delays = history.map(h => h.ms), avgDelay = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;

  $('kpis').innerHTML = [
    ['Computers', P.length, `${Rt.length} routers`],
    ['Links', links.length, `avg ${avgLink.toFixed(1)} ms each`],
    ['Reachable pairs', `${reach}/${pairs}`, 'computer to computer'],
    ['Packets sent', history.length, history.length ? `avg ${avgDelay.toFixed(1)} ms` : 'none yet'],
    ['Lowest delay', vals.length ? minV + ' ms' : '-', vals.length ? `highest ${Math.max(...vals)} ms` : 'no routes'],
  ].map((k, i) => `<div class="kpi${i === 3 && history.length ? ' hot' : ''}"><span>${k[0]}</span><b>${k[1]}</b><small>${k[2]}</small></div>`).join('');

  // matrix
  if (P.length < 2) $('matrix').innerHTML = '<div class="empty">Add at least two computers to see delays between them.</div>';
  else {
    const head = P.map(n => `<th>${esc(n.name)}</th>`).join('');
    const rows = P.map(a => `<tr><td class="nm"><b>${esc(a.name)}</b></td>` + P.map(b => {
      if (a.id === b.id) return '<td class="inf">-</td>';
      const c = cell[a.id + '|' + b.id];
      if (!c) return '<td class="na">no route</td>';
      const pct = vals.length > 1 ? Math.round(((c.totalMs - minV) / (maxV - minV || 1)) * 55) : 0;
      return `<td style="background:color-mix(in srgb, var(--route) ${pct}%, var(--panel))">${c.totalMs} ms<small>${c.hopCount} hops</small></td>`;
    }).join('') + '</tr>').join('');
    $('matrix').innerHTML = `<table class="matrix"><thead><tr><th>From \\ To</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  // degree bars
  const deg = n => links.filter(l => l.a === n.id || l.b === n.id).length;
  const maxD = Math.max(1, ...nodes.map(deg));
  $('degree').innerHTML = nodes.length ? nodes.slice().sort((a, b) => deg(b) - deg(a)).map(n =>
    `<div class="bar"><span class="lbl">${esc(n.name)}</span><span class="track"><span class="fill ${n.type}" style="display:block;width:${deg(n) / maxD * 100}%"></span></span><span class="val">${deg(n)}</span></div>`).join('')
    : '<div class="empty">No devices yet. Add some on the Simulator tab.</div>';

  // history chart + table
  const recent = history.slice(-12);
  if (!recent.length) {
    $('histChart').innerHTML = '<div class="empty">No packets sent yet. Open the Simulator tab, choose two computers and press Send packet.</div>';
    $('histTable').innerHTML = '';
  } else {
    const top = Math.max(10, Math.ceil(Math.max(...recent.map(h => h.ms)) / 10) * 10);
    const cw = 480, ch = 190, L = 34, B = 24, T = 14, bw = (cw - L - 8) / recent.length;
    let g = '';
    [0, 0.5, 1].forEach(f => { const y = T + (ch - T - B) * (1 - f); g += `<line class="gl" x1="${L}" x2="${cw}" y1="${y}" y2="${y}"/><text class="tick" x="${L - 6}" y="${y + 3}">${Math.round(top * f)}</text>`; });
    recent.forEach((h, i) => {
      const bh = (ch - T - B) * (h.ms / top), x = L + i * bw + bw * 0.18, w = bw * 0.64, y = ch - B - bh, last = i === recent.length - 1;
      g += `<rect class="${last ? 'bar-last' : 'bar-r'}" x="${x}" y="${y}" width="${w}" height="${bh}" rx="3"/><text class="val" x="${x + w / 2}" y="${y - 4}">${h.ms}</text><text class="xl" x="${x + w / 2}" y="${ch - 8}">#${history.length - recent.length + i + 1}</text>`;
    });
    $('histChart').innerHTML = `<svg class="chart" viewBox="0 0 ${cw} ${ch}" role="img" aria-label="Total delay of recent packets in milliseconds">${g}</svg>`;
    $('histTable').innerHTML = '<table><thead><tr><th>#</th><th>Route</th><th class="r">Hops</th><th class="r">Delay</th></tr></thead><tbody>' +
      history.slice(-5).reverse().map((h, i) => `<tr><td>${history.length - i}</td><td>${h.path.map(esc).join(' → ')}</td><td class="r">${h.hops}</td><td class="r">${h.ms} ms</td></tr>`).join('') + '</tbody></table>';
  }

  // link load
  const use = {};
  history.forEach(h => h.linkIds.forEach(id => { use[id] = (use[id] || 0) + 1; }));
  const entries = links.filter(l => use[l.id]).map(l => ({ name: byId(l.a).name + '–' + byId(l.b).name, n: use[l.id] })).sort((a, b) => b.n - a.n).slice(0, 8);
  const maxU = Math.max(1, ...entries.map(e => e.n));
  $('linkLoad').innerHTML = entries.length ? entries.map(e =>
    `<div class="bar"><span class="lbl">${esc(e.name)}</span><span class="track"><span class="fill use" style="display:block;width:${e.n / maxU * 100}%"></span></span><span class="val">${e.n}</span></div>`).join('')
    : '<div class="empty">Link usage appears after you send packets.</div>';
}

// ---------- about / team ----------
const AVATARS = ['var(--accent)', 'var(--router)', 'var(--route)', 'var(--ok)'];
const defaultInfo = {
  members: [
    { name: 'Adhiranshu Singh', reg: '24BIT0036', role: 'Team member' },
    { name: 'Lakshy Kesharwani', reg: '24BIT0066', role: 'Team member' },
    { name: 'Govind Innani', reg: '24BIT0157', role: 'Team member' }
  ]
};
let info = Object.assign({}, defaultInfo, store.get('netsim-team') || {});
function renderTeam() {
  $('team').innerHTML = info.members.filter(m => m.name.trim()).map((m, i) => {
    const ini = m.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="member"><div class="avatar" style="background:${AVATARS[i % 4]}">${esc(ini)}</div><div><b>${esc(m.name)}</b><span class="reg">${esc(m.reg)}</span><span>${esc(m.role)}</span></div></div>`;
  }).join('');
}
function openTeamForm() {
  const f = $('teamForm');
  f.innerHTML = `<div class="tform">${info.members.map((m, i) => `<fieldset><legend>Member ${i + 1}</legend>
      <label>Name<input class="field" id="tfName${i}" value="${esc(m.name)}"></label>
      <label>Registration number<input class="field" id="tfReg${i}" value="${esc(m.reg)}"></label>
      <label>Role<input class="field" id="tfRole${i}" value="${esc(m.role)}"></label></fieldset>`).join('')}</div>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="tfCancel">Cancel</button></div>`;
  f.hidden = false; $('editTeam').hidden = true;
  $('tfCancel').addEventListener('click', closeTeamForm);
}
function closeTeamForm() { $('teamForm').hidden = true; $('editTeam').hidden = false; }
$('editTeam').addEventListener('click', openTeamForm);
$('teamForm').addEventListener('submit', e => {
  e.preventDefault();
  info = {
    members: info.members.map((m, i) => ({ name: $('tfName' + i).value.trim(), reg: $('tfReg' + i).value.trim(), role: $('tfRole' + i).value.trim() }))
  };
  store.set('netsim-team', info); renderTeam(); closeTeamForm();
});

// ---------- tabs ----------
const VIEWS = ['simulator', 'dashboard', 'about-team'];
function showView(name) {
  if (!VIEWS.includes(name)) name = 'simulator';
  VIEWS.forEach(v => { $('view-' + v).hidden = v !== name; });
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === name)));
  if (name === 'dashboard') renderDashboard();
  if (name === 'about-team') renderTeam();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

// ---------- wiring ----------
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('sendBtn').addEventListener('click', sendPacket);
$('findBtn').addEventListener('click', () => { cancelAnim(); computeRoute(); });
$('src').addEventListener('change', () => { cancelAnim(); computeRoute(); });
$('dst').addEventListener('change', () => { cancelAnim(); computeRoute(); });
$('sampleBtn').addEventListener('click', () => { cancelAnim(); history = []; loadSample(); setMode('move'); });
$('clearBtn').addEventListener('click', () => {
  cancelAnim(); nodes = []; links = []; history = []; counters = { pc: 0, rt: 0, id: 0, link: 0 }; sel = null; connectFrom = null;
  fillSelects(); invalidate(); setMode('move');
});
$('clearHist').addEventListener('click', () => { history = []; renderDashboard(); });

drawGrid(); loadSample(); setMode('move'); syncEditor(); renderTeam();
showView((location.hash || '').slice(1));
