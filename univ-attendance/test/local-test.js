// GAS の API をスタブして Code.gs のロジックを検証する。
// 実行: node univ-attendance/test/local-test.js
// Apps Script には push されない（.claspignore で除外）。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const TABLES = {
  '履修科目': [
    ['科目コード','科目名','曜日','時限','開始','終了','教室','教員','開講期','欠席上限'],
    ['LIN101','線形代数I','月','2','10:40','12:10','A302','山田','前期',4],
    ['ENG201','英語コミュニケーション','火','1','9:00','10:30','B105','Smith','通年',3],
    ['PRG110','プログラミング演習','水','3','13:00','14:30','情報室','佐藤','前期',4],
    ['SEM300','ゼミ','月','2','10:40','12:10','C201','鈴木','前期',''],   // 月2限が2科目 → ラベル重複なし(名前違い)
  ],
  '学年暦': [
    ['開講期','開始日','終了日'],
    ['前期','2026-04-06','2026-07-31'],
    ['後期','2026-09-24','2027-01-30'],
  ],
  '特別日程': [
    ['日付','種別','実施曜日','メモ'],
    ['2026-04-29','休講日','','昭和の日'],
    ['2026-05-07','曜日振替','月','月曜授業を実施'],   // 5/7 は木曜
  ],
  '科目変更': [
    ['日付','科目コード','種別','時限','メモ'],
    ['2026-05-13','PRG110','休講','3','教員都合'],
    ['2026-05-20','PRG110','補講','5','振替の補講'],
  ],
  '出席記録': [['日付','曜日','時限','科目コード','科目名','状態','記録日時']],
  '履修状況': [['科目コード','科目名','開講期','実施済','出席','遅刻','公欠','欠席','出席率','欠席上限','残り欠席可能','判定']],
};

function makeSheet(name) {
  const rows = TABLES[name];
  const api = {
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastRow:   () => rows.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = rows[r - 1 + i] || [];
          out.push(row.slice(c - 1, c - 1 + nc));
        }
        return out;
      },
      setValues(v) {
        v.forEach((row, i) => {
          const target = rows[r - 1 + i] || (rows[r - 1 + i] = []);
          row.forEach((cell, j) => { target[c - 1 + j] = cell; });
        });
        return this;
      },
      setValue(v) { (rows[r-1] || (rows[r-1] = []))[c-1] = v; return this; },
      setNumberFormat: () => api.getRange(r, c, nr, nc),
      setFontWeight:   () => api.getRange(r, c, nr, nc),
      setBackground:   () => api.getRange(r, c, nr, nc),
    }),
    deleteRow: (n) => { rows.splice(n - 1, 1); },
    clear: () => { rows.length = 0; },
    setFrozenRows: () => api,
    autoResizeColumns: () => api,
    setName: () => api,
  };
  return api;
}

const props = { SHEET_ID: 'dummy', API_TOKEN: 'tok' };

const sandbox = {
  Logger: { log: (...a) => console.log(...a) },
  console,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    }),
  },
  SpreadsheetApp: {
    openById: () => ({ getSheetByName: makeSheet, getSheets: () => [makeSheet('履修科目')], getUrl: () => 'url' }),
  },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: t => ({ setMimeType: () => t }),
  },
  Utilities: {
    formatDate: (date, tz, fmt) => {
      // Asia/Tokyo 固定で整形（テスト用の簡易版）
      const j = new Date(date.getTime() + 9 * 3600 * 1000);
      const p = n => ('0' + n).slice(-2);
      return fmt
        .replace('yyyy', j.getUTCFullYear())
        .replace('MM', p(j.getUTCMonth() + 1))
        .replace('dd', p(j.getUTCDate()))
        .replace('HH', p(j.getUTCHours()))
        .replace('mm', p(j.getUTCMinutes()));
    },
    getUuid: () => 'uuid-1234',
  },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://example/exec' }) },
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), sandbox);

const R = sandbox;
const show = (label, d) => {
  const p = R.todayPayload_(d);
  console.log(`\n[${d} ${label}] open=${p.open} youbi=${p.youbi} count=${p.count} reason="${p.reason}"`);
  p.labels.forEach(l => console.log('   -', l));
};

console.log('=== 授業判定 ===');
show('月・通常',        '2026-04-13');
show('火・通常',        '2026-04-14');
show('日・授業なし',    '2026-04-12');
show('全学休講日',      '2026-04-29');
show('曜日振替(木→月)', '2026-05-07');
show('科目休講(水)',    '2026-05-13');
show('補講(水)',        '2026-05-20');
show('開講期間外(夏)',  '2026-08-10');
show('後期・火(通年のみ)','2026-10-06');

console.log('\n=== 記録 ===');
console.log(R.saveAttendance_('2026-04-13', ['2限 線形代数I (A302)']).text);
console.log(R.saveAttendance_('2026-04-14', ['1限 英語コミュニケーション (B105)']).text);
console.log(R.saveAttendance_('2026-04-20', []).text);
console.log('-- 同じ日を再実行（上書きされるか）--');
console.log(R.saveAttendance_('2026-04-13', ['2限 線形代数I (A302)', '2限 ゼミ (C201)']).text);
console.log('出席記録の行数 =', TABLES['出席記録'].length - 1, '（4/13:2 + 4/14:1 + 4/20:2 = 5 なら上書き成功）');

console.log('\n=== 集計 ===');
R.buildSummaryRows_().forEach(r =>
  console.log(`${r.judge}\t${r.name}\t実施${r.held} 出席${r.present} 欠席${r.absent} 残り${r.remaining} 率${(r.rate*100).toFixed(0)}%`));

console.log('\n=== doGet ===');
console.log(R.doGet({ parameter: { action: 'today', token: 'tok', date: '2026/4/13' } }));
console.log(R.doGet({ parameter: { action: 'today', token: 'BAD' } }));
console.log(R.doGet({ parameter: { action: 'save', token: 'tok', date: '2026-04-13', attended: '2限 線形代数I (A302)' } }));
console.log(R.doGet({ parameter: { action: 'summary', token: 'tok' } }));

console.log('\n=== 未記録の日（2026-04-06〜今日 のうち授業があったのに記録が無い日）===');
const missing = R.listMissingDates_();
console.log(missing.length ? missing.slice(0, 10).join(', ') + (missing.length > 10 ? ` … 他${missing.length - 10}日` : '') : 'なし');
