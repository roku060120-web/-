/* ============================================================
   ui.js — 共通UI（モーダル / トースト / 汎用ヘルパ）
   ============================================================ */
const UI = (() => {
  const bg = document.getElementById('modalBg');
  const form = document.getElementById('modalForm');
  const titleEl = document.getElementById('modalTitle');
  const toastEl = document.getElementById('toast');
  let submitHandler = null;
  let toastTimer = null;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* --- 日付ユーティリティ --- */
  const DAY_JP = ['日', '月', '火', '水', '木', '金', '土'];
  const DAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((target - now) / 86400000);   // カレンダー日数で算出
  }
  function dueLabel(dateStr) {
    const d = daysUntil(dateStr);
    if (d === null) return { text: 'NO DEADLINE', cls: '' };
    if (d < 0) return { text: `OVERDUE ${Math.abs(d)}D`, cls: 'over' };
    if (d === 0) return { text: 'D-DAY', cls: 'over' };
    if (d <= 2) return { text: `D-${d}`, cls: 'warn' };
    return { text: `D-${d}`, cls: '' };
  }

  /* --- toast --- */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  /* --- modal --- */
  function fieldHTML(f) {
    const v = f.value == null ? '' : f.value;
    let inner = '';
    if (f.type === 'textarea') {
      inner = `<textarea name="${f.name}" placeholder="${esc(f.placeholder || '')}"
        ${f.required ? 'required' : ''}>${esc(v)}</textarea>`;
    } else if (f.type === 'select') {
      inner = `<select name="${f.name}">` + f.options.map((o) => {
        const val = o.value !== undefined ? o.value : o;
        const lab = o.label !== undefined ? o.label : o;
        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('') + `</select>`;
    } else if (f.type === 'seg') {
      inner = `<div class="seg">` + f.options.map((o, i) => {
        const checked = String(o) === String(v) || (v === '' && i === 0);
        return `<label><input type="radio" name="${f.name}" value="${esc(o)}" ${checked ? 'checked' : ''}>
          <span>${esc(o)}</span></label>`;
      }).join('') + `</div>`;
    } else {
      inner = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}"
        placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''}
        ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.required ? 'required' : ''}>`;
    }
    return `<div class="field"><label>${esc(f.label)}</label>${inner}</div>`;
  }

  function openModal({ title, fields, html, submitLabel, onSubmit }) {
    titleEl.textContent = title;
    form.innerHTML = html !== undefined ? html : fields.map(fieldHTML).join('');
    bg.querySelector('.btn:not(.ghost)').textContent = submitLabel || 'CONFIRM';
    submitHandler = onSubmit;
    bg.hidden = false;
    const first = form.querySelector('input:not([type=radio]),textarea,select');
    if (first) setTimeout(() => first.focus(), 60);
  }

  function closeModal() {
    bg.hidden = true;
    form.innerHTML = '';
    submitHandler = null;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {};
    new FormData(form).forEach((val, key) => { data[key] = val; });
    const fn = submitHandler;
    closeModal();
    if (fn) fn(data);
  });

  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.dataset.act === 'close-modal') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !bg.hidden) closeModal();
  });

  return { esc, toast, openModal, closeModal, daysUntil, dueLabel, DAY_JP, DAY_EN };
})();
