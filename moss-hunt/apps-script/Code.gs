/**
 * Campus Moss Hunt — Google Sheets backend (BIOL 3160, LSUA)
 *
 * SETUP (one time, about 5 minutes):
 *  1. Create a new Google Sheet (e.g. "Moss Hunt Data").
 *  2. In the Sheet: Extensions > Apps Script. Delete what's there and paste this whole file.
 *  3. Change ADMIN_KEY below to your own secret word (this unlocks the Instructor view).
 *  4. Click Deploy > New deployment > type "Web app".
 *       Execute as: Me
 *       Who has access: Anyone
 *     Click Deploy, approve the permissions, and copy the Web app URL (ends in /exec).
 *  5. Put that URL in config.js in the GitHub repo (or send it to Claude to do it).
 *
 * The script creates three tabs automatically:
 *   Observations — one row per moss (this is your gradebook data)
 *   Thumbs       — small preview images used by the app's gallery (ignore it)
 *   Roster       — optional: paste student names in column A and LSUA emails in column B
 *                  so the Instructor view also lists students who haven't submitted.
 * Full-size photos are saved in a Google Drive folder called "Moss Hunt Photos".
 *
 * If you edit this script later: Deploy > Manage deployments > edit (pencil) >
 * Version: New version > Deploy. The URL stays the same.
 */

const ADMIN_KEY = 'change-this-secret';
const FOLDER_NAME = 'Moss Hunt Photos';

const HEADERS = ['id', 'submitted_at', 'student_name', 'email', 'species', 'common_name', 'app', 'id_confidence',
  'growth_form', 'color', 'sporophytes', 'description', 'location', 'substrate', 'light', 'moisture',
  'surface_faces', 'associated_organisms', 'why_here', 'photo_link', 'closeup_link', 'photo_file_id',
  'closeup_file_id', 'delete_token'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'data') return json_({ ok: true, observations: publicRows_() });
    if (p.action === 'thumb') return json_({ ok: true, id: p.id, data: thumb_(p.id) });
    if (p.action === 'photo') return json_({ ok: true, id: p.id, data: photo_(p.id, p.which) });
    if (p.action === 'admin') {
      if (p.key !== ADMIN_KEY) return json_({ ok: false, error: 'wrong_key' });
      return json_({ ok: true, observations: allRows_(), roster: roster_() });
    }
    return json_({ ok: true, app: 'moss-hunt' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (body.action === 'submit') return json_(submit_(body));
    if (body.action === 'delete') return json_(remove_(body));
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- actions ---------- */

function submit_(b) {
  const o = b.obs || {};
  const need = ['name', 'email', 'species', 'app', 'conf', 'form', 'color', 'sporo', 'desc', 'where', 'substrate', 'light', 'moist', 'aspect', 'why'];
  for (const k of need) if (!String(o[k] || '').trim()) return { ok: false, error: 'missing_' + k };
  if (!b.photo) return { ok: false, error: 'missing_photo' };
  const email = String(o.email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'bad_email' };

  const id = Utilities.getUuid().slice(0, 8) + Date.now().toString(36);
  const folder = folder_();
  const f1 = saveImage_(folder, b.photo, id + '_photo.jpg');
  const f2 = b.closeup ? saveImage_(folder, b.closeup, id + '_closeup.jpg') : null;

  const sh = sheet_('Observations', HEADERS);
  const clip = v => String(v == null ? '' : v).slice(0, 2000);
  sh.appendRow([id, new Date(), clip(o.name), email, clip(o.species), clip(o.common), clip(o.app), clip(o.conf),
    clip(o.form), clip(o.color), clip(o.sporo), clip(o.desc), clip(o.where), clip(o.substrate), clip(o.light),
    clip(o.moist), clip(o.aspect), clip(o.assoc), clip(o.why), f1.getUrl(), f2 ? f2.getUrl() : '', f1.getId(),
    f2 ? f2.getId() : '', clip(b.token)]);

  if (b.thumb && String(b.thumb).length < 48000) {
    sheet_('Thumbs', ['id', 'thumb']).appendRow([id, b.thumb]);
  }
  return { ok: true, id: id };
}

function remove_(b) {
  const sh = sheet_('Observations', HEADERS);
  const vals = sh.getDataRange().getValues();
  const col = name => HEADERS.indexOf(name);
  for (let r = 1; r < vals.length; r++) {
    if (String(vals[r][col('id')]) !== String(b.id)) continue;
    const isAdmin = b.key && b.key === ADMIN_KEY;
    const isOwner = b.token && String(vals[r][col('delete_token')]) === String(b.token);
    if (!isAdmin && !isOwner) return { ok: false, error: 'not_allowed' };
    [vals[r][col('photo_file_id')], vals[r][col('closeup_file_id')]].forEach(fid => {
      if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} }
    });
    sh.deleteRow(r + 1);
    const th = sheet_('Thumbs', ['id', 'thumb']);
    const tv = th.getDataRange().getValues();
    for (let i = tv.length - 1; i >= 1; i--) if (String(tv[i][0]) === String(b.id)) th.deleteRow(i + 1);
    return { ok: true };
  }
  return { ok: false, error: 'not_found' };
}

/* ---------- reads ---------- */

function rows_() {
  const sh = sheet_('Observations', HEADERS);
  const vals = sh.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const o = {};
    HEADERS.forEach((h, i) => o[h] = vals[r][i]);
    if (o.id) out.push(o);
  }
  return out;
}

function owner_(email) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(email).trim().toLowerCase(), Utilities.Charset.UTF_8);
  return d.slice(0, 6).map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function shortName_(n) {
  const parts = String(n || '').trim().split(/\s+/);
  if (!parts[0]) return 'A classmate';
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts[0];
}

function publicRows_() {
  return rows_().map(pub_);
}

function pub_(o) {
  return ({
    id: o.id, at: iso_(o.submitted_at), name: shortName_(o.student_name), owner: owner_(o.email),
    species: o.species, common: o.common_name, app: o.app, conf: o.id_confidence, form: o.growth_form, color: o.color,
    sporo: o.sporophytes, desc: o.description, where: o.location, substrate: o.substrate, light: o.light,
    moist: o.moisture, aspect: o.surface_faces, assoc: o.associated_organisms, why: o.why_here,
    hasCloseup: !!o.closeup_file_id
  });
}

function allRows_() {
  return rows_().map(o => Object.assign(pub_(o), {
    fullName: o.student_name, email: o.email, photoLink: o.photo_link, closeupLink: o.closeup_link
  }));
}

function roster_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Roster');
  if (!sh) { sh = ss.insertSheet('Roster'); sh.appendRow(['name', 'email']); return []; }
  return sh.getDataRange().getValues().slice(1)
    .filter(r => r[1]).map(r => ({ name: String(r[0]), email: String(r[1]).trim().toLowerCase() }));
}

function thumb_(id) {
  const vals = sheet_('Thumbs', ['id', 'thumb']).getDataRange().getValues();
  for (let r = 1; r < vals.length; r++) if (String(vals[r][0]) === String(id)) return vals[r][1];
  return photo_(id, 'photo');
}

function photo_(id, which) {
  const o = rows_().find(x => String(x.id) === String(id));
  if (!o) return '';
  const fid = which === 'closeup' ? o.closeup_file_id : o.photo_file_id;
  if (!fid) return '';
  const blob = DriveApp.getFileById(fid).getBlob();
  return 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ---------- helpers ---------- */

function saveImage_(folder, dataUrl, name) {
  const b64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
  return folder.createFile(blob);
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function iso_(d) { return d instanceof Date ? d.toISOString() : String(d || ''); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor (select "setup" > Run) to create the tabs and the Drive folder and approve permissions. */
function setup() {
  sheet_('Observations', HEADERS);
  sheet_('Thumbs', ['id', 'thumb']);
  roster_();
  folder_();
}
