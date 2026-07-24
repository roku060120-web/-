/**
 * 今日の授業一覧を Discord に投稿する（Google Apps Script）
 * データ元: 時間割(Google Sheets) + 例外(Notion データベース)
 *
 * 使い方:
 *   1) スクリプトプロパティに以下を保存
 *        NOTION_TOKEN        ... Notion連携キー(ntn_...)
 *        DISCORD_WEBHOOK_URL ... DiscordのWebhook URL
 *   2) testPost_('2026-07-28') で動作確認
 *   3) setupNoonTrigger を1回実行 → 毎日12:00の自動投稿ON
 */

// ===== 設定 =====
const TIMETABLE_SHEET_ID = '1fUkcHlgNz03iv0n3FslFgtpKQKxH0C_jNCTwyoY0WVI'; // 時間割マスター
const TIMETABLE_TAB      = '';                                             // 空=先頭タブ
const NOTION_DB_ID       = '3a6f61e0-a079-8048-a39f-c3a2c279e72b';         // 例外DB(テスト)
const TZ      = 'Asia/Tokyo';
const WEEK_JP = ['日', '月', '火', '水', '木', '金', '土'];
// スクリプトプロパティ: NOTION_TOKEN / DISCORD_WEBHOOK_URL

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

// ===== エントリポイント =====
function postToday()          { postLessonsFor_(new Date()); }                       // 毎朝トリガー用
function testPost_(dateStr)   { postLessonsFor_(new Date(dateStr + 'T09:00:00+09:00')); } // 動作確認 例:'2026-07-28'
function postLessonsFor_(date){ postDiscord_(buildMessage_(date)); }

/* -------------------------------------------------------------------
 * 1) 時間割(Google Sheets)を読む
 * ----------------------------------------------------------------- */
function getTimetableForDay_(youbi) {
  const ss = SpreadsheetApp.openById(TIMETABLE_SHEET_ID);
  const sh = TIMETABLE_TAB ? ss.getSheetByName(TIMETABLE_TAB) : ss.getSheets()[0];
  const values = sh.getDataRange().getValues();

  // ヘッダー行(「曜日」を含む行)を探す ※先頭に空行があってもOK
  let hr = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i].map(String).indexOf('曜日') >= 0) { hr = i; break; }
  }
  const head = values[hr].map(String);
  const col  = n => head.indexOf(n);
  const cY = col('曜日'), cT = col('時間'), cTe = col('講師'), cS = col('教科');
  let   cSt = col('生徒'); if (cSt < 0) cSt = col('生徒名');

  const norm = s => String(s).replace(/曜日$/, '').trim();   // "火曜日" → "火"
  const out = [];
  for (let i = hr + 1; i < values.length; i++) {
    const r = values[i];
    if (norm(r[cY]) !== youbi) continue;
    const time = String(r[cT]).trim(); if (!time) continue;
    out.push({
      start:   time.split('-')[0].trim(),
      time:    time,
      teacher: String(r[cTe]).trim(),
      student: String(r[cSt]).trim(),
      subject: String(r[cS]).trim(),
      tag:     ''
    });
  }
  return out;
}

/* -------------------------------------------------------------------
 * 2) 例外(Notion DB)を読む
 * ----------------------------------------------------------------- */
function readExceptionsFromNotion_() {
  const res = UrlFetchApp.fetch(
    'https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + prop_('NOTION_TOKEN'),
        'Notion-Version': '2022-06-28'
      },
      payload: JSON.stringify({ page_size: 100 }),
      muteHttpExceptions: true
    });
  const data = JSON.parse(res.getContentText());
  if (!data.results) throw new Error('Notion読み取り失敗: ' + res.getContentText());

  const rt  = p => (p && p.rich_text ? p.rich_text.map(t => t.plain_text).join('') : '');
  const sel = p => (p && p.select ? p.select.name : '');
  const dt  = p => (p && p.date ? p.date : null);

  return data.results.map(pg => {
    const pr = pg.properties;
    return {
      type:    sel(pr['種別']),
      student: rt(pr['生徒名']),
      teacher: rt(pr['講師']),
      subject: rt(pr['教科']),
      honrai:  dt(pr['本来の指導時間']),
      furikae: dt(pr['振替先指導時間'])
    };
  });
}

/* -------------------------------------------------------------------
 * 3) 時間割 × 例外 を合成してメッセージ化
 * ----------------------------------------------------------------- */
function buildMessage_(date) {
  const youbi   = WEEK_JP[date.getDay()];
  const dateStr = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
  const lessons = getTimetableForDay_(youbi);
  const changes = [];

  const hm    = iso => iso.substr(11, 5);
  const range = d   => d.end ? hm(d.start) + '-' + hm(d.end) : hm(d.start);
  const dOf   = d   => d ? d.start.substr(0, 10) : null;
  const md    = iso => { const t = new Date(iso);
    return (t.getMonth() + 1) + '/' + t.getDate() + '(' + WEEK_JP[t.getDay()] + ')'; };
  const find  = (st, shm) => lessons.findIndex(l => l.student === st && l.start === shm);

  readExceptionsFromNotion_().forEach(ex => {
    const onHon = dOf(ex.honrai)  === dateStr;
    const onFur = dOf(ex.furikae) === dateStr;

    if (ex.type === '休講' && onHon) {
      const i = find(ex.student, hm(ex.honrai.start)); if (i >= 0) lessons.splice(i, 1);
      changes.push('❌ 休講　' + hm(ex.honrai.start) + '　' + ex.student + (ex.subject ? ' / ' + ex.subject : ''));
    }
    if (ex.type === '代講' && onHon) {
      const i = find(ex.student, hm(ex.honrai.start));
      if (i >= 0) { const o = lessons[i].teacher;
        lessons[i].teacher = ex.teacher || o;
        lessons[i].tag = '👤:※代講（本来 ' + o + '）'; }
    }
    if (ex.type === '追加' && onHon) {
      lessons.push({ start: hm(ex.honrai.start), time: range(ex.honrai),
        teacher: ex.teacher, student: ex.student, subject: ex.subject, tag: '➕:※追加' });
    }
    if (ex.type === '振替') {
      if (onHon) {
        const i = find(ex.student, hm(ex.honrai.start)); if (i >= 0) lessons.splice(i, 1);
        changes.push('➡️ 振替　' + hm(ex.honrai.start) + ' ' + ex.student +
                     ' → ' + md(ex.furikae.start) + hm(ex.furikae.start) + ' へ');
      }
      if (onFur) {
        lessons.push({ start: hm(ex.furikae.start), time: range(ex.furikae),
          teacher: ex.teacher, student: ex.student, subject: ex.subject,
          tag: '🔁:※振替（元 ' + md(ex.honrai.start) + hm(ex.honrai.start) + '）' });
      }
    }
  });

  lessons.sort((a, b) => a.start.localeCompare(b.start));

  const bar  = '━━━━━━━━━━━━';
  const body = lessons.length
    ? lessons.map(l => {
        const [mark, note] = l.tag ? l.tag.split(':') : ['', ''];
        return (mark ? mark + ' ' : '') + l.time + '　' + l.teacher + ' / ' + l.student +
               ' / ' + l.subject + (note ? '　' + note : '');
      }).join('\n')
    : '本日の授業はありません 🎉';

  let msg = '📅 **本日 ' + Utilities.formatDate(date, TZ, 'M/d') + '(' + youbi + ') の授業**\n' + bar + '\n' + body;
  if (changes.length) msg += '\n' + bar + '\n本日の変更\n' + changes.join('\n');
  return msg;
}

/* -------------------------------------------------------------------
 * 4) Discord へ投稿（429はリトライ）
 * ----------------------------------------------------------------- */
function postDiscord_(content) {
  const options = {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ content: content }),
    headers: { 'User-Agent': 'juku-schedule-bot/1.0' },
    muteHttpExceptions: true
  };
  const webhook = prop_('DISCORD_WEBHOOK_URL');
  for (let i = 0; i < 3; i++) {
    const res  = UrlFetchApp.fetch(webhook, options);
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) { Logger.log('投稿成功'); return; }
    if (code === 429) { Utilities.sleep(3000 * (i + 1)); continue; }
    throw new Error('Discordエラー ' + code + ': ' + res.getContentText());
  }
  throw new Error('Discord: リトライ上限に達しました');
}

// ===== 毎日12:00に自動投稿をON（1回だけ実行）=====
function setupNoonTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'postToday') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postToday').timeBased().atHour(12).everyDays(1).inTimezone(TZ).create();
  Logger.log('毎日12:00の自動投稿をONにしました');
}
