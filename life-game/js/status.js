/* ============================================================
   status.js — PAGE 01 : STATUS（所持金 / 単位 / 週次予定 / ヘルス）
   ============================================================ */
const StatusPage = (() => {
  const $ = (id) => document.getElementById(id);
  const yen = (n) => Number(n || 0).toLocaleString('ja-JP');

  function render() {
    const s = Store.get();

    /* ---- FUNDS ---- */
    $('fundsVal').textContent = yen(s.funds.balance);
    const goal = s.funds.goal || 100000;
    $('fundsBar').style.width = Math.max(0, Math.min(100, (s.funds.balance / goal) * 100)) + '%';
    const weekAgo = Store.inDays(-7);
    const delta = s.funds.log.filter((l) => l.date >= weekAgo && !l.anchor)
      .reduce((a, b) => a + b.amount, 0);
    $('fundsDelta').textContent = `${delta >= 0 ? '+' : '-'}¥${yen(Math.abs(delta))} / 7DAYS`;
    $('fundsDelta').style.color = delta >= 0 ? 'var(--green)' : 'var(--alert)';

    /* ---- CREDITS ---- */
    const cs = Store.creditStatus();
    $('creditVal').textContent = cs.total.earned;
    $('creditReq').textContent = cs.total.need;
    $('creditBar').style.width = cs.total.pct + '%';
    $('creditPct').textContent = cs.total.wip
      ? `${cs.total.pct.toFixed(1)}% / 履修中 ${cs.total.wip}`
      : `${cs.total.pct.toFixed(1)}% CLEARED`;
    renderBuckets(cs);

    /* ---- HEALTH ---- */
    const recent = Store.recentSleep(7).filter((d) => d.hours != null);
    const avg = recent.length ? recent.reduce((a, b) => a + b.hours, 0) / recent.length : 0;
    const target = s.sleep.target || 7;
    $('sleepVal').textContent = avg.toFixed(1);
    const sBar = $('sleepBar');
    sBar.style.width = Math.min(100, (avg / target) * 100) + '%';
    sBar.className = 'bar-fill ' + (avg >= target ? 'ok' : avg >= target - 1 ? '' : 'bad');
    $('sleepState').textContent = !recent.length ? 'NO DATA'
      : avg >= target ? 'CONDITION: GREEN'
        : avg >= target - 1 ? 'CONDITION: AMBER' : 'CONDITION: RED';
    $('sleepState').style.color = !recent.length ? 'var(--dim)'
      : avg >= target ? 'var(--green)' : avg >= target - 1 ? 'var(--amber)' : 'var(--alert)';

    renderSpark();
    renderWeek();

    /* ---- STAT ROW ---- */
    $('statDone').textContent = s.cleared;
    $('statOpen').textContent = s.tasks.length;
    $('statUrgent').textContent = s.tasks.filter((t) => {
      const d = UI.daysUntil(t.due);
      return d !== null && d <= 2;
    }).length;

    $('callsign').textContent = s.profile.callsign
      ? `${s.profile.callsign}${s.profile.grade ? ' // ' + s.profile.grade + '年' + s.profile.term : ''}`
      : 'OPERATOR';
  }

  /* ---- 卒業要件バケツ ---- */
  function renderBuckets(cs) {
    const panel = $('reqPanel');
    if (cs.simple) { panel.hidden = true; return; }
    panel.hidden = false;

    const rows = [];
    const walk = (n, depth) => {
      if (n.need > 0 || depth === 0) rows.push({ n, depth });
      (n.children || []).forEach((c) => walk(c, depth + 1));
    };
    cs.buckets.forEach((b) => walk(b, 0));

    $('buckets').innerHTML = rows.map(({ n, depth }) => {
      const need = n.need || (n.earned + n.wip) || 1;
      const w = (v) => Math.min(100, (v / need) * 100);
      const done = n.need && n.earned >= n.need;
      return `
      <div class="bucket ${depth ? 'child' : ''}" data-node-id="${UI.esc(n.id)}">
        <div class="b-head">
          <span>${UI.esc(n.name)}</span>
          <em class="${done ? 'done' : ''}">${n.earned}${n.wip ? ` +${n.wip}` : ''} / ${n.need || '—'}</em>
        </div>
        <div class="b-bar">
          <i class="ok" style="width:${w(n.earned)}%"></i>
          <i class="wip" style="width:${w(n.wip)}%"></i>
          <i class="fail" style="width:${w(Math.min(n.fail, Math.max(0, need - n.earned - n.wip)))}%"></i>
        </div>
      </div>`;
    }).join('');
  }

  function renderSpark() {
    const days = Store.recentSleep(7);
    const target = Store.get().sleep.target || 7;
    $('sleepSpark').innerHTML = days.map((d) => {
      const h = d.hours || 0;
      const pct = Math.min(100, (h / 9) * 100);
      const label = UI.DAY_JP[new Date(d.date + 'T00:00:00').getDay()];
      return `<div class="${h && h < target - 1 ? 'low' : ''}" title="${d.date} / ${h || '-'}h">
        <i style="height:${pct}%"></i><span>${label}${h ? ' ' + h : ''}</span></div>`;
    }).join('');
  }

  function renderWeek() {
    const s = Store.get();
    const todayIdx = new Date().getDay();
    $('week').innerHTML = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const items = s.schedule.filter((x) => Number(x.day) === d)
        .sort((a, b) => a.start.localeCompare(b.start));
      return `<div class="wday ${d === todayIdx ? 'today' : ''}">
        <h4>${UI.DAY_EN[d]}</h4>
        ${items.map((it) => `
          <div class="slot" data-sched="${it.id}"
               style="border-left-color:${Store.attrColor(it.attr)};background:${Store.attrColor(it.attr)}22">
            <b>${UI.esc(it.start)}-${UI.esc(it.end)}</b>${UI.esc(it.title)}
          </div>`).join('')}
      </div>`;
    }).join('');
  }

  /* ---- モーダル群 ---- */
  function editFunds() {
    UI.openModal({
      title: 'FUNDS // 収支記録',
      fields: [
        { name: 'amount', label: '金額（支出は -1000 のようにマイナス）', type: 'number', placeholder: '例: 32000' },
        { name: 'memo', label: '摘要', type: 'text', placeholder: '例: 給料' },
        { name: 'balance', label: '実測残高で上書きする場合はこちら', type: 'number', placeholder: '例: 47000' },
        { name: 'goal', label: '目標金額', type: 'number', value: Store.get().funds.goal, min: 1 }
      ],
      submitLabel: 'RECORD',
      onSubmit: (d) => {
        const st = Store.get();
        if (d.goal) st.funds.goal = Number(d.goal);
        if (d.balance !== '') Store.setBalance(Number(d.balance), d.memo || '残高調整');
        else if (d.amount !== '') Store.addFunds(Number(d.amount), d.memo);
        else Store.commit();
        UI.toast('FUNDS UPDATED');
      }
    });
  }

  function editCredit() {
    const s = Store.get();
    if (s.credits.requirements) {
      window.AppNav.goToKey('credits');
      return;
    }
    UI.openModal({
      title: 'CREDITS // 単位登録',
      fields: [
        { name: 'earned', label: '取得済み単位', type: 'number', value: s.credits.manual.earned, min: 0, required: true },
        { name: 'required', label: '卒業要件単位', type: 'number', value: s.credits.manual.required, min: 1, required: true }
      ],
      submitLabel: 'UPDATE',
      onSubmit: (d) => {
        s.credits.manual = { earned: Number(d.earned), required: Number(d.required) };
        Store.commit();
        UI.toast('CREDITS UPDATED');
      }
    });
  }

  function logSleep() {
    UI.openModal({
      title: 'HEALTH // 睡眠記録',
      fields: [
        { name: 'date', label: '日付', type: 'date', value: Store.today(), required: true },
        { name: 'hours', label: '睡眠時間 (H)', type: 'number', step: '0.5', min: 0, required: true, placeholder: '例: 6.5' }
      ],
      submitLabel: 'RECORD',
      onSubmit: (d) => { Store.logSleep(Number(d.hours), d.date); UI.toast('VITALS LOGGED'); }
    });
  }

  function schedFields(item) {
    item = item || {};
    return [
      { name: 'title', label: '内容', type: 'text', value: item.title, required: true, placeholder: '例: 統計学' },
      { name: 'day', label: '曜日', type: 'select', options: UI.DAY_JP.map((j, i) => ({ value: i, label: `${j}曜日` })), value: item.day !== undefined ? item.day : new Date().getDay() },
      { name: 'start', label: '開始', type: 'time', value: item.start || '09:00', required: true },
      { name: 'end', label: '終了', type: 'time', value: item.end || '10:30', required: true },
      { name: 'attr', label: '属性', type: 'seg', options: Store.attrLabels(), value: item.attr || '大学' }
    ];
  }

  function addSchedule() {
    UI.openModal({
      title: 'SCHEDULE // 予定追加',
      fields: schedFields(),
      submitLabel: 'DEPLOY',
      onSubmit: (d) => {
        Store.addSchedule({ title: d.title, day: Number(d.day), start: d.start, end: d.end, attr: d.attr });
        UI.toast('SCHEDULE DEPLOYED');
      }
    });
  }

  document.getElementById('buckets').addEventListener('click', (e) => {
    const row = e.target.closest('[data-node-id]');
    if (row) CreditsPage.showNode(row.dataset.nodeId);
  });

  document.getElementById('week').addEventListener('click', (e) => {
    const slot = e.target.closest('[data-sched]');
    if (!slot) return;
    const item = Store.get().schedule.find((x) => x.id === slot.dataset.sched);
    if (!item) return;
    UI.openModal({
      title: 'SCHEDULE // 予定編集',
      fields: schedFields(item).concat(
        [{ name: 'remove', label: '削除する場合は DELETE と入力', type: 'text', placeholder: 'DELETE' }]
      ),
      submitLabel: 'UPDATE',
      onSubmit: (d) => {
        if ((d.remove || '').trim().toUpperCase() === 'DELETE') {
          Store.removeSchedule(item.id);
          UI.toast('SCHEDULE REMOVED');
          return;
        }
        Object.assign(item, { title: d.title, day: Number(d.day), start: d.start, end: d.end, attr: d.attr });
        Store.commit();
        UI.toast('SCHEDULE UPDATED');
      }
    });
  });

  return { render, editFunds, editCredit, logSleep, addSchedule };
})();
