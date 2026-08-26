/* ============================================================
   store.js — 状態管理 / 永続化
   フェーズ: ①登録(onboarding) → ②メイン
   ============================================================ */
const Store = (() => {
  const KEY = 'lifegame.v2';
  const API = '/api/state';
  const PRIORITIES = ['必須', 'サブ', '余暇'];

  /* 成績評語の判定（履修案内の定義に準拠） */
  const GRADE = {
    pass: ['S', 'A', 'B', 'C', 'P', 'G'],
    fail: ['D', 'F'],
    wip: ['？', '?']
  };
  const gradeState = (g) => GRADE.wip.includes(g) ? 'wip'
    : GRADE.fail.includes(g) ? 'fail'
      : GRADE.pass.includes(g) ? 'pass' : 'none';

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);
  const inDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  /* ---- 既定の分類（登録フェーズでユーザーが上書きする） ---- */
  const DEFAULT_ATTRS = [
    { id: 'univ', label: '大学', color: '#9dc05a', kind: 'univ' },
    { id: 'normal', label: 'ノーマル', color: '#7f8f5a', kind: 'normal' }
  ];
  const DEFAULT_GROUPS = [
    { id: 'family', label: '家族', color: '#c0472f' },
    { id: 'univ', label: '大学', color: '#9dc05a' },
    { id: 'work', label: 'バイト', color: '#d8a33c' },
    { id: 'circle', label: 'サークル', color: '#5aa0c0' }
  ];
  const KIND_COLOR = { job: '#d8a33c', circle: '#5aa0c0', univ: '#9dc05a', normal: '#7f8f5a' };

  function emptyState() {
    return {
      version: 2,
      onboarded: false,
      profile: {
        callsign: '', grade: '', term: '春',
        university: '', faculty: '', dept: '', major: '',
        entryYear: null, gradTarget: ''
      },
      taxonomy: { attrs: DEFAULT_ATTRS.map((a) => ({ ...a })), groups: DEFAULT_GROUPS.map((g) => ({ ...g })) },
      funds: { balance: 0, goal: 100000, log: [] },
      credits: { requirements: null, transcript: [], manual: { earned: 0, required: 128 } },
      sleep: { target: 7, method: 'manual', log: [] },
      schedule: [],
      tasks: [],
      persons: [{ id: 'self', name: 'YOU', self: true, group: 'family', age: null, contact: '', relation: '本人' }],
      cleared: 0
    };
  }

  let state = load();
  const listeners = [];
  // server = LifeGame.bat 経由のローカルサーバに data/state.json として永続化できている状態。
  // null = まだ判定前、false = サーバなし（standalone / file:// など。localStorageのみで動く）
  let server = null;
  let saveTimer = null;
  let cloudTimer = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return Object.assign(emptyState(), parsed);
    } catch (e) {
      console.warn('[store] load failed', e);
      return emptyState();
    }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[store] localStorage save failed', e); }
  }
  function saveServer() {
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).then((res) => { server = res.ok; })
      .catch(() => { server = false; });
  }
  /* ローカルサーバ起動中なら data/state.json が唯一の正。localStorageは
     サーバ未検出時のフォールバック兼、書き込み直後の即時キャッシュとして常に併用する。
     ログイン中はさらにクラウド（Supabase, 自分専用行）にもデバウンスして送る。 */
  function save() {
    saveLocal();
    if (server !== false) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveServer, 300);
    }
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) {
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(() => Cloud.push(state), 300);
    }
  }
  function commit() {
    save();
    listeners.forEach((fn) => fn(state));
  }

  /* 起動時に data/state.json を読みに行く。無ければ（standalone等）localStorageのまま動く。
     app.js はこれの完了を待ってから初回描画する。 */
  async function init() {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object' && Object.keys(data).length) {
          state = Object.assign(emptyState(), data);
        }
        server = true;
        console.log('[store] 永続化: ローカルサーバ (data/state.json)');
      } else if (res.status === 404) {
        // サーバは動いているが data/state.json がまだ無い（初回起動）。
        // これは「サーバなし」ではないので、以後の保存は通常通りサーバへ送る。
        server = true;
        console.log('[store] 永続化: ローカルサーバ (data/state.json を新規作成します)');
      } else {
        server = false;
      }
    } catch (e) {
      server = false;
      console.log('[store] 永続化: ブラウザの localStorage のみ（ローカルサーバ未検出）');
    }

    // ログイン済みなら、クラウド（他端末とも共有される内容）を優先する。
    // app.js がこの前に Cloud.init() を済ませている前提。
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) {
      const cloudData = await Cloud.pull();
      if (cloudData && typeof cloudData === 'object' && Object.keys(cloudData).length) {
        state = Object.assign(emptyState(), cloudData);
        console.log('[store] 永続化: クラウド（ログイン中）のデータを使用');
      } else {
        Cloud.push(state); // 初回ログイン：今の内容をクラウドへ最初の同期
      }
    }
    return state;
  }

  // タブを閉じる/更新する瞬間はfetchが打ち切られやすいので sendBeacon で確実に送る
  window.addEventListener('beforeunload', () => {
    if (server !== false) {
      try {
        navigator.sendBeacon(API, new Blob([JSON.stringify(state)], { type: 'application/json' }));
      } catch (e) { /* noop */ }
    }
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) Cloud.push(state);
  });

  /* ============================================================
     単位の集計 — 卒業要件のバケツごとに取得/履修中/不合格を出す
     ============================================================ */
  function matchCourses(prefixes) {
    if (!prefixes || !prefixes.length) return [];
    return state.credits.transcript.filter(
      (c) => prefixes.some((p) => String(c.code).startsWith(p))
    );
  }

  function walkRequirement(node) {
    const children = (node.children || []).map(walkRequirement);
    let courses = [];
    let earned = 0, wip = 0, fail = 0;

    if (node.match && node.match.prefix) {
      courses = matchCourses(node.match.prefix);
      courses.forEach((c) => {
        const s = gradeState(c.grade);
        if (s === 'pass') earned += c.credits;
        else if (s === 'wip') wip += c.credits;
        else if (s === 'fail') fail += c.credits;
      });
    } else if (children.length) {
      children.forEach((c) => { earned += c.earned; wip += c.wip; fail += c.fail; });
    }

    const need = node.need || 0;
    return {
      id: node.id, name: node.name, need, note: node.note,
      earned, wip, fail,
      short: Math.max(0, need - earned - wip),
      pct: need ? Math.min(100, (earned / need) * 100) : 0,
      courses, children
    };
  }

  function creditStatus() {
    const req = state.credits.requirements;
    if (!req) {
      const m = state.credits.manual;
      return {
        simple: true,
        total: { earned: m.earned, wip: 0, need: m.required, pct: Math.min(100, (m.earned / m.required) * 100) },
        buckets: []
      };
    }
    const buckets = req.requirements.map(walkRequirement);
    const earned = buckets.reduce((a, b) => a + b.earned, 0);
    const wip = buckets.reduce((a, b) => a + b.wip, 0);
    const need = req.total.need;
    return {
      simple: false,
      total: { earned, wip, need, pct: Math.min(100, (earned / need) * 100) },
      buckets,
      nonCredit: req.nonCredit || []
    };
  }

  /* 作戦マップ用のノード状態判定（5状態のうち「履修可能」はP3で候補科目feedが
     揃うまで判定材料が無いため未使用。候補が入り次第 'avail' を返す分岐を足す） */
  function nodeState(n) {
    if (n.need > 0 && n.earned >= n.need) return 'earned';
    if (n.wip > 0) return 'wip';
    if (n.fail > 0) return 'fail';
    if (n.earned > 0) return 'earned';
    return 'none';
  }

  /* 不足している要件（葉ノードのみ）を一覧化 — OPSページの「取っておきたい単位」用。
     内部ノード（子を持つ集計バケツ）は粒度が粗すぎて「何を履修すればいいか」に直結しないため除外する。 */
  function creditGaps() {
    const cs = creditStatus();
    if (cs.simple) return [];
    const out = [];
    const walk = (n) => {
      const kids = n.children || [];
      if (!kids.length) { if (n.short > 0) out.push(n); }
      else kids.forEach(walk);
    };
    cs.buckets.forEach(walk);
    return out;
  }

  /* 平坦化した一覧（ゲージ表示用） */
  function creditBuckets() {
    const st = creditStatus();
    const out = [];
    const walk = (n, depth) => {
      out.push({ ...n, depth });
      (n.children || []).forEach((c) => walk(c, depth + 1));
    };
    st.buckets.forEach((b) => walk(b, 0));
    return out;
  }

  return {
    PRIORITIES, GRADE, gradeState, KIND_COLOR,
    uid, today, inDays,
    init,
    get: () => state,
    subscribe: (fn) => listeners.push(fn),
    commit,
    isServerBacked: () => server === true,
    reset() { state = emptyState(); commit(); },
    replaceState(newState) { state = Object.assign(emptyState(), newState); commit(); },

    /* --- 分類（属性・グループ） --- */
    attrs: () => state.taxonomy.attrs,
    attrLabels: () => state.taxonomy.attrs.map((a) => a.label),
    attrColor(label) {
      const a = state.taxonomy.attrs.find((x) => x.label === label);
      return a ? a.color : '#7f8f5a';
    },
    addAttr(label, kind) {
      if (!label || state.taxonomy.attrs.some((a) => a.label === label)) return;
      state.taxonomy.attrs.unshift({
        id: uid(), label, kind: kind || 'normal', color: KIND_COLOR[kind] || '#7f8f5a'
      });
    },
    groups: () => state.taxonomy.groups,
    groupLabel(id) {
      const g = state.taxonomy.groups.find((x) => x.id === id);
      return g ? g.label : id;
    },
    groupColor(id) {
      const g = state.taxonomy.groups.find((x) => x.id === id);
      return g ? g.color : '#7f8f5a';
    },

    /* --- 登録フェーズ --- */
    finishOnboarding(patch) {
      Object.assign(state, patch, { onboarded: true });
      commit();
    },
    isOnboarded: () => !!state.onboarded,

    /* --- 単位 --- */
    creditStatus, creditBuckets, nodeState, creditGaps,
    setRequirements(req) { state.credits.requirements = req; commit(); },
    setTranscript(tx) { state.credits.transcript = tx; commit(); },

    /* --- funds --- */
    addFunds(amount, memo) {
      state.funds.balance += amount;
      state.funds.log.push({ date: today(), amount, memo: memo || '' });
      commit();
    },
    setBalance(v, memo) {
      state.funds.log.push({ date: today(), amount: v - state.funds.balance, memo: memo || '残高調整', anchor: true });
      state.funds.balance = v;
      commit();
    },

    /* --- sleep --- */
    logSleep(hours, date) {
      const d = date || today();
      const hit = state.sleep.log.find((s) => s.date === d);
      if (hit) hit.hours = hours; else state.sleep.log.push({ date: d, hours });
      state.sleep.log.sort((a, b) => a.date.localeCompare(b.date));
      state.sleep.log = state.sleep.log.slice(-60);
      commit();
    },
    recentSleep(n = 7) {
      const out = [];
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const hit = state.sleep.log.find((s) => s.date === key);
        out.push({ date: key, hours: hit ? hit.hours : null });
      }
      return out;
    },

    /* --- schedule --- */
    addSchedule(item) { state.schedule.push(Object.assign({ id: uid() }, item)); commit(); },
    removeSchedule(id) { state.schedule = state.schedule.filter((s) => s.id !== id); commit(); },

    /* --- tasks --- */
    addTask(t) { state.tasks.unshift(Object.assign({ id: uid(), created: today() }, t)); commit(); },
    updateTask(id, patch) {
      const t = state.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      commit();
    },
    completeTask(id) {
      state.tasks = state.tasks.filter((t) => t.id !== id);
      state.cleared += 1;
      commit();
    },
    deleteTask(id) { state.tasks = state.tasks.filter((t) => t.id !== id); commit(); },

    /* --- persons --- */
    addPerson(p) { state.persons.push(Object.assign({ id: uid() }, p)); commit(); },
    updatePerson(id, patch) {
      const p = state.persons.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
      commit();
    },
    removePerson(id) {
      if (id === 'self') return;
      state.persons = state.persons.filter((p) => p.id !== id);
      commit();
    }
  };
})();
