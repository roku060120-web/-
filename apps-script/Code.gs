/**
 * 今日の授業一覧をDiscordに投稿する（Google Apps Script）
 * 毎日12:00に自動投稿。データはGoogleスプレッドシート2つから読む。
 *
 * 使い方:
 *  1) script.google.com で新規プロジェクト → このコードを貼り付け
 *  2) postToday を実行してテスト（初回だけ承認）
 *  3) setupNoonTrigger を1回実行 → 毎日12:00の自動投稿ON
 */

// ===== 設定 =====
const WEBHOOK = 'https://discord.com/api/webhooks/1529795115105915041/wPw3k5qe30sicuIX9r5TK_8weZlYgW1LIarLitrZeNIfKYW9raZaI7NJZh20FuaT_Juf';
const SHEET_TIMETABLE = '1fUkcHlgNz03iv0n3FslFgtpKQKxH0C_jNCTwyoY0WVI';   // 時間割マスター
const SHEET_EXCEPTIONS = '1Y-mj2kMxj8CJrGQYeDkTMuS14rs9mqXOOSYZqe0d8QE';  // 例外マスター
const TZ = 'Asia/Tokyo';

const DOW_MON = ['月', '火', '水', '木', '金', '土', '日']; // ISO: 月=1 … 日=7

// ===== メイン =====
function postToday() {
  const now = new Date();
  const u = parseInt(Utilities.formatDate(now, TZ, 'u'), 10); // 1=月 … 7=日
  const dow = DOW_MON[u - 1];
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy/MM/dd');

  const tt = readSheet_(SHEET_TIMETABLE);   // 曜日,時間,講師,生徒,教科
  const ex = readSheet_(SHEET_EXCEPTIONS);  // 日付,種別,講師,生徒,時間,教科

  // 今日の例外を仕分け
  const cancels = {};   // "講師|生徒" → true
  const adds = [];
  ex.forEach(function (r) {
    if (dstr_(r[0], now) !== todayStr) return;
    const kind = String(r[1] || '').trim();
    if (kind === '休講') {
      cancels[String(r[2]).trim() + '|' + String(r[3]).trim()] = true;
    } else if (kind === '振替' || kind === '追加') {
      adds.push({ 時間: tstr_(r[4]), 講師: String(r[2]).trim(),
                  生徒: String(r[3]).trim(), 教科: String(r[5] || '').trim(), 種別: kind });
    }
  });

  let lessons = [];
  tt.forEach(function (r) {
    if (String(r[0]).trim() !== dow) return;
    const teacher = String(r[2]).trim(), student = String(r[3]).trim();
    if (cancels[teacher + '|' + student]) return;
    lessons.push({ 時間: tstr_(r[1]), 講師: teacher, 生徒: student,
                   教科: String(r[4] || '').trim(), 種別: '' });
  });
  lessons = lessons.concat(adds);
  lessons.sort(function (a, b) { return startMin_(a.時間) - startMin_(b.時間); });

  const date = Utilities.formatDate(now, TZ, 'M/d') + '(' + dow + ')';
  const lines = ['📅 **本日 ' + date + ' の授業**', '━━━━━━━━━━━━'];
  if (lessons.length) {
    lessons.forEach(function (x) {
      const tag = x.種別 ? '【' + x.種別 + '】' : '';
      lines.push('・' + x.時間 + '　' + x.講師 + ' / ' + x.生徒 + ' / ' + x.教科 + tag);
    });
  } else {
    lines.push('本日の授業はありません 🎉');
  }
  postDiscord_(lines.join('\n'));
}

// ===== 補助 =====
function readSheet_(id) {
  const v = SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues();
  return v.slice(1); // 1行目はヘッダー
}

function dstr_(v, now) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'yyyy/MM/dd');
  }
  const s = String(v).trim();
  let m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2);
  m = s.match(/(\d{1,2})\D+(\d{1,2})/);
  if (m) return Utilities.formatDate(now, TZ, 'yyyy') + '/' + ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2);
  return s;
}

function tstr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'HH:mm');
  }
  return String(v || '').trim();
}

function startMin_(t) {
  const m = /(\d{1,2}):(\d{2})/.exec(t);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9999;
}

function postDiscord_(content) {
  const options = {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ content: content }),
    headers: { 'User-Agent': 'juku-schedule-bot/1.0' },
    muteHttpExceptions: true,
  };
  for (let i = 0; i < 3; i++) {
    const res = UrlFetchApp.fetch(WEBHOOK, options);
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) { Logger.log('投稿成功'); return; }
    if (code === 429) { Utilities.sleep(3000 * (i + 1)); continue; } // レート制限は待って再試行
    throw new Error('Discordエラー ' + code + ': ' + res.getContentText());
  }
  throw new Error('Discord: リトライ上限に達しました');
}

// 毎日12:00に自動投稿をON（1回だけ実行）
function setupNoonTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'postToday') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postToday').timeBased().atHour(12).everyDays(1).inTimezone(TZ).create();
  Logger.log('毎日12:00の自動投稿をONにしました');
}
