/**
 * workout-app 동기화·PC로 보내기 받는 곳 (구글 Apps Script, D-023·D-027·D-028·D-032).
 * 이 파일 + src/core/syncMerge.ts(형식만 지운 것)를 tools/gas/build.ts가 합쳐 tools/gas/Code.gs를 만든다.
 * __INBOX_ID__·__EXEC_URL__ 는 빌드 때 tools/gas/local.json(저장소에 안 올림)에서 채운다.
 * 키는 스크립트 속성 KEY에만. 막으려면 setup()을 다시 실행해 키를 바꾸면 됨.
 */
var INBOX_ID = '__INBOX_ID__'; // 내 드라이브/WORK_OUT_APP/sync/inbox
var EXEC_URL = '__EXEC_URL__';
var MAX_CHARS = 3 * 1024 * 1024;
var MAX_SYNC_CHARS = 8 * 1024 * 1024;
var DAILY_MAX = 50;
var SNAPSHOTS = 7;

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (body.length > MAX_SYNC_CHARS) return out_({ ok: false, error: 'too_big' });
    var j; try { j = JSON.parse(body); } catch (x) { j = null; }
    // D-058: 아이폰 단축어는 폼(a=b&c=d)으로 보낼 수도 있음 → 애플워치 받기만 폼 허용
    if (!j) { j = HealthIngest.readHealthBody(body, (e && e.parameter) || undefined); if (!j || (j.op !== 'health' && !j.kind)) return out_({ ok: false, error: 'not_json' }); }
    // D-061: AI 가 만든 단축어는 Key·OP·Kind·키·종류 처럼 보낼 수 있음 → 맨 위 칸 이름만 고침
    if (j && typeof j === 'object' && !Array.isArray(j)) j = HealthIngest.normalizeTop(j);
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || !j || j.key !== key) return out_({ ok: false, error: 'bad_key' });
    if (j.op === 'health' || (!j.op && j.kind && !j.file)) return out_(health_(j));
    if (j.op === 'sync') return out_(sync_(j));
    if (j.op === 'replace') return out_(replace_(j));
    if (j.ping) return out_({ ok: true, ping: true });
    if (body.length > MAX_CHARS) return out_({ ok: false, error: 'too_big' });
    return out_(inbox_(j));
  } catch (err) {
    console.error('doPost 오류: ' + (err && err.stack || err)); // 편집기 → 실행 기록에서 원인 확인
    return out_({ ok: false, error: 'server' });
  }
}

/** PC로 보내기(파일): 받은 백업을 inbox에 파일로 (쓰기만) */
function inbox_(j) {
  var f = j.file;
  if (!f || f.app !== 'workout-app' || typeof f.schema !== 'number' || !f.data) return { ok: false, error: 'not_backup' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var day = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
    var n = Number(props.getProperty('C_' + day) || 0);
    if (n >= DAILY_MAX) return { ok: false, error: 'daily_limit' };
    props.setProperty('C_' + day, String(n + 1));
  } finally { lock.releaseLock(); }
  var dev = String((f.device && f.device.id) || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 12);
  var name = 'auto-' + dev + '-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000) + '.json';
  DriveApp.getFolderById(INBOX_ID).createFile(name, JSON.stringify(f), 'application/json');
  return { ok: true, name: name };
}

// ---------- 양방향 동기화 저장소: WORK_OUT_APP/sync/db/records.json ----------
function dbFolder_() {
  var sync = DriveApp.getFolderById(INBOX_ID).getParents().next();
  var it = sync.getFoldersByName('db');
  return it.hasNext() ? it.next() : sync.createFolder('db');
}
/** 기록 파일은 ID로 찾음 (같은 이름 사본·휴지통 파일이 섞이지 않게). ID가 없으면 이름으로 한 번 찾아 저장 */
function load_(folder) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_FILE');
  var file = null;
  if (id) { try { file = DriveApp.getFileById(id); if (file.isTrashed()) file = null; } catch (x) { file = null; } }
  if (!file) {
    var it = folder.getFilesByName('records.json');
    while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) { file = f; break; } }
    if (file) props.setProperty('DB_FILE', file.getId());
  }
  if (!file) return { file: null, state: SyncMerge.emptyState() };
  return { file: file, state: JSON.parse(file.getBlob().getDataAsString()) };
}
var WARN_BYTES = 8 * 1024 * 1024;
function save_(folder, file, state) {
  var s = JSON.stringify(state);
  if (s.length > WARN_BYTES) console.warn('기록 파일이 커요: ' + s.length + '자 (한도 전에 오래된 진단·지움 표시 정리 필요)');
  if (file) file.setContent(s);
  else { var nf = folder.createFile('records.json', s, 'application/json'); PropertiesService.getScriptProperties().setProperty('DB_FILE', nf.getId()); }
}
/** 하루 한 번 스냅숏, 최근 SNAPSHOTS개만 (D-032) */
function snapshot_(folder, file) {
  if (!file) return;
  var name = 'records-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd') + '.json';
  if (folder.getFilesByName(name).hasNext()) return;
  file.makeCopy(name, folder);
  var list = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (/^records-\d{8}\.json$/.test(f.getName())) list.push(f); }
  list.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  for (var i = SNAPSHOTS; i < list.length; i++) list[i].setTrashed(true);
}
/** 번호 힌트(epoch:rev): 바뀐 것도 보낼 것도 없으면 드라이브를 읽지 않고 답함. 쓰는 동안은 pending */
function hint_() { return PropertiesService.getScriptProperties().getProperty('HINT'); }
function setHint_(v) { PropertiesService.getScriptProperties().setProperty('HINT', v); }

function sync_(req) {
  var h = hint_();
  // healthSince 가 since 보다 뒤처져 있으면(애플워치 기록을 아직 다 못 받음) 바로 답하지 않고 읽음 (D-058)
  var healthBehind = typeof req.healthSince === 'number' && req.healthSince !== req.since;
  if ((!req.muts || !req.muts.length) && !healthBehind && h && h !== 'pending' && h === req.epoch + ':' + req.since) {
    return { ok: true, epoch: req.epoch, rev: req.since, results: [], changes: [] };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var folder = dbFolder_();
    var loaded = load_(folder);
    var state = loaded.state;
    snapshot_(folder, loaded.file);
    var before = state.rev, epochBefore = state.epoch;
    var resp = SyncMerge.handleSync(state, req, Date.now());
    // D-059: 올라온 운동(끝남·지움)의 애플워치 요약을 다시 계산. 바뀌면 응답 rev 와 health 를 다시 채움 (옛 앱에는 health 를 넣지 않음)
    var wids = (req.muts || []).filter(function (m) { return m.table === 'workouts'; }).map(function (m) { return m.id; });
    if (resp.ok && wids.length && HealthIngest.afterWorkoutMuts(state, wids, Date.now())) {
      resp.rev = state.rev;
      if (typeof req.healthSince === 'number') resp.health = SyncMerge.changesSince(state, req.full || resp.full ? 0 : req.healthSince).filter(function (r) { return r.table === 'health'; });
    }
    if (state.rev !== before || state.epoch !== epochBefore || !loaded.file) {
      setHint_('pending');
      save_(folder, loaded.file, state);
    }
    setHint_(state.epoch + ':' + state.rev);
    return resp;
  } finally { lock.releaseLock(); }
}

/** D-058 애플워치(아이폰 단축어) 받기: 같은 키, 기록 파일의 health 표에 씀 → 다음 동기화로 앱에 전달 */
function health_(j) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var folder = dbFolder_();
    var loaded = load_(folder);
    var state = loaded.state;
    snapshot_(folder, loaded.file);
    var r = HealthIngest.ingestHealth(state, j, Date.now());
    debugShape_(folder, j, r);
    if (!r.ok) return r;
    setHint_('pending');
    save_(folder, loaded.file, state);
    setHint_(state.epoch + ':' + state.rev);
    return r;
  } finally { lock.releaseLock(); }
}

/** 진단: 단축어가 보낸 모양을 드라이브 db 폴더 health_debug.json 에 남김 (키는 빼고, 값은 앞 400자만). 마지막 1건만 덮어씀 */
function debugShape_(folder, j, r) {
  try {
    var shape = {};
    Object.keys(j || {}).forEach(function (k) {
      if (/^key$/i.test(k)) return;
      var v = j[k];
      var t = Array.isArray(v) ? 'array' : typeof v;
      var s = typeof v === 'string' ? v : JSON.stringify(v);
      shape[k] = { type: t, length: s ? s.length : 0, head: s ? s.slice(0, 400) : '' };
    });
    var text = JSON.stringify({ at: new Date().toISOString(), result: { ok: r && r.ok, received: r && r.received, skipped: r && r.skipped, hint: r && r.hint }, fields: shape }, null, 2);
    var it = folder.getFilesByName('health_debug.json');
    if (it.hasNext()) it.next().setContent(text); else folder.createFile('health_debug.json', text, 'application/json');
  } catch (e) { /* 진단 실패는 무시 */ }
}

/** "서버까지 이 백업으로 바꾸기": 먼저 스냅숏, epoch를 올려 다른 기기가 다시 받게 (rev는 줄지 않음) */
function replace_(req) {
  if (!Array.isArray(req.recs)) return { ok: false, error: 'not_backup' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var folder = dbFolder_();
    var loaded = load_(folder);
    if (loaded.file) {
      loaded.file.makeCopy('records-before-replace-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss') + '.json', folder);
      // 바꾸기 전 사본은 최근 3개만
      var list = [], it2 = folder.getFiles();
      while (it2.hasNext()) { var f2 = it2.next(); if (/^records-before-replace-/.test(f2.getName())) list.push(f2); }
      list.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
      for (var i = 3; i < list.length; i++) list[i].setTrashed(true);
    }
    var state = SyncMerge.replaceState(loaded.state, req.recs, Array.isArray(req.tables) ? req.tables.map(String) : undefined);
    setHint_('pending');
    save_(folder, loaded.file, state);
    setHint_(state.epoch + ':' + state.rev);
    return { ok: true, epoch: state.epoch, rev: state.rev };
  } finally { lock.releaseLock(); }
}

/** (편집기에서 직접 실행) 스냅숏으로 되돌리기: 예) restoreSnapshot('20261001') */
function restoreSnapshot(yyyymmdd) {
  var folder = dbFolder_();
  var it = folder.getFilesByName('records-' + yyyymmdd + '.json');
  if (!it.hasNext()) throw new Error('스냅숏 없음: ' + yyyymmdd);
  var snap = JSON.parse(it.next().getBlob().getDataAsString());
  var recs = Object.keys(snap.recs).map(function (k) { return snap.recs[k]; });
  return replace_({ recs: recs });
}

/** 처음 한 번(배포 뒤) 실행: 새 키를 만들고, 폰에 넣을 주소와 키를 sync/설정.txt 에 씀. 폰에 넣은 뒤 이 파일은 지움 */
function setup() {
  var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('KEY', key);
  var sync = DriveApp.getFolderById(INBOX_ID).getParents().next();
  var old = sync.getFilesByName('설정.txt');
  while (old.hasNext()) old.next().setTrashed(true);
  sync.createFile('설정.txt', 'workout-app 자동 보내기·동기화 설정 (폰·PC 앱에 붙여넣은 뒤 이 파일을 지우고 휴지통도 비우세요)\n' + EXEC_URL + '#' + key + '\n', 'text/plain');
}
