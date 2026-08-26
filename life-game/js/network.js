/* ============================================================
   network.js — PAGE 03 : NETWORK（人物関係図 / 力学レイアウト）
   ============================================================ */
const NetworkPage = (() => {
  const canvas = document.getElementById('netCanvas');
  const ctx = canvas.getContext('2d');
  const cardEl = document.getElementById('personCard');

  const LINK_LEN = { family: 92, univ: 122, work: 132, circle: 112 };
  const color = (g) => Store.groupColor(g);
  const groupJp = (g) => Store.groupLabel(g);

  let nodes = [];
  let selectedId = null;
  let dragNode = null;
  let W = 0, H = 0, sweep = 0;

  /* ---- サイズ調整 ---- */
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width; H = rect.height;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- ノード同期（人物データ ↔ 物理ノード） ---- */
  function sync() {
    const persons = Store.get().persons;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    nodes = persons.map((p, i) => {
      const prev = byId.get(p.id);
      if (prev) { prev.p = p; return prev; }
      const angle = (i / Math.max(1, persons.length)) * Math.PI * 2;
      return {
        id: p.id, p,
        x: W / 2 + Math.cos(angle) * 110 + (Math.random() - 0.5) * 20,
        y: H / 2 + Math.sin(angle) * 110 + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0
      };
    });
    const self = nodes.find((n) => n.p.self);
    if (self) { self.x = self.x || W / 2; self.y = self.y || H / 2; }
  }

  /* ---- 物理シミュレーション ---- */
  function step() {
    const self = nodes.find((n) => n.p.self);
    if (!self) return;

    // 中心へ引き戻す（自分ノード）
    self.vx += (W / 2 - self.x) * 0.02;
    self.vy += (H / 2 - self.y) * 0.02;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      // ノード同士の反発
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
        const d = Math.sqrt(d2);
        const f = 2600 / d2;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
      // 自分ノードとのバネ
      if (!a.p.self) {
        const len = LINK_LEN[a.p.group] || 120;
        const dx = self.x - a.x, dy = self.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (d - len) * 0.012;
        a.vx += (dx / d) * f * d * 0.08;
        a.vy += (dy / d) * f * d * 0.08;
      }
    }

    for (const n of nodes) {
      if (n === dragNode) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += Math.max(-6, Math.min(6, n.vx));
      n.y += Math.max(-6, Math.min(6, n.vy));
      const m = 26;
      n.x = Math.max(m, Math.min(W - m, n.x));
      n.y = Math.max(m, Math.min(H - m, n.y));
    }
  }

  /* ---- 描画 ---- */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // グリッド
    ctx.strokeStyle = 'rgba(44,58,38,.5)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const self = nodes.find((n) => n.p.self);
    if (!self) return;

    // レーダーリング + スイープ
    ctx.strokeStyle = 'rgba(127,143,90,.28)';
    [60, 110, 165].forEach((r) => {
      ctx.beginPath(); ctx.arc(self.x, self.y, r, 0, Math.PI * 2); ctx.stroke();
    });
    sweep = (sweep + 0.011) % (Math.PI * 2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(self.x, self.y);
    ctx.arc(self.x, self.y, 175, sweep - 0.42, sweep);
    ctx.closePath();
    ctx.fillStyle = 'rgba(157,192,90,.07)';
    ctx.fill();
    ctx.restore();

    // エッジ
    nodes.forEach((n) => {
      if (n.p.self) return;
      const col = color(n.p.group);
      ctx.strokeStyle = n.id === selectedId ? col : 'rgba(127,143,90,.45)';
      ctx.lineWidth = n.id === selectedId ? 1.6 : 1;
      ctx.setLineDash(n.id === selectedId ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(self.x, self.y);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // ノード
    nodes.forEach((n) => {
      const isSelf = !!n.p.self;
      const r = isSelf ? 20 : 13;
      const col = isSelf ? '#e6f0d8' : color(n.p.group);

      if (n.id === selectedId) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 13, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(216,163,60,.45)'; ctx.stroke();
      }

      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelf ? 'rgba(230,240,216,.14)' : 'rgba(10,14,8,.9)';
      ctx.fill();
      ctx.lineWidth = isSelf ? 2 : 1.5;
      ctx.strokeStyle = col;
      ctx.stroke();

      // 中心のドット
      ctx.beginPath(); ctx.arc(n.x, n.y, isSelf ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();

      // ラベル
      ctx.font = isSelf ? '600 11px monospace' : '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = isSelf ? '#e6f0d8' : '#cbd6bc';
      ctx.fillText(n.p.name, n.x, n.y + r + (isSelf ? 22 : 14));
    });
  }

  function loop() {
    step();
    draw();
    requestAnimationFrame(loop);
  }

  /* ---- 詳細カード ---- */
  function renderCard() {
    const p = Store.get().persons.find((x) => x.id === selectedId);
    if (!p) {
      cardEl.innerHTML = '<div class="empty small">// SELECT A NODE //</div>';
      return;
    }
    if (p.self) {
      cardEl.innerHTML = `
        <div class="person-name">${UI.esc(p.name)}</div>
        <div class="person-sub">SELF NODE // 本人</div>
        <div class="empty small">// 接続数 ${Store.get().persons.length - 1} NODES //</div>`;
      return;
    }
    cardEl.innerHTML = `
      <div class="person-name">${UI.esc(p.name)}</div>
      <div class="person-sub">${groupJp(p.group)} / NODE ${UI.esc(p.id).slice(0, 6).toUpperCase()}</div>
      <dl class="person-grid">
        <dt>連絡先</dt><dd>${UI.esc(p.contact) || '—'}</dd>
        <dt>年齢</dt><dd>${p.age != null && p.age !== '' ? UI.esc(p.age) + ' 歳' : '—'}</dd>
        <dt>関係性</dt><dd>${UI.esc(p.relation) || '—'}</dd>
      </dl>
      <div class="detail-act">
        <button class="mini-btn" data-act="edit-person">EDIT</button>
        <button class="mini-btn" data-act="remove-person">REMOVE</button>
      </div>`;
  }

  /* ---- 入力 ---- */
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function hit(pt) {
    return nodes.find((n) => Math.hypot(n.x - pt.x, n.y - pt.y) < (n.p.self ? 24 : 20));
  }

  let downPt = null;

  canvas.addEventListener('pointerdown', (e) => {
    const pt = pos(e);
    downPt = pt;
    const n = hit(pt);
    if (n) {
      // ノードを掴んだときだけグラフ操作（それ以外はページスワイプに譲る）
      dragNode = n;
      selectedId = n.id;
      renderCard();
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragNode) return;
    const pt = pos(e);
    dragNode.x = pt.x; dragNode.y = pt.y;
    e.preventDefault();
  });
  canvas.addEventListener('pointerup', (e) => {
    const pt = pos(e);
    // 何もない場所を「タップ」したら選択解除（スワイプでは解除しない）
    if (!dragNode && downPt && Math.hypot(pt.x - downPt.x, pt.y - downPt.y) < 8) {
      selectedId = null;
      renderCard();
    }
    dragNode = null; downPt = null;
  });
  canvas.addEventListener('pointercancel', () => { dragNode = null; downPt = null; });

  cardEl.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit-person') editPerson(selectedId);
    if (act === 'remove-person') {
      Store.removePerson(selectedId);
      selectedId = null;
      UI.toast('NODE REMOVED');
    }
  });

  /* ---- 人物フォーム ---- */
  function personFields(p) {
    p = p || {};
    return [
      { name: 'name', label: '氏名', type: 'text', value: p.name, required: true, placeholder: '例: 田中 隆' },
      { name: 'contact', label: '連絡先', type: 'text', value: p.contact, placeholder: '例: LINE: tanaka_t' },
      { name: 'age', label: '年齢', type: 'number', value: p.age, min: 0 },
      { name: 'relation', label: '自分との関係性', type: 'textarea', value: p.relation, placeholder: '例: 大学の同級生 / 実験ペア' },
      {
        name: 'group', label: '所属', type: 'seg',
        options: Store.groups().map((g) => g.label), value: groupJp(p.group) || '大学'
      }
    ];
  }
  const groupKey = (jp) => (Store.groups().find((g) => g.label === jp) || { id: 'univ' }).id;

  function addPerson() {
    UI.openModal({
      title: 'NEW NODE // 人物追加',
      fields: personFields(),
      submitLabel: 'CONNECT',
      onSubmit: (d) => {
        Store.addPerson({
          name: d.name, contact: d.contact, age: d.age === '' ? null : Number(d.age),
          relation: d.relation, group: groupKey(d.group)
        });
        UI.toast('NODE CONNECTED');
      }
    });
  }

  function editPerson(id) {
    const p = Store.get().persons.find((x) => x.id === id);
    if (!p || p.self) return;
    UI.openModal({
      title: 'EDIT NODE // 人物編集',
      fields: personFields(p),
      submitLabel: 'UPDATE',
      onSubmit: (d) => {
        Store.updatePerson(id, {
          name: d.name, contact: d.contact, age: d.age === '' ? null : Number(d.age),
          relation: d.relation, group: groupKey(d.group)
        });
        UI.toast('NODE UPDATED');
      }
    });
  }

  function render() { sync(); renderCard(); }

  function init() {
    resize();
    sync();
    window.addEventListener('resize', () => { resize(); });
    loop();
  }

  /* 指定座標（画面座標）にノードがあるか — スワイプ判定用 */
  function hitAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return !!hit({ x: clientX - r.left, y: clientY - r.top });
  }

  return { init, render, resize, addPerson, hitAt, isDragging: () => !!dragNode };
})();
