/* ============================================================
   tasks.js — PAGE 02 : OPERATIONS（タスク）
   ============================================================ */
const TasksPage = (() => {
  const listEl = document.getElementById('taskList');
  const emptyEl = document.getElementById('taskEmpty');
  const filtersEl = document.getElementById('filters');
  const gapPanel = document.getElementById('gapPanel');
  const gapListEl = document.getElementById('gapList');
  let filter = 'ALL';
  const openIds = new Set();

  const PRI_ORDER = { '必須': 0, 'サブ': 1, '余暇': 2 };

  function sorted(tasks) {
    return tasks.slice().sort((a, b) => {
      const pa = PRI_ORDER[a.priority] ?? 9, pb = PRI_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  }

  function render() {
    const all = Store.get().tasks;
    const list = filter === 'ALL' ? all : all.filter((t) => t.priority === filter);
    emptyEl.style.display = list.length ? 'none' : 'block';

    listEl.innerHTML = sorted(list).map((t) => {
      const due = UI.dueLabel(t.due);
      const open = openIds.has(t.id);
      return `
      <article class="task ${open ? 'open' : ''}" data-id="${t.id}">
        <div class="task-top">
          <button class="chk" data-act="complete" aria-label="完了">☐</button>
          <div class="task-main" data-act="toggle">
            <div class="task-title">
              <span class="caret">▶</span>
              <span class="name">${UI.esc(t.title)}</span>
            </div>
            <div class="task-meta">
              ${t.creditNodeId ? '<span class="tag story">STORY</span>' : ''}
              <span class="tag pri-${UI.esc(t.priority)}">${UI.esc(t.priority)}</span>
              <span class="tag attr" style="border-color:${Store.attrColor(t.attr)};color:${Store.attrColor(t.attr)}">${UI.esc(t.attr)}</span>
              <span class="due ${due.cls}">${due.text}${t.due ? ' / ' + t.due.slice(5).replace('-', '.') : ''}</span>
            </div>
          </div>
        </div>
        <div class="task-detail">
          <div class="detail-in">
            <dl>
              <dt>締切日</dt><dd>${t.due ? UI.esc(t.due) : '—'}</dd>
              <dt>内容</dt><dd>${UI.esc(t.body) || '—'}</dd>
              <dt>必要なもの</dt><dd>${UI.esc(t.needs) || '—'}</dd>
              <dt>完了条件</dt><dd>${UI.esc(t.done) || '—'}</dd>
              <dt>属性</dt><dd>${UI.esc(t.attr)}</dd>
              <dt>重要度</dt><dd>${UI.esc(t.priority)}</dd>
            </dl>
            <div class="detail-act">
              <button class="mini-btn" data-act="edit">EDIT</button>
              <button class="mini-btn" data-act="delete">ABORT</button>
            </div>
          </div>
        </div>
      </article>`;
    }).join('');

    renderGaps();
  }

  /* ---- 単位ギャップ（不足している要件の葉ノードだけを一覧化） ---- */
  function renderGaps() {
    const gaps = Store.creditGaps();
    if (!gaps.length) { gapPanel.hidden = true; return; }
    gapPanel.hidden = false;

    const tasks = Store.get().tasks;
    gapListEl.innerHTML = gaps.map((n) => {
      const already = tasks.some((t) => t.creditNodeId === n.id);
      return `
      <div class="gap-row" data-node-id="${UI.esc(n.id)}">
        <span class="cc-name">${UI.esc(n.name)}</span>
        <span class="cc-credits">あと${n.short}単位</span>
        ${already
          ? '<span class="gap-done">TASK済み</span>'
          : `<button class="mini-btn" data-act="gap-to-task" data-node-id="${UI.esc(n.id)}">+ TASK</button>`}
      </div>`;
    }).join('');
  }

  /* ---- 追加 / 編集フォーム ---- */
  function taskFields(t) {
    t = t || {};
    return [
      { name: 'title', label: 'タスク名', type: 'text', value: t.title, required: true, placeholder: '例: レポート提出' },
      { name: 'due', label: '締切日', type: 'date', value: t.due || Store.inDays(3) },
      { name: 'body', label: '内容', type: 'textarea', value: t.body, placeholder: '何をするのか' },
      { name: 'needs', label: '必要なもの', type: 'textarea', value: t.needs, placeholder: '例: 教科書 / ノートPC' },
      { name: 'done', label: '完了条件', type: 'textarea', value: t.done, placeholder: '例: 提出フォームに送信' },
      { name: 'attr', label: '属性', type: 'seg', options: Store.attrLabels(), value: t.attr || 'ノーマル' },
      { name: 'priority', label: '重要度', type: 'seg', options: Store.PRIORITIES, value: t.priority || 'サブ' }
    ];
  }

  function addTask() {
    UI.openModal({
      title: 'NEW OPERATION // 任務追加',
      fields: taskFields(),
      submitLabel: 'DEPLOY',
      onSubmit: (d) => { Store.addTask(d); UI.toast('OPERATION DEPLOYED'); }
    });
  }

  function editTask(id) {
    const t = Store.get().tasks.find((x) => x.id === id);
    if (!t) return;
    UI.openModal({
      title: 'EDIT OPERATION // 任務編集',
      fields: taskFields(t),
      submitLabel: 'UPDATE',
      onSubmit: (d) => { Store.updateTask(id, d); UI.toast('OPERATION UPDATED'); }
    });
  }

  /* ---- イベント ---- */
  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('.task');
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;

    if (act === 'complete') {
      card.classList.add('clear');
      openIds.delete(id);
      setTimeout(() => { Store.completeTask(id); UI.toast('MISSION CLEARED'); }, 260);
    } else if (act === 'toggle') {
      if (openIds.has(id)) openIds.delete(id); else openIds.add(id);
      card.classList.toggle('open');
    } else if (act === 'edit') {
      editTask(id);
    } else if (act === 'delete') {
      Store.deleteTask(id);
      UI.toast('OPERATION ABORTED');
    }
  });

  gapListEl.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-act="gap-to-task"]');
    if (addBtn) {
      const n = Store.creditGaps().find((g) => g.id === addBtn.dataset.nodeId);
      if (n) {
        Store.addTask({
          title: `${n.name}を履修登録`,
          due: '', body: `あと${n.short}単位が必要です。`, needs: '', done: '履修登録が完了する',
          attr: '大学', priority: '必須', creditNodeId: n.id
        });
        UI.toast('OPERATION DEPLOYED');
      }
      return;
    }
    const row = e.target.closest('[data-node-id]');
    if (row) CreditsPage.showNode(row.dataset.nodeId);
  });

  filtersEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.filter;
    filtersEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    render();
  });

  return { render, addTask };
})();
