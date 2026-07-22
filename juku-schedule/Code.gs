/**
 * 塾スケジュール一元化 — Google Apps Script
 * -------------------------------------------------
 * ① 担当マスター / ② 例外 から、③ 今日の授業・④ 週間ビューを自動生成し、
 * 必要に応じて Discord に「今日の授業」を自動投稿する。
 *
 * 使い方は「セットアップ手順.md」を参照。
 */

// ===== 設定（ここだけ書き換える） ==========================================
var CONFIG = {
  // Discord の Webhook URL（チャンネル設定 → 連携サービス → ウェブフックで作成）
  DISCORD_WEBHOOK_URL: '',          // 例: 'https://discord.com/api/webhooks/xxx/yyy'
  TIMEZONE: 'Asia/Tokyo',
  // 隔週の割り当て：A週 = ISO週番号が奇数、B週 = 偶数（塾の運用に合わせて入れ替え可）
  BIWEEKLY_ODD_LABEL: 'A週'
};

var SHEET = {
  MASTER: '① 担当マスター',
  EXC:    '② 例外',
  TODAY:  '③ 今日の授業',
  WEEK:   '④ 週間ビュー'
};

var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']; // getDay() の順

// ===== メニュー ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('塾スケジュール')
    .addItem('今日の授業を生成', 'generateToday')
    .addItem('週間ビューを更新', 'buildWeekly')
    .addSeparator()
    .addItem('今日の授業を Discord に投稿', 'postTodayToDiscord')
    .addSeparator()
    .addItem('毎朝6時の自動投稿をON', 'setupDailyTrigger')
    .addToUi();
}

// ===== 共通ユーティリティ ==================================================
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function readRows_(sheetName, firstDataRow) {
  var sh = ss_().getSheetByName(sheetName);
  var last = sh.getLastRow();
  if (last < firstDataRow) return [];
  var width = sh.getLastColumn();
  return sh.getRange(firstDataRow, 1, last - firstDataRow + 1, width).getValues();
}

/** 日付を yyyy-MM-dd 文字列に（Date でも文字列でも受ける） */
function dstr_(v) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  var d = new Date(v);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return String(v).trim();
}

/** 時刻を HH:mm 文字列に（時刻セルでも "17:00" でも受ける） */
function tstr_(v) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, CONFIG.TIMEZONE, 'HH:mm');
  }
  return String(v).trim();
}

/** 時刻文字列を並べ替え用の分に */
function toMin_(hhmm) {
  var m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9999;
}

/** ISO週番号 */
function isoWeek_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** その日付が A週/B週 のどちらか */
function biweeklyLabel_(date) {
  var odd = isoWeek_(date) % 2 === 1;
  if (odd) return CONFIG.BIWEEKLY_ODD_LABEL;
  return CONFIG.BIWEEKLY_ODD_LABEL === 'A週' ? 'B週' : 'A週';
}

// ===== 今日の授業を計算 ====================================================
/**
 * 指定日の授業リストを返す（③生成・Discord投稿の共通ロジック）
 * 戻り値: [{曜日,開始,終了,講師,生徒,教科,場所,種別,備考}, ...]（開始順）
 */
function computeLessons_(date) {
  var dstr = Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var dow = WEEKDAYS[date.getDay()];
  var week = biweeklyLabel_(date);

  var master = readRows_(SHEET.MASTER, 3);   // 講師,生徒,曜日,開始,終了,教科,場所,隔週,有効開始,有効終了,備考
  var exc = readRows_(SHEET.EXC, 3);         // 日付,種別,講師,生徒,教科,開始,終了,場所,備考

  // 例外の索引
  var cancels = {};   // key: 講師|生徒 → true（その日の休講）
  var adds = [];      // その日の追加/振替
  exc.forEach(function (r) {
    if (dstr_(r[0]) !== dstr) return;
    var kind = String(r[1] || '').trim();
    if (kind === '休講') {
      cancels[String(r[2]).trim() + '|' + String(r[3]).trim()] = true;
    } else if (kind === '振替' || kind === '追加') {
      adds.push({
        曜日: dow, 開始: tstr_(r[5]), 終了: tstr_(r[6]),
        講師: String(r[2]).trim(), 生徒: String(r[3]).trim(),
        教科: String(r[4]).trim(), 場所: String(r[7]).trim(),
        種別: kind, 備考: String(r[8] || '').trim()
      });
    }
  });

  var out = [];
  master.forEach(function (r) {
    if (!r[0] || !r[2]) return;               // 講師・曜日が空ならスキップ
    if (String(r[2]).trim() !== dow) return;  // 曜日不一致
    // 有効期間
    var s = dstr_(r[8]), e = dstr_(r[9]);
    if (s && s > dstr) return;
    if (e && e < dstr) return;
    // 隔週
    var bi = String(r[7] || '毎週').trim();
    if (bi && bi !== '毎週' && bi !== week) return;
    // 休講で消えていないか
    if (cancels[String(r[0]).trim() + '|' + String(r[1]).trim()]) return;
    out.push({
      曜日: dow, 開始: tstr_(r[3]), 終了: tstr_(r[4]),
      講師: String(r[0]).trim(), 生徒: String(r[1]).trim(),
      教科: String(r[5]).trim(), 場所: String(r[6]).trim(),
      種別: '', 備考: String(r[10] || '').trim()
    });
  });

  out = out.concat(adds);
  out.sort(function (a, b) { return toMin_(a.開始) - toMin_(b.開始); });
  return out;
}

// ===== ③ 今日の授業を書き出し =============================================
function generateToday() {
  var sh = ss_().getSheetByName(SHEET.TODAY);
  var lessons = computeLessons_(new Date());
  // 既存データをクリア（3行目以降）
  if (sh.getLastRow() >= 3) {
    sh.getRange(3, 1, sh.getLastRow() - 2, 9).clearContent();
  }
  var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'M/d(E)');
  sh.getRange(1, 1).setValue('③ 今日の授業　' + today + '　（自動生成）');
  if (lessons.length === 0) {
    sh.getRange(3, 1).setValue('本日の授業はありません');
    return;
  }
  var rows = lessons.map(function (l) {
    return [l.曜日, l.開始, l.終了, l.講師, l.生徒, l.教科, l.場所, l.種別, l.備考];
  });
  sh.getRange(3, 1, rows.length, 9).setValues(rows);
}

// ===== ④ 週間ビューを書き出し =============================================
function buildWeekly() {
  var sh = ss_().getSheetByName(SHEET.WEEK);
  var master = readRows_(SHEET.MASTER, 3);
  var rows = master
    .filter(function (r) { return r[0] && r[2]; })
    .map(function (r) {
      return {
        曜日: String(r[2]).trim(), 開始: tstr_(r[3]), 終了: tstr_(r[4]),
        講師: String(r[0]).trim(), 生徒: String(r[1]).trim(),
        教科: String(r[5]).trim(), 場所: String(r[6]).trim(),
        隔週: String(r[7] || '毎週').trim()
      };
    });
  rows.sort(function (a, b) {
    var da = WEEKDAYS.indexOf(a.曜日), db = WEEKDAYS.indexOf(b.曜日);
    if (da !== db) return da - db;
    return toMin_(a.開始) - toMin_(b.開始);
  });
  if (sh.getLastRow() >= 3) {
    sh.getRange(3, 1, sh.getLastRow() - 2, 8).clearContent();
  }
  if (rows.length === 0) return;
  var out = rows.map(function (r) {
    return [r.曜日, r.開始, r.終了, r.講師, r.生徒, r.教科, r.場所, r.隔週];
  });
  sh.getRange(3, 1, out.length, 8).setValues(out);
}

// ===== Discord 投稿 ========================================================
function postTodayToDiscord() {
  var url = CONFIG.DISCORD_WEBHOOK_URL;
  if (!url) {
    SpreadsheetApp.getUi().alert('CONFIG.DISCORD_WEBHOOK_URL が未設定です。Code.gs の上部に貼り付けてください。');
    return;
  }
  var lessons = computeLessons_(new Date());
  var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'M/d(E)');
  var lines = ['📅 **本日 ' + today + ' の授業**', '━━━━━━━━━━━━'];
  if (lessons.length === 0) {
    lines.push('本日の授業はありません 🎉');
  } else {
    lessons.forEach(function (l) {
      var tag = l.種別 ? '【' + l.種別 + '】' : '';
      var note = l.備考 ? '　※' + l.備考 : '';
      lines.push('・' + l.開始 + '-' + l.終了 + '　' + l.講師 + ' / ' + l.生徒 +
                 ' / ' + l.教科 + '（' + l.場所 + '）' + tag + note);
    });
  }
  // Discord は1メッセージ2000文字まで → 分割
  var chunks = [], buf = '';
  lines.forEach(function (ln) {
    if ((buf + ln + '\n').length > 1900) { chunks.push(buf); buf = ''; }
    buf += ln + '\n';
  });
  if (buf) chunks.push(buf);
  chunks.forEach(function (content) {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ content: content }),
      muteHttpExceptions: true
    });
  });
}

// ===== 毎朝の自動実行トリガー ==============================================
function setupDailyTrigger() {
  // 既存の同名トリガーを掃除
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMorningJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMorningJob')
    .timeBased().atHour(6).everyDays(1).inTimezone(CONFIG.TIMEZONE).create();
  SpreadsheetApp.getUi().alert('毎朝6時に「今日の授業生成＋Discord投稿」を実行します。');
}

/** トリガーから呼ばれる毎朝の処理 */
function dailyMorningJob() {
  generateToday();
  buildWeekly();
  if (CONFIG.DISCORD_WEBHOOK_URL) postTodayToDiscord();
}
