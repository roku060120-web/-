/* ============================================================
   credits.js — PAGE 04 : CREDITS（単位の作戦マップ）
   卒業を頂点、要件を中間、末端の要件ノードを葉とする決定論的な階層レイアウト。
   NETWORK画面（力学レイアウトで毎回形が変わる）との対比で、常に同じ形の
   「地図」として使えることを狙う。ノードをタップすると充足内訳を表示する。
   ============================================================ */
const CreditsPage = (() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('mapCanvas');
  const ctx = canvas.getContext('2d');
  const wrap = $('mapWrap');
  const summaryEl = $('mapSummary');
  const legendEl = $('mapLegend');
  const emptyEl = $('mapEmpty');

  const ROW_H = 92;
  const LEAF_W = 66;
  const TOP_PAD = 34;
  const SIDE_PAD = 26;

  const COLOR = { green: '#9dc05a', amber: '#d8a33c', alert: '#c0472f', line: '#3a4a32', text: '#cbd6bc' };
  const STATE_COLOR = { earned: COLOR.green, wip: COLOR.amber, fail: COLOR.alert, avail: COLOR.green, none: COLOR.line };
  const STATE_LABEL = { earned: '取得済み', wip: '履修中', fail: '不合格（再履修）', avail: '履修可能', none: '未取得' };

  let W = 0, H = 0;
  let byId = new Map();     // レイアウト後のノード（座標つき）
  let selectedId = null;

  /* ---- ツリー構築（Storeの計算結果に「卒業」の仮想ルートを被せるだけ） ---- */
  function buildTree() {
    const cs = Store.creditStatus();
    if (cs.simple) return null;
    return {
      id: '__root__', name: '卒業', need: cs.total.need,
      earned: cs.total.earned, wip: cs.total.wip, fail: cs.total.fail,
      children: cs.buckets
    };
  }

  function findNode(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const r = findNode(c, id);
      if (r) return r;
    }
    return null;
  }

  /* ---- 決定論的な階層レイアウト（葉のインデックス平均で親のxを決める簡易Reingold-Tilford） ---- */
  function layout(root) {
    let leafCursor = 0;
    let maxDepth = 0;
    const map = new Map();

    function walk(n, depth, parentId) {
      maxDepth = Math.max(maxDepth, depth);
      const kids = n.children || [];
      let x;
      if (!kids.length) {
        x = leafCursor++;
      } else {
        const xs = kids.map((c) => walk(c, depth + 1, n.id));
        x = (Math.min(...xs) + Math.max(...xs)) / 2;
      }
      map.set(n.id, { ref: n, depth, xIdx: x, parentId });
      return x;
    }
    walk(root, 0, null);

    const leafCount = Math.max(1, leafCursor);
    W = Math.max(wrap.clientWidth || 300, leafCount * LEAF_W + SIDE_PAD * 2);
    H = (maxDepth + 1) * ROW_H + TOP_PAD + 20;

    map.forEach((rec) => {
      rec.x = SIDE_PAD + (rec.xIdx + 0.5) * ((W - SIDE_PAD * 2) / leafCount);
      rec.y = TOP_PAD + rec.depth * ROW_H;
      const need = rec.ref.need || (rec.ref.earned + rec.ref.wip) || 0;
      rec.r = Math.max(11, Math.min(27, 9 + Math.sqrt(need) * 2.1));
    });

    return map;
  }

  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function drawNode(rec) {
    const { x, y, r, ref, depth } = rec;
    const state = Store.nodeState(ref);
    const col = STATE_COLOR[state] || COLOR.line;

    if (ref.id === selectedId) {
      ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = state === 'earned' ? 'rgba(157,192,90,.55)'
      : state === 'wip' ? 'rgba(216,163,60,.32)'
        : state === 'fail' ? 'rgba(192,71,47,.3)'
          : 'rgba(10,14,8,.9)';
    ctx.fill();

    ctx.lineWidth = state === 'earned' ? 2 : 1.4;
    ctx.strokeStyle = col;
    ctx.setLineDash(state === 'wip' ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (state === 'fail') {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.65, y - r * 0.65);
      ctx.lineTo(x + r * 0.65, y + r * 0.65);
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    }

    ctx.font = depth === 0 ? '600 11px monospace' : '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.text;
    ctx.fillText(truncate(ref.name, depth === 0 ? 10 : 8), x, y + r + 13);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(44,58,38,.4)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

    ctx.strokeStyle = 'rgba(127,143,90,.5)';
    ctx.lineWidth = 1.3;
    byId.forEach((rec) => {
      if (!rec.parentId) return;
      const p = byId.get(rec.parentId);
      if (!p) return;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + p.r);
      ctx.lineTo(rec.x, rec.y - rec.r);
      ctx.stroke();
    });

    byId.forEach((rec) => drawNode(rec));
  }

  /* ---- 描画本体 ---- */
  function render() {
    const root = buildTree();
    if (!root) {
      summaryEl.hidden = true; wrap.hidden = true; legendEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true; summaryEl.hidden = false; wrap.hidden = false; legendEl.hidden = false;

    $('mapEarned').textContent = root.earned;
    $('mapNeed').textContent = root.need;
    $('mapBar').style.width = Math.max(0, Math.min(100, (root.earned / root.need) * 100)) + '%';

    byId = layout(root);
    draw();
  }

  /* ---- ノードタップ → 詳細モーダル ---- */
  function courseRowsHTML(courses) {
    if (!courses || !courses.length) return '<p class="hint">この分野にひもづく履修記録はまだありません。</p>';
    return `<div class="credit-course-list">${courses.map((c) => {
      const st = Store.gradeState(c.grade);
      return `<div class="credit-course-row">
        <span class="cc-name">${UI.esc(c.name)}</span>
        <span class="cc-meta">${UI.esc(c.teacher || '')}</span>
        <span class="cc-grade ${st}">${UI.esc(c.grade)}</span>
        <span class="cc-credits">${c.credits}単位</span>
      </div>`;
    }).join('')}</div>`;
  }

  function childRowsHTML(children) {
    return `<div class="credit-course-list">${children.map((c) => {
      const st = Store.nodeState(c);
      return `<div class="credit-course-row clickable" data-node-id="${UI.esc(c.id)}">
        <span class="cc-name">${UI.esc(c.name)}</span>
        <span class="cc-meta">${STATE_LABEL[st]}</span>
        <span class="cc-credits">${c.earned}${c.wip ? `+${c.wip}` : ''} / ${c.need || '—'}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function openDetail(n) {
    selectedId = n.id;
    draw();

    const need = n.need || (n.earned + n.wip) || 0;
    const short = Math.max(0, need - n.earned - n.wip);
    const hasChildren = n.children && n.children.length;

    UI.openModal({
      title: `CREDITS // ${n.name}`,
      html: `
        <dl class="confirm-grid">
          <dt>必要単位</dt><dd>${need || '—'}</dd>
          <dt>取得済み</dt><dd>${n.earned}</dd>
          ${n.wip ? `<dt>履修中</dt><dd>${n.wip}</dd>` : ''}
          ${n.fail ? `<dt>不合格</dt><dd class="cc-warn">${n.fail}（再履修対象）</dd>` : ''}
          <dt>不足</dt><dd>${short > 0 ? short : '達成済み'}</dd>
        </dl>
        ${n.note ? `<p class="hint">${UI.esc(n.note)}</p>` : ''}
        ${hasChildren ? childRowsHTML(n.children) : courseRowsHTML(n.courses)}
      `,
      submitLabel: 'CLOSE',
      onSubmit: () => {}
    });
  }

  function showNode(id) {
    const root = buildTree();
    const n = findNode(root, id);
    if (n) openDetail(n);
  }

  /* ---- 入力 ---- */
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, bestD = Infinity;
    byId.forEach((rec) => {
      const d = Math.hypot(rec.x - px, rec.y - py);
      if (d < rec.r + 10 && d < bestD) { bestD = d; best = rec; }
    });
    if (best) openDetail(best.ref);
  });

  // モーダル内の子ノード行をタップしたら、そのノードの詳細に掘り下げる
  document.getElementById('modalForm').addEventListener('click', (e) => {
    const row = e.target.closest('[data-node-id]');
    if (row) showNode(row.dataset.nodeId);
  });

  function init() {
    window.addEventListener('resize', () => render());
  }

  return { init, render, showNode };
})();
