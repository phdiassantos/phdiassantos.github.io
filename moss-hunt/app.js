(() => {
const CFG = window.MOSS_CONFIG || {};
const API = (CFG.scriptUrl || '').trim();
const TARGET = Number(CFG.target) || 3;
const POLL_MS = 20000;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
$$('.target').forEach(e => e.textContent = TARGET);

let observations = [], myOwner = '', galleryFilter = 'all', adminKey = '', adminData = null;
const charts = {}, thumbCache = {};

/* ---------- local storage (safe) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('moss_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('moss_' + k, JSON.stringify(v)); } catch (e) {} }
};
const myTokens = () => store.get('tokens', {});

/* ---------- ui helpers ---------- */
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3000); }
function status(m, k = 'info') { const s = $('#status'); if (!m) { s.classList.add('hidden'); return; } s.className = 'banner ' + k; s.textContent = m; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- api ---------- */
async function apiGet(params) {
  const u = API + '?' + new URLSearchParams(params).toString();
  const r = await fetch(u, { method: 'GET', redirect: 'follow' });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}
async function apiPost(body) {
  const r = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}

/* ---------- identity ---------- */
async function ownerHash(email) {
  const e = String(email || '').trim().toLowerCase(); if (!e) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e));
  return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function loadWho() {
  $('#sname').value = store.get('name', ''); $('#semail').value = store.get('email', '');
  myOwner = await ownerHash(store.get('email', ''));
}
$('#sname').addEventListener('change', () => store.set('name', $('#sname').value.trim()));
$('#semail').addEventListener('change', async () => { store.set('email', $('#semail').value.trim()); myOwner = await ownerHash($('#semail').value); renderAll(); });

/* ---------- tabs ---------- */
function showTab(name) {
  $$('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  $$('main > section').forEach(s => s.classList.add('hidden'));
  $('#tab-' + name).classList.remove('hidden');
  renderAll();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
$('#instrLink').addEventListener('click', e => { e.preventDefault(); $('#instrTab').classList.remove('hidden'); showTab('instructor'); window.scrollTo({ top: 0 }); });

/* ---------- form controls ---------- */
const seg = {};
$$('.seg[data-field]').forEach(sg => sg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  seg[sg.dataset.field] = b.dataset.v;
}));

function shrink(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('read')); };
    img.src = u;
  });
}
const photos = { photo1: null, photo2: null, thumb: null };
['photo1', 'photo2'].forEach(id => {
  $('#' + id).addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const pick = $(id === 'photo1' ? '#pick1' : '#pick2');
    try {
      photos[id] = await shrink(f, 1280, 0.8);
      if (id === 'photo1') photos.thumb = await shrink(f, 360, 0.6);
      pick.querySelector('span').innerHTML = `<img src="${photos[id]}" alt="preview"><br><span class="muted">Tap to change</span>`;
    } catch (err) { toast('Could not read that photo. Try another.'); }
  });
});
function resetForm() {
  $('#obsForm').reset(); Object.keys(seg).forEach(k => delete seg[k]); $$('.seg button').forEach(b => b.classList.remove('on'));
  photos.photo1 = photos.photo2 = photos.thumb = null;
  $('#pick1 span').textContent = '📷 Tap to take or choose a photo'; $('#pick2 span').textContent = '🔍 Tap to add a close-up';
}

$('#obsForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!API) { toast('The app is not connected yet. Tell Dr. Santos.'); return; }
  const name = $('#sname').value.trim(), email = $('#semail').value.trim();
  store.set('name', name); store.set('email', email);
  const miss = [];
  if (!name) miss.push('your name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) miss.push('your email');
  if (!photos.photo1) miss.push('photo');
  if (!$('#species').value.trim()) miss.push('species');
  for (const [k, l] of Object.entries({ app: 'app', conf: 'confidence', form: 'growth form', color: 'color', sporo: 'sporophytes', substrate: 'substrate', light: 'light', moist: 'moisture', aspect: 'surface direction' })) if (!seg[k]) miss.push(l);
  if (!$('#desc').value.trim()) miss.push('description');
  if (!$('#where').value.trim()) miss.push('location');
  if (!$('#why').value.trim()) miss.push('why it grows here');
  if (miss.length) { toast('Missing: ' + miss.join(', ')); if (!name || !email) window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = 'Uploading… keep this page open';
  const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const obs = { name, email, species: $('#species').value.trim(), common: $('#common').value.trim(), app: seg.app, conf: seg.conf,
    form: seg.form, color: seg.color, sporo: seg.sporo, desc: $('#desc').value.trim(), where: $('#where').value.trim(),
    substrate: seg.substrate, light: seg.light, moist: seg.moist, aspect: seg.aspect, assoc: $('#assoc').value.trim(), why: $('#why').value.trim() };
  try {
    const r = await apiPost({ action: 'submit', obs, photo: photos.photo1, closeup: photos.photo2, thumb: photos.thumb, token });
    const t = myTokens(); t[r.id] = token; store.set('tokens', t);
    if (photos.thumb) thumbCache[r.id] = photos.thumb;
    myOwner = await ownerHash(email);
    toast(`Saved: ${obs.species} ✔`); resetForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
    await refresh();
  } catch (err) {
    console.error(err);
    toast(String(err.message || '').startsWith('missing_') ? 'Something is missing. Check the form.' : 'Could not save. Check your signal and try again.');
  }
  btn.disabled = false; btn.textContent = 'Submit observation';
});

/* ---------- delete ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-del]');
  if (b) {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Delete'; }, 3000); return; }
    b.disabled = true;
    const id = b.dataset.del;
    try {
      await apiPost({ action: 'delete', id, token: myTokens()[id] || '', key: b.dataset.admin ? adminKey : '' });
      const t = myTokens(); delete t[id]; store.set('tokens', t);
      toast('Entry deleted.'); await refresh(); if (adminKey) await loadAdmin();
    } catch (err) { toast(err.message === 'not_allowed' ? 'You can only delete entries made on this phone.' : 'Could not delete. Try again.'); b.disabled = false; }
    return;
  }
  const im = e.target.closest('img[data-zoom]');
  if (im) openLightbox(im);
});
async function openLightbox(im) {
  $('#lbImg').src = im.src; $('#lbCap').textContent = im.dataset.cap || ''; $('#lightbox').classList.remove('hidden');
  if (im.dataset.full) {
    try { const j = await apiGet({ action: 'photo', id: im.dataset.full, which: im.dataset.which || 'photo' }); if (j.data && !$('#lightbox').classList.contains('hidden')) $('#lbImg').src = j.data; } catch (e) {}
  }
}
$('#lbClose').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
$('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); });

/* ---------- thumbnails (lazy) ---------- */
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); loadThumb(en.target); } });
}, { rootMargin: '200px' }) : null;
async function loadThumb(el) {
  const id = el.dataset.thumb;
  if (!thumbCache[id]) {
    try { const j = await apiGet({ action: 'thumb', id }); thumbCache[id] = j.data || ''; } catch (e) { thumbCache[id] = ''; }
  }
  if (thumbCache[id]) el.innerHTML = `<img src="${thumbCache[id]}" alt="${esc(el.dataset.alt)}" data-zoom="1" data-full="${esc(id)}" data-cap="${esc(el.dataset.cap)}">`;
  else el.textContent = 'Photo unavailable';
}
function hookThumbs(root) {
  root.querySelectorAll('[data-thumb]').forEach(el => {
    if (thumbCache[el.dataset.thumb]) loadThumb(el); else if (io) io.observe(el); else loadThumb(el);
  });
}

/* ---------- rendering ---------- */
function card(o, opts = {}) {
  const cap = `${o.species} · ${o.where}`;
  const close = o.hasCloseup ? `<button type="button" class="btn ghost" style="padding:4px 8px;font-size:.75rem" data-close="${esc(o.id)}">🔍 Close-up</button>` : '';
  const canDel = opts.admin || myTokens()[o.id];
  return `<div class="obs"><div class="ph" data-thumb="${esc(o.id)}" data-alt="${esc(o.species)}" data-cap="${esc(cap)}">Loading photo…</div><div class="body">
    <div class="sp">${esc(o.species)}</div>${o.common ? `<div class="muted" style="margin-top:-4px">${esc(o.common)}</div>` : ''}
    <div class="who">${opts.showWho ? esc(opts.admin ? (o.fullName || o.name) : o.name) + ' · ' : ''}${new Date(o.at).toLocaleDateString()} · ID via ${esc(o.app)} (${esc(o.conf)})</div>
    <div class="tags"><span>${esc(o.substrate)}</span><span>${esc(o.light)}</span><span>${esc(o.moist)}</span><span>${esc(o.form)}</span>${o.sporo === 'Y' ? '<span>sporophytes</span>' : ''}</div>
    <div>📍 ${esc(o.where)}</div>
    <details><summary class="muted">Description & ecology</summary><p style="margin:6px 0"><b>Looks like:</b> ${esc(o.desc)} (${esc(o.color)})</p><p style="margin:6px 0"><b>Why here:</b> ${esc(o.why)}</p>${o.assoc ? `<p style="margin:6px 0"><b>Growing with:</b> ${esc(o.assoc)}</p>` : ''}<p style="margin:6px 0"><b>Faces:</b> ${esc(o.aspect)}</p></details>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${close}${canDel && opts.canDel !== false ? `<button class="btn danger" data-del="${esc(o.id)}" ${opts.admin ? 'data-admin="1"' : ''}>Delete</button>` : ''}</div>
  </div></div>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-close]'); if (!b) return;
  const id = b.dataset.close; b.disabled = true; b.textContent = 'Loading…';
  try { const j = await apiGet({ action: 'photo', id, which: 'closeup' }); if (j.data) { $('#lbImg').src = j.data; $('#lbCap').textContent = 'Close-up'; $('#lightbox').classList.remove('hidden'); } }
  catch (err) { toast('Could not load the close-up.'); }
  b.disabled = false; b.textContent = '🔍 Close-up';
});

function mine() { return observations.filter(o => (myOwner && o.owner === myOwner) || myTokens()[o.id]); }
function renderProgress() {
  if (!myOwner) { $('#myProgress').innerHTML = 'Enter your name and LSUA email above to see your progress.'; return; }
  const n = mine().length, pct = Math.min(100, Math.round(n / TARGET * 100));
  $('#myProgress').innerHTML = `<div><b>${n}</b> of ${TARGET} moss observations ${n >= TARGET ? '<span class="pill ok">✔ Complete!</span>' : ''}</div><div class="prog"><div style="width:${pct}%"></div></div>
    <span class="muted">${n >= TARGET ? 'Nice work. You can keep adding mosses, since more data makes better class results.' : 'Explore campus: tree bark, sidewalks, walls, shady soil.'}</span>`;
}
function renderMine() {
  if ($('#tab-mine').classList.contains('hidden')) return;
  const os = mine();
  $('#mineList').innerHTML = os.length ? os.map(o => card(o)).join('') : '<p class="muted">Nothing yet. Go find some moss!</p>';
  hookThumbs($('#mineList'));
}
function renderGallery() {
  if ($('#tab-gallery').classList.contains('hidden')) return;
  const subs = ['all', ...new Set(observations.map(o => o.substrate))];
  $('#filters').innerHTML = subs.map(s => `<button data-f="${esc(s)}" class="${s === galleryFilter ? 'on' : ''}">${s === 'all' ? 'All' : esc(s)}</button>`).join('');
  const list = galleryFilter === 'all' ? observations : observations.filter(o => o.substrate === galleryFilter);
  const html = list.length ? list.map(o => card(o, { showWho: true })).join('') : '<p class="muted">No observations yet.</p>';
  if ($('#gallery')._html !== html) { $('#gallery').innerHTML = html; $('#gallery')._html = html; hookThumbs($('#gallery')); }
}
$('#filters').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; galleryFilter = b.dataset.f; renderGallery(); });

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function chart(id, cfg) {
  if (typeof Chart === 'undefined') return;
  if (charts[id]) { charts[id].data = cfg.data; charts[id].update(); return; }
  Chart.defaults.color = cssVar('--muted'); Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  charts[id] = new Chart(document.getElementById(id), cfg);
}
function countBar(id, all, field, cats, labels) {
  chart(id, { type: 'bar', data: { labels: labels || cats, datasets: [{ label: 'Mosses found', data: cats.map(c => all.filter(o => o[field] === c).length), backgroundColor: cssVar('--moss'), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: cssVar('--line') } }, x: { grid: { display: false } } } } });
}
function renderResults() {
  if ($('#tab-results').classList.contains('hidden')) return;
  const all = observations;
  const students = new Set(all.map(o => o.owner)).size;
  const sp = new Set(all.map(o => String(o.species).toLowerCase())).size;
  const sporoPct = all.length ? Math.round(all.filter(o => o.sporo === 'Y').length / all.length * 100) : 0;
  $('#stats').innerHTML = `<div class="stat"><b>${all.length}</b><span>moss observations</span></div><div class="stat"><b>${sp}</b><span>different species / genera</span></div><div class="stat"><b>${students}</b><span>students reporting</span></div><div class="stat"><b>${sporoPct}%</b><span>with sporophytes</span></div>`;
  countBar('chSub', all, 'substrate', ['tree bark', 'soil', 'concrete / sidewalk', 'brick / wall', 'rock', 'rotting wood', 'other'], ['Bark', 'Soil', 'Concrete', 'Brick/wall', 'Rock', 'Rotting wood', 'Other']);
  countBar('chLight', all, 'light', ['full sun', 'partial shade', 'full shade'], ['Full sun', 'Partial shade', 'Full shade']);
  countBar('chMoist', all, 'moist', ['dry', 'damp', 'wet'], ['Dry', 'Damp', 'Wet']);
  countBar('chAspect', all, 'aspect', ['N', 'E', 'S', 'W', 'flat', 'unsure'], ['N', 'E', 'S', 'W', 'Flat', 'Not sure']);
  chart('chForm', { type: 'doughnut', data: { labels: ['Upright cushion', 'Creeping mat', 'Not sure'], datasets: [{ data: ['cushion', 'mat', 'unsure'].map(f => all.filter(o => o.form === f).length), backgroundColor: [cssVar('--moss'), cssVar('--moss2'), cssVar('--line')], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  chart('chSporo', { type: 'bar', data: { labels: ['Dry', 'Damp', 'Wet'], datasets: [{ label: '% with sporophytes', data: ['dry', 'damp', 'wet'].map(k => { const s = all.filter(o => o.moist === k); return s.length ? Math.round(s.filter(o => o.sporo === 'Y').length / s.length * 100) : 0; }), backgroundColor: cssVar('--moss4'), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' }, grid: { color: cssVar('--line') } }, x: { grid: { display: false } } } } });
  const c = {}; all.forEach(o => { const k = String(o.species).toLowerCase(); c[k] = c[k] || { s: o.species, n: 0, subs: new Set() }; c[k].n++; c[k].subs.add(o.substrate); });
  const list = Object.values(c).sort((a, b) => b.n - a.n);
  $('#species').innerHTML = list.length ? `<table><tr><th>Species / genus</th><th>Times found</th><th>Substrates</th></tr>${list.map(x => `<tr><td><i>${esc(x.s)}</i></td><td>${x.n}</td><td>${esc([...x.subs].join(', '))}</td></tr>`).join('')}</table>` : 'None yet.';
}

/* ---------- instructor ---------- */
async function loadAdmin() {
  adminData = await apiGet({ action: 'admin', key: adminKey });
  renderAdmin();
}
$('#keyBtn').addEventListener('click', async () => {
  if (!API) { toast('Add the script URL to config.js first.'); return; }
  adminKey = $('#adminKey').value.trim(); if (!adminKey) return;
  $('#keyBtn').disabled = true;
  try { await loadAdmin(); sessionStorage.setItem('moss_admin', adminKey); $('#keyCard').classList.add('hidden'); $('#instrBody').classList.remove('hidden'); }
  catch (e) { toast(e.message === 'wrong_key' ? 'Wrong instructor key.' : 'Could not connect.'); adminKey = ''; }
  $('#keyBtn').disabled = false;
});
$('#instrLogout').addEventListener('click', () => { adminKey = ''; adminData = null; try { sessionStorage.removeItem('moss_admin'); } catch (e) {} $('#keyCard').classList.remove('hidden'); $('#instrBody').classList.add('hidden'); });
function renderAdmin() {
  if (!adminData) return;
  const obs = adminData.observations || [], roster = adminData.roster || [];
  const by = {};
  roster.forEach(r => by[r.email] = { name: r.name, email: r.email, obs: [], onRoster: true });
  obs.forEach(o => { const k = String(o.email).toLowerCase(); by[k] = by[k] || { name: o.fullName, email: k, obs: [] }; by[k].obs.push(o); if (!by[k].name) by[k].name = o.fullName; });
  const people = Object.values(by).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const done = people.filter(p => p.obs.length >= TARGET).length;
  $('#instrStats').innerHTML = `<div class="stat"><b>${people.filter(p => p.obs.length).length}</b><span>students who submitted</span></div><div class="stat"><b>${done}</b><span>complete (≥${TARGET})</span></div><div class="stat"><b>${obs.length}</b><span>total observations</span></div>${roster.length ? `<div class="stat"><b>${people.filter(p => !p.obs.length).length}</b><span>on roster, nothing yet</span></div>` : ''}`;
  $('#personTable').innerHTML = `<tr><th>Student</th><th>Finds</th><th>Status</th><th>Species</th><th>Last activity</th></tr>` + (people.map(p => {
    const n = p.obs.length, last = p.obs.map(o => o.at).sort().pop();
    return `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.email)}</small></td><td>${n}</td>
      <td>${n >= TARGET ? '<span class="pill ok">Complete</span>' : n ? `<span class="pill warn">${n}/${TARGET}</span>` : '<span class="pill">None</span>'}</td>
      <td>${esc([...new Set(p.obs.map(o => o.species))].join('; '))}</td><td>${last ? new Date(last).toLocaleString() : '—'}</td></tr>
      ${n ? `<tr><td colspan="5"><details><summary class="muted">Show ${n} entr${n === 1 ? 'y' : 'ies'}</summary><div class="gallery" style="margin-top:8px">${p.obs.map(o => card(o, { admin: true, showWho: true })).join('')}</div></details></td></tr>` : ''}`;
  }).join('') || '<tr><td colspan="5" class="muted">No submissions yet.</td></tr>');
  $$('#personTable details').forEach(d => d.addEventListener('toggle', () => { if (d.open) hookThumbs(d); }, { once: true }));
}
$('#dlCsv').addEventListener('click', () => {
  if (!adminData) return;
  const cols = ['fullName', 'email', 'species', 'common', 'app', 'conf', 'form', 'color', 'sporo', 'desc', 'where', 'substrate', 'light', 'moist', 'aspect', 'assoc', 'why', 'photoLink', 'closeupLink', 'at'];
  const c = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(',')].concat(adminData.observations.map(o => cols.map(k => c(o[k])).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'moss-hunt-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
});

function renderAll() { renderProgress(); renderMine(); renderResults(); renderGallery(); }

/* ---------- data loop ---------- */
let failing = 0;
async function refresh() {
  if (!API) return;
  try {
    const j = await apiGet({ action: 'data' });
    observations = (j.observations || []).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    failing = 0; status(null); renderAll();
  } catch (e) {
    failing++; if (failing >= 2) status('Can\'t reach the class data right now. Check your signal; the app keeps trying.', 'warn');
  }
}
function startPolling() {
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

/* ---------- install prompt ---------- */
let deferred = null;
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone && !store.get('installDismissed', false)) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#installCard').classList.remove('hidden');
  $('#installText').innerHTML = ios ? 'On iPhone: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.' : 'On Android: tap the browser menu (⋮), then <b>Add to Home screen</b> or <b>Install app</b>.';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').style.display = 'block'; });
$('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installCard').classList.add('hidden'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

/* ---------- boot ---------- */
(async () => {
  await loadWho();
  if (!API) { status('This app isn\'t connected to the class data yet. Dr. Santos needs to add the Google Sheet link in config.js.', 'warn'); renderAll(); return; }
  try { const k = sessionStorage.getItem('moss_admin'); if (k) { adminKey = k; $('#instrTab').classList.remove('hidden'); loadAdmin().then(() => { $('#keyCard').classList.add('hidden'); $('#instrBody').classList.remove('hidden'); }).catch(() => { adminKey = ''; }); } } catch (e) {}
  startPolling();
})();
})();
