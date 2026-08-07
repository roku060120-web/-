/**
 * 大学 出席記録システム（Google Apps Script）
 *
 * iPhoneのショートカット（時刻オートメーション 18:00）から呼ばれて、
 *   1) その日に授業があるかを判定して返す
 *   2) 「出席した授業」の選択結果を受け取ってスプレッドシートに記録する
 * ことをする Web アプリ。
 *
 * セットアップ:
 *   1) setupSpreadsheet を実行 → 新しいスプレッドシートが作られる（IDは自動保存）
 *   2) setupToken を実行 → APIトークンが発行される（ログに出る）
 *   3) デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *        次のユーザーとして実行: 自分
 *        アクセスできるユーザー: 全員
 *      → 出てきた URL をショートカットに設定
 *   4) setupDailyTrigger を実行 → 毎晩ダッシュボードを自動更新
 */

// ===== 設定 =====
const TZ      = 'Asia/Tokyo';
const WEEK_JP = ['日', '月', '火', '水', '木', '金', '土'];

const SHEET = {
  subjects: '履修科目',
  calendar: '学年暦',
  special:  '特別日程',
  changes:  '科目変更',
  records:  '出席記録',
  summary:  '履修状況'
};

// 出席記録に入る状態。ショートカットが送ってくるのは 出席/欠席 のみ、
// 公欠・遅刻はスプレッドシートで手直しする運用。
const ST = { present: '出席', absent: '欠席', excused: '公欠', late: '遅刻' };
const COUNTED = [ST.present, ST.absent, ST.excused, ST.late]; // 「実施済」に数える状態

function prop_(k)    { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

/* ===================================================================
 * Web API（ショートカットから叩く入口）
 * ================================================================= */

/**
 * GET ?action=today&date=YYYY-MM-DD&token=xxx
 *   → その日の授業一覧。授業がなければ count:0 を返すのでショートカット側は黙って終了する。
 * GET ?action=save&date=YYYY-MM-DD&attended=ラベル|ラベル&token=xxx
 *   → 出席を記録。attended に無い授業は自動で「欠席」になる。
 * GET ?action=summary&token=xxx
 *   → 履修状況のサマリー（危ない科目の一覧つき）。
 * GET ?action=missing&token=xxx
 *   → 授業があったのに未記録の日付一覧。
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!checkToken_(p.token)) return json_({ ok: false, error: 'unauthorized' });

    const dateStr = normalizeDate_(p.date) || today_();

    switch (p.action || 'today') {
      case 'today':   return json_(todayPayload_(dateStr));
      case 'save':    return json_(saveAttendance_(dateStr, splitLabels_(p.attended)));
      case 'summary': return json_(summaryPayload_());
      case 'missing': return json_({ ok: true, dates: listMissingDates_() });
      default:        return json_({ ok: false, error: 'unknown action: ' + p.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/** POST でも同じことができる（JSON body: {action, date, attended:[...], token}）。 */
function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });

    const dateStr = normalizeDate_(body.date) || today_();
    const action  = body.action || 'save';

    if (action === 'today')   return json_(todayPayload_(dateStr));
    if (action === 'summary') return json_(summaryPayload_());
    if (action === 'save') {
      const attended = Array.isArray(body.attended) ? body.attended : splitLabels_(body.attended);
      return json_(saveAttendance_(dateStr, attended));
    }
    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  const expected = prop_('API_TOKEN');
  if (!expected) throw new Error('API_TOKEN が未設定です。setupToken を実行してください');
  return String(token || '') === expected;
}

/** 「a|b|c」→ ['a','b','c']。ショートカットの「テキストを結合」の区切りに合わせる。 */
function splitLabels_(s) {
  if (!s) return [];
  return String(s).split(/[|\n]/).map(t => t.trim()).filter(t => t);
}

/* ===================================================================
 * ペイロード組み立て
 * ================================================================= */

function todayPayload_(dateStr) {
  const day = getLessonsForDate_(dateStr);
  return {
    ok:      true,
    date:    dateStr,
    youbi:   day.youbi,
    open:    day.open,
    reason:  day.reason,
    count:   day.lessons.length,
    labels:  day.lessons.map(l => l.label),   // ショートカットの「リストから選択」にそのまま渡す
    lessons: day.lessons,
    prompt:  day.lessons.length
      ? formatMD_(dateStr) + '(' + day.youbi + ') 出席した授業を選んでください'
      : ''
  };
}

function summaryPayload_() {
  const rows   = buildSummaryRows_();
  const danger = rows.filter(r => r.remaining !== '' && r.remaining <= 0);
  const warn   = rows.filter(r => r.remaining !== '' && r.remaining > 0 && r.remaining <= 2);
  return {
    ok: true,
    subjects: rows,
    text: rows.length
      ? rows.map(r => r.judge + ' ' + r.name + '　出席' + r.present + '/' + r.held +
                      (r.remaining === '' ? '' : '　あと' + r.remaining + '回休める')).join('\n')
      : '履修科目が登録されていません',
    danger: danger.map(r => r.name),
    warn:   warn.map(r => r.name)
  };
}

/* ===================================================================
 * その日の授業を計算する（ここが本体）
 *   開講期間内か → 全学休講日でないか → 曜日振替があるか
 *   → 時間割から抽出 → 科目単位の休講/補講を反映
 * ================================================================= */

function getLessonsForDate_(dateStr) {
  const date  = parseDate_(dateStr);
  let   youbi = WEEK_JP[date.getDay()];

  // 1) 開講期間内か
  const term = findTerm_(dateStr);
  if (!term) return { youbi: youbi, open: false, reason: '開講期間外', lessons: [] };

  // 2) 全学レベルの特別日程（休講日 / 曜日振替）
  const sp = findSpecial_(dateStr);
  if (sp && sp.type === '休講日') {
    return { youbi: youbi, open: false, reason: sp.memo || '全学休講日', lessons: [] };
  }
  if (sp && sp.type === '曜日振替' && sp.youbi) youbi = sp.youbi;

  // 3) 時間割から抽出
  let lessons = readSubjects_()
    .filter(s => s.youbi === youbi && termMatches_(s.term, term))
    .map(s => toLesson_(s, s.period));

  // 4) 科目単位の休講 / 補講
  readChanges_(dateStr).forEach(ch => {
    const subject = findSubject_(ch.code);
    if (ch.type === '休講') {
      lessons = lessons.filter(l => !(l.code === ch.code && (!ch.period || l.period === ch.period)));
    }
    if (ch.type === '補講' && subject) {
      lessons.push(toLesson_(subject, ch.period || subject.period, '補講'));
    }
  });

  lessons.sort((a, b) => String(a.period).localeCompare(String(b.period), 'ja', { numeric: true }));

  // ラベルは「リストから選択」の表示文字列 兼 保存時のキー。日内で重複しないよう連番を足す。
  const seen = {};
  lessons.forEach(l => {
    let label = l.label;
    if (seen[label]) label += ' #' + (++seen[l.label]);
    else seen[label] = 1;
    l.label = label;
  });

  return {
    youbi:  youbi,
    open:   true,
    reason: sp && sp.type === '曜日振替' ? (youbi + '曜日の授業を実施') : '',
    lessons: lessons
  };
}

function toLesson_(s, period, tag) {
  const time = s.start && s.end ? s.start + '-' + s.end : (s.start || '');
  const bits = [];
  if (period) bits.push(period + '限');
  bits.push(s.name);
  if (s.room) bits.push('(' + s.room + ')');
  if (tag)    bits.push('※' + tag);
  return {
    code:    s.code,
    name:    s.name,
    period:  period,
    time:    time,
    room:    s.room,
    teacher: s.teacher,
    tag:     tag || '',
    label:   bits.join(' ')
  };
}

/* ===================================================================
 * 記録する
 * ================================================================= */

/**
 * その日の出席を記録する。
 * 同じ日を再実行すると古い行を消して書き直すので、押し間違えても走らせ直せば直る。
 */
function saveAttendance_(dateStr, attendedLabels) {
  const day = getLessonsForDate_(dateStr);
  if (!day.lessons.length) {
    return { ok: true, saved: 0, text: formatMD_(dateStr) + ' は授業がありません（' + (day.reason || '対象なし') + '）' };
  }

  const attended = {};
  attendedLabels.forEach(l => { attended[String(l).trim()] = true; });

  const sh    = sheet_(SHEET.records);
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  deleteRowsForDate_(sh, dateStr);

  const rows = day.lessons.map(l => [
    dateStr, day.youbi, l.period, l.code, l.name,
    attended[l.label] ? ST.present : ST.absent,
    stamp
  ]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  invalidateCache_(SHEET.records);

  refreshDashboard();

  const nPresent = rows.filter(r => r[5] === ST.present).length;
  const nAbsent  = rows.length - nPresent;
  return {
    ok:      true,
    date:    dateStr,
    saved:   rows.length,
    present: nPresent,
    absent:  nAbsent,
    text:    formatMD_(dateStr) + ' 記録完了　出席' + nPresent + '・欠席' + nAbsent +
             (nAbsent ? '\n欠席: ' + day.lessons.filter(l => !attended[l.label]).map(l => l.name).join('、') : '')
  };
}

function deleteRowsForDate_(sh, dateStr) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (asDateStr_(col[i][0]) === dateStr) sh.deleteRow(i + 2);
  }
  invalidateCache_(SHEET.records);
}

/* ===================================================================
 * 履修状況ダッシュボード
 * ================================================================= */

function refreshDashboard() {
  const rows = buildSummaryRows_();
  const sh   = sheet_(SHEET.summary);
  sh.clear();

  const head = ['科目コード', '科目名', '開講期', '実施済', '出席', '遅刻', '公欠', '欠席',
                '出席率', '欠席上限', '残り欠席可能', '判定'];
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#e8eaed');

  if (rows.length) {
    sh.getRange(2, 1, rows.length, head.length).setValues(rows.map(r => [
      r.code, r.name, r.term, r.held, r.present, r.late, r.excused, r.absent,
      r.held ? r.rate : '', r.limit, r.remaining, r.judge
    ]));
    sh.getRange(2, 9, rows.length, 1).setNumberFormat('0.0%');
  }

  const missing = listMissingDates_();
  sh.getRange(rows.length + 3, 1).setValue(
    '未記録の日: ' + (missing.length ? missing.join(', ') : 'なし') +
    '　（最終更新 ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + '）'
  );

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, head.length);
}

function buildSummaryRows_() {
  const tally = {};
  readRecords_().forEach(r => {
    const t = tally[r.code] || (tally[r.code] = { held: 0, present: 0, absent: 0, excused: 0, late: 0 });
    if (COUNTED.indexOf(r.status) >= 0) t.held++;
    if (r.status === ST.present) t.present++;
    if (r.status === ST.absent)  t.absent++;
    if (r.status === ST.excused) t.excused++;
    if (r.status === ST.late)    t.late++;
  });

  return readSubjects_().map(s => {
    const t    = tally[s.code] || { held: 0, present: 0, absent: 0, excused: 0, late: 0 };
    const ok   = t.present + t.late + t.excused;
    const rate = t.held ? ok / t.held : 0;
    const remaining = (s.limit === '' || s.limit === null) ? '' : Number(s.limit) - t.absent;

    let judge = '✅ OK';
    if (remaining === '')      judge = '—';
    else if (remaining < 0)    judge = '❌ 欠席超過';
    else if (remaining === 0)  judge = '⚠️ 後がない';
    else if (remaining <= 2)   judge = '🟡 注意';

    return {
      code: s.code, name: s.name, term: s.term,
      held: t.held, present: t.present, late: t.late, excused: t.excused, absent: t.absent,
      rate: rate, limit: s.limit, remaining: remaining, judge: judge
    };
  });
}

/** 授業があったはずなのに1行も記録が無い日（今日まで）を探す。 */
function listMissingDates_() {
  const recorded = {};
  readRecords_().forEach(r => { recorded[r.date] = true; });

  const todayStr = today_();
  const out = [];
  readCalendar_().forEach(term => {
    const end = term.end < todayStr ? term.end : todayStr;
    for (let d = parseDate_(term.start); fmt_(d) <= end; d.setDate(d.getDate() + 1)) {
      const ds = fmt_(d);
      if (recorded[ds]) continue;
      if (getLessonsForDate_(ds).lessons.length) out.push(ds);
    }
  });
  return out;
}

/* ===================================================================
 * シート読み取り
 * ================================================================= */

function ss_() {
  const id = prop_('SHEET_ID');
  if (!id) throw new Error('SHEET_ID が未設定です。setupSpreadsheet を実行してください');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートが見つかりません: ' + name);
  return sh;
}

// 1回の実行中はシートの中身が変わらないのでキャッシュする。
// listMissingDates_ が日数ぶん getLessonsForDate_ を回すため、これが無いと
// シート読み取りが数百回走って実行時間の上限に当たる。
let _tableCache = {};
function invalidateCache_(name) {
  if (name) delete _tableCache[name]; else _tableCache = {};
}

/** ヘッダー行をキーにした連想配列の配列で返す。列の順番を変えても壊れない。 */
function readTable_(name) {
  if (_tableCache[name]) return _tableCache[name];

  const values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return (_tableCache[name] = []);

  const head = values[0].map(v => String(v).trim());
  const rows = values.slice(1)
    .filter(row => row.some(c => String(c).trim() !== ''))
    .map(row => {
      const o = {};
      head.forEach((h, i) => { if (h) o[h] = row[i]; });
      return o;
    });
  return (_tableCache[name] = rows);
}

function readSubjects_() {
  return readTable_(SHEET.subjects).map(r => ({
    code:    String(r['科目コード'] || '').trim(),
    name:    String(r['科目名'] || '').trim(),
    youbi:   String(r['曜日'] || '').trim().replace(/曜日?$/, ''),
    period:  String(r['時限'] || '').trim(),
    start:   asTimeStr_(r['開始']),
    end:     asTimeStr_(r['終了']),
    room:    String(r['教室'] || '').trim(),
    teacher: String(r['教員'] || '').trim(),
    term:    String(r['開講期'] || '').trim(),
    limit:   r['欠席上限'] === '' || r['欠席上限'] === undefined ? '' : Number(r['欠席上限'])
  })).filter(s => s.name);
}

function findSubject_(code) {
  return readSubjects_().filter(s => s.code === String(code).trim())[0] || null;
}

function readCalendar_() {
  return readTable_(SHEET.calendar).map(r => ({
    term:  String(r['開講期'] || '').trim(),
    start: asDateStr_(r['開始日']),
    end:   asDateStr_(r['終了日'])
  })).filter(t => t.start && t.end);
}

function findTerm_(dateStr) {
  return readCalendar_().filter(t => t.start <= dateStr && dateStr <= t.end)[0] || null;
}

/** 科目の開講期が、その日が属する開講期に含まれるか。空欄・通年は常にヒット。 */
function termMatches_(subjectTerm, term) {
  if (!subjectTerm || subjectTerm === '通年') return true;
  return subjectTerm === term.term;
}

function findSpecial_(dateStr) {
  return readTable_(SHEET.special)
    .map(r => ({
      date:  asDateStr_(r['日付']),
      type:  String(r['種別'] || '').trim(),
      youbi: String(r['実施曜日'] || '').trim().replace(/曜日?$/, ''),
      memo:  String(r['メモ'] || '').trim()
    }))
    .filter(r => r.date === dateStr)[0] || null;
}

function readChanges_(dateStr) {
  return readTable_(SHEET.changes)
    .map(r => ({
      date:   asDateStr_(r['日付']),
      code:   String(r['科目コード'] || '').trim(),
      type:   String(r['種別'] || '').trim(),
      period: String(r['時限'] || '').trim(),
      memo:   String(r['メモ'] || '').trim()
    }))
    .filter(r => r.date === dateStr && r.code);
}

function readRecords_() {
  return readTable_(SHEET.records).map(r => ({
    date:   asDateStr_(r['日付']),
    code:   String(r['科目コード'] || '').trim(),
    name:   String(r['科目名'] || '').trim(),
    status: String(r['状態'] || '').trim()
  })).filter(r => r.date && r.code);
}

/* ===================================================================
 * 日付・時刻ユーティリティ
 * ================================================================= */

function fmt_(date)      { return Utilities.formatDate(date, TZ, 'yyyy-MM-dd'); }
function today_()        { return fmt_(new Date()); }
function parseDate_(s)   { return new Date(s + 'T12:00:00+09:00'); }
function formatMD_(s)    { const d = parseDate_(s); return (d.getMonth() + 1) + '/' + d.getDate(); }

/** セルの値（Dateでも文字列でも）を yyyy-MM-dd に揃える。 */
function asDateStr_(v) {
  if (v instanceof Date) return fmt_(v);
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function normalizeDate_(v) { return asDateStr_(v); }

/** セルの値を HH:mm に揃える。 */
function asTimeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  return String(v || '').trim();
}

/* ===================================================================
 * セットアップ（最初に1回ずつ実行する）
 * ================================================================= */

/** 新しいスプレッドシートを作り、シート構成とサンプル行を用意する。 */
function setupSpreadsheet() {
  const existing = prop_('SHEET_ID');
  if (existing) {
    Logger.log('すでに作成済みです: ' + SpreadsheetApp.openById(existing).getUrl());
    Logger.log('作り直したい場合はスクリプトプロパティ SHEET_ID を削除してから再実行してください');
    return;
  }

  const ss = SpreadsheetApp.create('大学 出席記録');
  ss.setSpreadsheetTimeZone(TZ);

  const defs = [
    [SHEET.subjects, ['科目コード', '科目名', '曜日', '時限', '開始', '終了', '教室', '教員', '開講期', '欠席上限'], [
      ['LIN101', '線形代数I',      '月', '2', '10:40', '12:10', 'A302', '山田', '前期', 4],
      ['ENG201', '英語コミュニケーション', '火', '1', '9:00',  '10:30', 'B105', 'Smith', '通年', 3],
      ['PRG110', 'プログラミング演習', '水', '3', '13:00', '14:30', '情報室', '佐藤', '前期', 4]
    ]],
    [SHEET.calendar, ['開講期', '開始日', '終了日'], [
      ['前期', '2026-04-06', '2026-07-31'],
      ['後期', '2026-09-24', '2027-01-30']
    ]],
    [SHEET.special, ['日付', '種別', '実施曜日', 'メモ'], [
      ['2026-04-29', '休講日', '', '昭和の日'],
      ['2026-05-07', '曜日振替', '月', '月曜授業を実施']
    ]],
    [SHEET.changes, ['日付', '科目コード', '種別', '時限', 'メモ'], [
      ['2026-05-13', 'PRG110', '休講', '3', '教員都合'],
      ['2026-05-20', 'PRG110', '補講', '5', '振替の補講']
    ]],
    [SHEET.records, ['日付', '曜日', '時限', '科目コード', '科目名', '状態', '記録日時'], []],
    [SHEET.summary, ['科目コード', '科目名', '開講期', '実施済', '出席', '遅刻', '公欠', '欠席',
                     '出席率', '欠席上限', '残り欠席可能', '判定'], []]
  ];

  defs.forEach(([name, head, samples], i) => {
    const sh = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setBackground('#e8eaed');
    if (samples.length) {
      sh.getRange(2, 1, samples.length, head.length).setValues(samples);
    }
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, head.length);
  });

  setProp_('SHEET_ID', ss.getId());
  Logger.log('スプレッドシートを作成しました:\n' + ss.getUrl());
  Logger.log('※ サンプル行はダミーです。自分の時間割に書き換えてください');
}

/** ショートカットから叩くための合言葉を発行する。 */
function setupToken() {
  let token = prop_('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    setProp_('API_TOKEN', token);
  }
  Logger.log('API_TOKEN = ' + token);
  Logger.log('この値をショートカットの token パラメータに設定してください');
}

/** 毎晩23:30に履修状況を再集計する。 */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'refreshDashboard') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshDashboard')
    .timeBased().atHour(23).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  Logger.log('毎晩23:30のダッシュボード自動更新をONにしました');
}

/* ===================================================================
 * 動作確認（エディタから直接実行する用）
 * ================================================================= */

function testToday()            { Logger.log(JSON.stringify(todayPayload_(today_()), null, 2)); }
function testDate_(dateStr)     { Logger.log(JSON.stringify(todayPayload_(normalizeDate_(dateStr)), null, 2)); }
function testSummary()          { Logger.log(summaryPayload_().text); }
function testMissing()          { Logger.log(listMissingDates_().join('\n') || '未記録なし'); }

/** ショートカットに入れるURLをまとめて出す。デプロイ後に実行すること。 */
function showShortcutUrls() {
  const url   = ScriptApp.getService().getUrl();
  const token = prop_('API_TOKEN');
  if (!url)   { Logger.log('まだウェブアプリとしてデプロイされていません'); return; }
  if (!token) { Logger.log('先に setupToken を実行してください'); return; }
  Logger.log('今日の授業を取得:\n' + url + '?action=today&token=' + token);
  Logger.log('\n記録（attended は「テキストを結合」で | 区切りにしたもの）:\n' +
             url + '?action=save&token=' + token + '&attended=');
  Logger.log('\n履修状況:\n' + url + '?action=summary&token=' + token);
}
