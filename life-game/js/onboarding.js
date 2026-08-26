/* ============================================================
   onboarding.js — ①登録フェーズ（ENLISTMENT）
   初回起動時に基本情報を入力してもらい、メインフェーズへ引き渡す
   ============================================================ */
const Onboarding = (() => {
  const root = document.getElementById('enlist');
  let step = 0;
  let draft = null;
  let onDone = null;

  const esc = (s) => UI.esc(s);
  const preset = () => (typeof LIFEGAME_PRESET !== 'undefined' ? LIFEGAME_PRESET : null);

  /* 行の追加・削除で再描画しても、同じ画面の入力が消えないようにする */
  function snapshot() {
    const form = document.getElementById('enlistForm');
    if (!form) return;
    form.querySelectorAll('input[name], select[name]').forEach((el) => {
      draft.raw[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
  }
  const V = (name, fallback) => (draft.raw[name] !== undefined && draft.raw[name] !== ''
    ? draft.raw[name] : (fallback === undefined || fallback === null ? '' : fallback));

  function newDraft() {
    const s = Store.get();
    return {
      raw: {},
      profile: { ...s.profile },
      jobs: [],        // 収入源 → 属性(バイト)
      orgs: [],        // サークル等 → 属性
      persons: [],     // 最初の関係者
      funds: { balance: '', goal: 100000 },
      credits: { usePreset: !!preset(), earned: '', required: 128 },
      sleep: { target: 7, method: 'manual' }
    };
  }

  /* ============================================================
     各ステップの定義
     ============================================================ */
  const steps = [
    {
      key: 'operator',
      title: 'OPERATOR',
      jp: 'オペレーター登録',
      lead: 'まず、あなたの呼び名と現在地を登録します。',
      render: () => `
        <div class="f">
          <label>コールサイン（表示名）<i>必須</i></label>
          <input name="callsign" value="${esc(V('callsign', draft.profile.callsign))}" placeholder="例: ROKU" required>
          <p class="hint">画面左上に表示されます。あとから変更できます。</p>
        </div>
        <div class="f row">
          <div>
            <label>現在の学年<i>必須</i></label>
            <select name="grade">
              ${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${String(V('grade', draft.profile.grade)) === String(n) ? 'selected' : ''}>${n} 年</option>`).join('')}
            </select>
          </div>
          <div>
            <label>現在の学期<i>必須</i></label>
            <select name="term">
              ${['春', '秋'].map((t) => `<option ${V('term', draft.profile.term) === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>`,
      collect: (d) => {
        if (!d.callsign.trim()) return 'コールサインを入力してください';
        draft.profile.callsign = d.callsign.trim().toUpperCase();
        draft.profile.grade = Number(d.grade);
        draft.profile.term = d.term;
      }
    },

    {
      key: 'affiliation',
      title: 'AFFILIATION',
      jp: '所属',
      lead: '卒業までの道のりを計算するために使います。',
      render: () => `
        <div class="f">
          <label>大学</label>
          <input name="university" value="${esc(V('university', draft.profile.university))}" placeholder="例: ○○大学">
        </div>
        <div class="f row">
          <div><label>学部</label><input name="faculty" value="${esc(V('faculty', draft.profile.faculty))}" placeholder="例: 文学部"></div>
          <div><label>学科</label><input name="dept" value="${esc(V('dept', draft.profile.dept))}" placeholder="例: 人文社会学科"></div>
        </div>
        <div class="f">
          <label>専攻</label>
          <input name="major" value="${esc(V('major', draft.profile.major))}" placeholder="例: 人間科学専攻">
        </div>
        <div class="f row">
          <div>
            <label>入学年度<i>必須</i></label>
            <input type="number" name="entryYear" value="${esc(V('entryYear', draft.profile.entryYear))}" placeholder="2024" required>
            <p class="hint">卒業要件は年度で変わります</p>
          </div>
          <div>
            <label>卒業予定<i>必須</i></label>
            <input name="gradTarget" value="${esc(V('gradTarget', draft.profile.gradTarget))}" placeholder="2028-03" required>
            <p class="hint">残り学期数の分母になります</p>
          </div>
        </div>`,
      collect: (d) => {
        if (!d.entryYear) return '入学年度を入力してください';
        if (!d.gradTarget.trim()) return '卒業予定を入力してください（例: 2028-03）';
        Object.assign(draft.profile, {
          university: d.university.trim(), faculty: d.faculty.trim(),
          dept: d.dept.trim(), major: d.major.trim(),
          entryYear: Number(d.entryYear), gradTarget: d.gradTarget.trim()
        });
      }
    },

    {
      key: 'records',
      title: 'RECORDS',
      jp: '単位の記録',
      lead: '卒業要件と履修実績を読み込みます。',
      render: () => {
        const p = preset();
        if (p) {
          const n = p.transcript ? p.transcript.length : 0;
          const req = p.requirements;
          return `
          <div class="preset-box">
            <div class="preset-head">解析済みデータが見つかりました</div>
            <dl class="preset-grid">
              <dt>卒業要件</dt><dd>${esc(req.meta.major || '')} / ${req.total.need} 単位</dd>
              <dt>出典</dt><dd>${esc(req.meta.source || '')}</dd>
              <dt>履修記録</dt><dd>${n} 件</dd>
            </dl>
            <label class="check">
              <input type="checkbox" name="usePreset" ${draft.credits.usePreset ? 'checked' : ''}>
              <span>このデータを使う（推奨）</span>
            </label>
          </div>
          <p class="hint">使わない場合は、取得済み単位の合計だけ手入力できます。</p>
          <div class="f row" id="manualCredits" style="${draft.credits.usePreset ? 'display:none' : ''}">
            <div><label>取得済み単位</label><input type="number" name="earned" value="${esc(V('earned', draft.credits.earned))}" placeholder="0"></div>
            <div><label>卒業要件単位</label><input type="number" name="required" value="${esc(V('required', draft.credits.required))}"></div>
          </div>`;
        }
        return `
          <p class="hint">解析済みデータがないので、合計だけ入力します。あとから差し替えられます。</p>
          <div class="f row">
            <div><label>取得済み単位</label><input type="number" name="earned" value="${esc(V('earned', draft.credits.earned))}" placeholder="0"></div>
            <div><label>卒業要件単位</label><input type="number" name="required" value="${esc(V('required', draft.credits.required))}"></div>
          </div>`;
      },
      collect: (d) => {
        draft.credits.usePreset = !!d.usePreset && !!preset();
        draft.credits.earned = Number(d.earned || 0);
        draft.credits.required = Number(d.required || 128);
      }
    },

    {
      key: 'supply',
      title: 'SUPPLY',
      jp: '補給線',
      lead: '所持金の起点と、収入源を登録します。収入源はタスクの属性になります。',
      render: () => `
        <div class="f row">
          <div>
            <label>現在の残高<i>必須</i></label>
            <input type="number" name="balance" value="${esc(V('balance', draft.funds.balance))}" placeholder="48200" required>
            <p class="hint">ここを基準に増減を記録します</p>
          </div>
          <div>
            <label>目標金額</label>
            <input type="number" name="goal" value="${esc(V('goal', draft.funds.goal))}">
          </div>
        </div>
        <div class="f">
          <label>収入源（バイトなど）</label>
          ${rowList('jobs', draft.jobs, '例: コンビニ')}
        </div>`,
      collect: (d) => {
        if (d.balance === '') return '現在の残高を入力してください';
        draft.funds.balance = Number(d.balance);
        draft.funds.goal = Number(d.goal || 100000);
      }
    },

    {
      key: 'orgs',
      title: 'ORGANIZATIONS',
      jp: '所属組織',
      lead: 'サークル・部活など。こちらも属性として使われます。',
      render: () => `
        <div class="f">
          <label>所属している組織</label>
          ${rowList('orgs', draft.orgs, '例: 軽音サークル')}
        </div>
        <p class="hint">「大学」「ノーマル」は最初から用意されています。</p>`,
      collect: () => {}
    },

    {
      key: 'network',
      title: 'NETWORK',
      jp: '関係者',
      lead: '名前と所属だけで十分です。連絡先などは後から追加できます。',
      render: () => `
        <div class="f">
          <label>登録する人物</label>
          ${personList()}
        </div>
        <p class="hint">0人でも始められます。</p>`,
      collect: () => {}
    },

    {
      key: 'rhythm',
      title: 'RHYTHM',
      jp: '生活リズム',
      lead: '睡眠はコンディションの判定に使います。',
      render: () => `
        <div class="f row">
          <div>
            <label>目標睡眠時間</label>
            <input type="number" step="0.5" name="target" value="${esc(V('target', draft.sleep.target))}">
          </div>
          <div>
            <label>記録方法</label>
            <select name="method">
              <option value="manual" ${V('method', draft.sleep.method) === 'manual' ? 'selected' : ''}>手入力</option>
              <option value="shortcut" ${V('method', draft.sleep.method) === 'shortcut' ? 'selected' : ''}>iPhoneショートカット（後日連携）</option>
            </select>
          </div>
        </div>`,
      collect: (d) => {
        draft.sleep.target = Number(d.target || 7);
        draft.sleep.method = d.method;
      }
    },

    {
      key: 'confirm',
      title: 'CONFIRM',
      jp: '最終確認',
      lead: 'この内容で配属します。すべてあとから変更できます。',
      render: () => {
        const p = draft.profile;
        const attrs = ['大学', 'ノーマル'].concat(draft.jobs, draft.orgs);
        return `
        <dl class="confirm-grid">
          <dt>コールサイン</dt><dd>${esc(p.callsign)}</dd>
          <dt>現在</dt><dd>${esc(p.grade)}年 ${esc(p.term)}学期</dd>
          <dt>所属</dt><dd>${esc([p.university, p.faculty, p.major].filter(Boolean).join(' / ')) || '—'}</dd>
          <dt>入学 / 卒業</dt><dd>${esc(p.entryYear)} → ${esc(p.gradTarget)}</dd>
          <dt>単位</dt><dd>${draft.credits.usePreset ? '解析済みデータを使用' : `${draft.credits.earned} / ${draft.credits.required} 単位`}</dd>
          <dt>残高</dt><dd>¥${Number(draft.funds.balance || 0).toLocaleString('ja-JP')}</dd>
          <dt>属性</dt><dd>${attrs.map((a) => `<span class="pill">${esc(a)}</span>`).join('')}</dd>
          <dt>関係者</dt><dd>${draft.persons.length ? draft.persons.map((x) => esc(x.name)).join('、') : '—'}</dd>
          <dt>目標睡眠</dt><dd>${draft.sleep.target} 時間</dd>
        </dl>`;
      },
      collect: () => {}
    }
  ];

  /* ---- 繰り返し入力の行 ---- */
  function rowList(key, arr, ph) {
    return `<div class="rows" data-rows="${key}">
      ${arr.map((v, i) => `
        <div class="row-item">
          <input value="${esc(v)}" data-idx="${i}" data-key="${key}">
          <button type="button" class="row-del" data-del="${key}" data-i="${i}">✕</button>
        </div>`).join('')}
      <button type="button" class="row-add" data-add="${key}">＋ 追加</button>
      <p class="hint">${esc(ph)}</p>
    </div>`;
  }

  function personList() {
    const groups = Store.groups();
    return `<div class="rows" data-rows="persons">
      ${draft.persons.map((p, i) => `
        <div class="row-item">
          <input value="${esc(p.name)}" data-idx="${i}" data-key="persons" placeholder="名前">
          <select data-idx="${i}" data-key="persons-group">
            ${groups.map((g) => `<option value="${g.id}" ${p.group === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}
          </select>
          <button type="button" class="row-del" data-del="persons" data-i="${i}">✕</button>
        </div>`).join('')}
      <button type="button" class="row-add" data-add="persons">＋ 追加</button>
    </div>`;
  }

  /* ============================================================
     描画
     ============================================================ */
  function render() {
    const s = steps[step];
    const pct = ((step) / (steps.length - 1)) * 100;
    root.innerHTML = `
      <div class="enlist-inner">
        <header class="enlist-head">
          <div class="enlist-brand">LIFE GAME // ENLISTMENT</div>
          <div class="enlist-step">STEP ${String(step + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}</div>
        </header>
        <div class="enlist-bar"><div style="width:${pct}%"></div></div>

        <h2 class="enlist-title">${s.title}<small>${s.jp}</small></h2>
        <p class="enlist-lead">${esc(s.lead)}</p>

        <form id="enlistForm" class="enlist-form">${s.render()}</form>

        <div class="enlist-foot">
          <button class="btn ghost" type="button" id="enlistBack" ${step === 0 ? 'disabled' : ''}>戻る</button>
          <button class="btn" type="submit" form="enlistForm">
            ${step === steps.length - 1 ? '配属する' : '次へ'}
          </button>
        </div>
        <div class="enlist-err" id="enlistErr" hidden></div>
      </div>`;

    document.getElementById('enlistForm').addEventListener('submit', (e) => {
      e.preventDefault();
      next();
    });
    document.getElementById('enlistBack').addEventListener('click', () => {
      if (step > 0) { snapshot(); syncRows(); step--; render(); }
    });

    // 単位ステップ: チェックで手入力欄を出し入れ
    const chk = root.querySelector('input[name=usePreset]');
    if (chk) {
      chk.addEventListener('change', () => {
        const box = document.getElementById('manualCredits');
        if (box) box.style.display = chk.checked ? 'none' : '';
      });
    }
  }

  /* 繰り返し行の内容を draft に取り込む */
  function syncRows() {
    root.querySelectorAll('[data-key]').forEach((el) => {
      const i = Number(el.dataset.idx);
      const k = el.dataset.key;
      if (k === 'jobs' || k === 'orgs') draft[k][i] = el.value;
      else if (k === 'persons') draft.persons[i].name = el.value;
      else if (k === 'persons-group') draft.persons[i].group = el.value;
    });
  }

  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    const del = e.target.closest('[data-del]');
    if (add) {
      snapshot(); syncRows();
      const k = add.dataset.add;
      if (k === 'persons') draft.persons.push({ name: '', group: 'univ' });
      else draft[k].push('');
      render();
    } else if (del) {
      snapshot(); syncRows();
      const k = del.dataset.del;
      const i = Number(del.dataset.i);
      if (k === 'persons') draft.persons.splice(i, 1);
      else draft[k].splice(i, 1);
      render();
    }
  });

  function next() {
    snapshot();
    syncRows();
    const form = document.getElementById('enlistForm');
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    // チェックボックスは未チェックだと FormData に出ない
    const chk = form.querySelector('input[name=usePreset]');
    if (chk) data.usePreset = chk.checked;

    const err = steps[step].collect(data);
    if (err) {
      const box = document.getElementById('enlistErr');
      box.textContent = '// ' + err;
      box.hidden = false;
      return;
    }
    if (step < steps.length - 1) { step++; render(); }
    else finish();
  }

  /* ============================================================
     完了 — draft を state に流し込む
     ============================================================ */
  function finish() {
    const s = Store.get();
    const patch = {
      profile: { ...draft.profile },
      funds: { balance: Number(draft.funds.balance) || 0, goal: Number(draft.funds.goal) || 100000, log: [] },
      sleep: { target: draft.sleep.target, method: draft.sleep.method, log: [] },
      persons: [{ id: 'self', name: draft.profile.callsign || 'YOU', self: true, group: 'family', age: null, contact: '', relation: '本人' }]
    };

    // 属性（収入源・所属組織）を分類に追加
    draft.jobs.filter(Boolean).forEach((label) => Store.addAttr(label, 'job'));
    draft.orgs.filter(Boolean).forEach((label) => Store.addAttr(label, 'circle'));

    // 関係者
    draft.persons.filter((p) => p.name.trim()).forEach((p) => {
      patch.persons.push({
        id: Store.uid(), name: p.name.trim(), group: p.group,
        age: null, contact: '', relation: ''
      });
    });

    // 単位
    const p = preset();
    if (draft.credits.usePreset && p) {
      patch.credits = { requirements: p.requirements, transcript: p.transcript, manual: { earned: 0, required: p.requirements.total.need } };
    } else {
      patch.credits = { requirements: null, transcript: [], manual: { earned: draft.credits.earned, required: draft.credits.required } };
    }

    Store.finishOnboarding(patch);
    root.hidden = true;
    if (onDone) onDone();
  }

  return {
    start(cb) {
      onDone = cb;
      draft = newDraft();
      step = 0;
      root.hidden = false;
      render();
    },
    isActive: () => !root.hidden
  };
})();
