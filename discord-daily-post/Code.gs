// ===== 設定（ここだけ） =====
const WEBHOOK = 'https://discord.com/api/webhooks/1529795115105915041/wPw3k5qe30sicuIX9r5TK_8weZlYgW1LIarLitrZeNIfKYW9raZaI7NJZh20FuaT_Juf';

// 週間時間割：[曜日, 時間, 講師, 生徒, 教科]  ← ここを本物に差し替えるだけ
const TIMETABLE = [
  ['月', '17:00-18:30', '田中先生', 'Aさん', '数学'],
  ['木', '17:00-18:30', '田中先生', 'Aさん', '数学'],
  ['木', '19:00-20:30', '佐藤先生', 'Bさん', '英語'],
  ['金', '18:00-19:30', '鈴木先生', 'Cさん', '国語'],
];

// ===== ここから下は触らなくてOK =====
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function postToday() {
  const now = new Date();
  const dow = DOW[now.getDay()];
  const todays = TIMETABLE.filter(r => r[0] === dow);
  const date = Utilities.formatDate(now, 'Asia/Tokyo', 'M/d') + '(' + dow + ')';
  let msg = '📅 **本日 ' + date + ' の授業**\n━━━━━━━━━━━━\n';
  msg += todays.length
    ? todays.map(r => '・' + r[1] + '　' + r[2] + ' / ' + r[3] + ' / ' + r[4]).join('\n')
    : '本日の授業はありません 🎉';
  UrlFetchApp.fetch(WEBHOOK, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ content: msg })
  });
}

// 毎日12:00に自動投稿をON（1回だけ実行すればOK）
function setupNoonTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'postToday') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postToday').timeBased().atHour(12).everyDays(1)
    .inTimezone('Asia/Tokyo').create();
}
