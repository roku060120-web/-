/* ============================================================
   app.js — 画面遷移（スワイプ）/ 初期化
   ============================================================ */
(() => {
  const rail = document.getElementById('rail');
  const viewport = document.getElementById('viewport');
  const dotsEl = document.getElementById('dots');
  const PAGES = [
    { key: 'status', label: '01 STATUS' },
    { key: 'tasks', label: '02 OPS' },
    { key: 'persons', label: '03 NETWORK' },
    { key: 'credits', label: '04 CREDITS' }
  ];
  let page = 0;

  /* ---- ページ送り ---- */
  function apply(offsetPx = 0) {
    const pct = -(page * (100 / PAGES.length));
    rail.style.transform = `translateX(calc(${pct}% + ${offsetPx}px))`;
  }
  function goTo(i, silent) {
    page = Math.max(0, Math.min(PAGES.length - 1, i));
    apply();
    dotsEl.querySelectorAll('button').forEach((b, idx) => b.classList.toggle('on', idx === page));
    if (page === 2) setTimeout(() => NetworkPage.resize(), 260);
    if (!silent) localStorage.setItem('lifegame.page', String(page));
  }
  window.AppNav = { goToKey: (key) => goTo(PAGES.findIndex((p) => p.key === key)) };

  dotsEl.innerHTML = PAGES.map((p, i) => `<button data-page-idx="${i}">${p.label}</button>`).join('');
  dotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page-idx]');
    if (b) goTo(Number(b.dataset.pageIdx));
  });
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => goTo(page + Number(b.dataset.nav)));
  });
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('modalBg').hidden) return;
    if (e.key === 'ArrowRight') goTo(page + 1);
    if (e.key === 'ArrowLeft') goTo(page - 1);
  });

  /* ---- スワイプ（左スワイプで次ページへ） ---- */
  let startX = 0, startY = 0, dx = 0, tracking = false, decided = false, horizontal = false;

  viewport.addEventListener('pointerdown', (e) => {
    // ノードを掴んだときだけグラフ操作を優先。背景ドラッグはページ送り
    if (e.target.closest('#netCanvas') && NetworkPage.hitAt(e.clientX, e.clientY)) return;
    // 作戦マップはネイティブの横スクロールに任せる（ページ送りと競合させない）
    if (e.target.closest('#mapWrap')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tracking = true; decided = false; horizontal = false;
    startX = e.clientX; startY = e.clientY; dx = 0;
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) rail.classList.add('dragging');
    }
    if (!horizontal) return;
    // 端では引っぱりを弱める
    let d = dx;
    if ((page === 0 && dx > 0) || (page === PAGES.length - 1 && dx < 0)) d = dx * 0.3;
    apply(d);
  });

  function release() {
    if (!tracking) return;
    tracking = false;
    rail.classList.remove('dragging');
    if (horizontal) {
      const th = Math.min(90, viewport.clientWidth * 0.18);
      if (dx < -th) goTo(page + 1);
      else if (dx > th) goTo(page - 1);
      else apply();
    }
    dx = 0;
  }
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);
  viewport.addEventListener('pointerleave', release);
  window.addEventListener('resize', () => apply());

  /* ---- グローバルなアクションボタン ---- */
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'edit-funds': StatusPage.editFunds(); break;
      case 'edit-credit': StatusPage.editCredit(); break;
      case 'log-sleep': StatusPage.logSleep(); break;
      case 'add-sched': StatusPage.addSchedule(); break;
      case 'add-task': TasksPage.addTask(); break;
      case 'add-person': NetworkPage.addPerson(); break;
      default: break;
    }
  });

  /* ---- コールサイン変更 / 再登録（HUDタップ） ---- */
  document.getElementById('callsign').addEventListener('click', () => {
    const p = Store.get().profile;
    UI.openModal({
      title: 'OPERATOR // 設定',
      fields: [
        { name: 'callsign', label: 'コールサイン', type: 'text', value: p.callsign, required: true },
        { name: 'grade', label: '学年', type: 'number', value: p.grade, min: 1 },
        { name: 'term', label: '学期', type: 'seg', options: ['春', '秋'], value: p.term },
        { name: 'reenlist', label: '最初から登録し直す場合は RESET と入力', type: 'text', placeholder: 'RESET' }
      ],
      submitLabel: 'SET',
      onSubmit: (d) => {
        if ((d.reenlist || '').trim().toUpperCase() === 'RESET') {
          Store.reset();
          startEnlistment();
          return;
        }
        Object.assign(Store.get().profile, {
          callsign: d.callsign.toUpperCase(), grade: Number(d.grade) || p.grade, term: d.term
        });
        Store.commit();
      }
    });
  });

  /* ---- クラウド（ログイン / 他端末同期）---- */
  const hudCloudBtn = document.getElementById('hudCloud');
  function renderCloudStatus() {
    const on = Cloud.isLoggedIn();
    hudCloudBtn.textContent = on ? ('☁ ' + Cloud.userEmail().split('@')[0]) : '☁ LOGIN';
    hudCloudBtn.classList.toggle('on', on);
  }
  hudCloudBtn.addEventListener('click', () => {
    if (Cloud.isLoggedIn()) {
      UI.openModal({
        title: 'CLOUD // アカウント',
        html: `
          <p class="hint">ログイン中: ${UI.esc(Cloud.userEmail())}</p>
          <p class="hint">他の端末でも同じメールアドレスでログインすれば、続きを見られます。</p>`,
        submitLabel: 'LOGOUT',
        onSubmit: async () => { await Cloud.signOut(); }
      });
    } else {
      UI.openModal({
        title: 'CLOUD // ログイン',
        fields: [
          { name: 'email', label: 'メールアドレス', type: 'email', required: true, placeholder: '例: you@example.com' }
        ],
        submitLabel: 'SEND LINK',
        onSubmit: async (d) => {
          UI.toast('送信中...');
          const err = await Cloud.sendMagicLink(d.email);
          UI.toast(err ? ('送信失敗: ' + err) : 'メールを送信しました。届いたリンクを開いてください');
        }
      });
    }
  });
  let bootDone = false;
  Cloud.onAuth(async (session) => {
    if (!bootDone) return; // 起動時の初期状態通知はStore.init()側で処理済みなので無視
    if (session) {
      const cloudData = await Cloud.pull();
      if (cloudData && Object.keys(cloudData).length) {
        Store.replaceState(cloudData);
        UI.toast('ログインしました（クラウドの内容を読み込み）');
      } else {
        await Cloud.push(Store.get());
        UI.toast('ログインしました');
      }
    } else {
      UI.toast('ログアウトしました');
    }
    renderCloudStatus();
  });

  /* ---- 時計 ---- */
  function tick() {
    const n = new Date();
    const p = (v) => String(v).padStart(2, '0');
    document.getElementById('hudClock').textContent = `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
    document.getElementById('hudDate').textContent =
      `${n.getFullYear()}.${p(n.getMonth() + 1)}.${p(n.getDate())} ${UI.DAY_EN[n.getDay()]}`;
  }
  setInterval(tick, 1000);
  tick();

  /* ---- 描画 ---- */
  function renderAll() {
    StatusPage.render();
    TasksPage.render();
    NetworkPage.render();
    CreditsPage.render();
  }
  Store.subscribe(renderAll);

  /* ---- ①登録フェーズ → ②メインフェーズ ---- */
  function startEnlistment() {
    Onboarding.start(() => {
      renderAll();
      NetworkPage.resize();
      goTo(0);
      UI.toast('WELCOME, ' + (Store.get().profile.callsign || 'OPERATOR'));
    });
  }

  /* ---- 起動 ----
     Cloud.init()でログイン状態を確認してから、data/state.json（ローカルサーバ経由）または
     クラウドを読みに行って初回描画する。サーバもログインも無い環境ではlocalStorageのまま進む。 */
  async function boot() {
    await Cloud.init();
    await Store.init();
    NetworkPage.init();
    CreditsPage.init();
    renderAll();
    renderCloudStatus();
    goTo(Number(localStorage.getItem('lifegame.page') || 0), true);
    if (!Store.isOnboarded()) startEnlistment();
    bootDone = true;
    console.log('%c LIFE GAME // TACTICAL OPS ONLINE ', 'background:#7f8f5a;color:#0b0f0c');
  }
  boot();
})();
