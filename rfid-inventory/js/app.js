/* ============================================================
 * app.js — 页面渲染与交互
 * ============================================================ */

const state = {
  books: generateCollection(),  // 全部馆藏
  result: null,                 // 最近一次比对结果
  hierarchy: null,              // 分层视图数据
  scopeDesc: '',
};

const CAT_LABEL = {
  matched: '正常在架', misplaced: '错架', missing: '缺失',
  checkedOut: '借出/修补', unknown: '未登记',
};

/* ---------------- 盘点控制 ---------------- */

function currentScopeFilter() {
  const floor = document.getElementById('scopeFloor').value;
  const room  = document.getElementById('scopeRoom').value;
  return b => (!floor || b.floor === floor) && (!room || b.room === room);
}

function onFloorChange() {
  const floor = document.getElementById('scopeFloor').value;
  const roomSel = document.getElementById('scopeRoom');
  roomSel.innerHTML = '<option value="">全部书库</option>';
  if (floor) {
    const fl = LOCATIONS.find(l => l.floor === floor);
    for (const r of fl.rooms) {
      roomSel.innerHTML += `<option value="${r.room}">${r.room}</option>`;
    }
  }
}

function startScan() {
  const filter = currentScopeFilter();
  const scopeBooks = state.books.filter(filter);
  if (!scopeBooks.length) { alert('所选范围内没有馆藏'); return; }

  const floor = document.getElementById('scopeFloor').value || '全部楼层';
  const room  = document.getElementById('scopeRoom').value || '全部书库';
  state.scopeDesc = `${floor} / ${room}`;

  const scans = simulateScan(state.books, filter);
  state.result = compareInventory(scopeBooks, scans);
  state.hierarchy = buildHierarchy(state.result);

  renderAll();
  document.getElementById('resultArea').style.display = 'block';
}

/* ---------------- 渲染：仪表盘 ---------------- */

function statCard(label, value, cls) {
  return `<div class="stat-card ${cls}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function renderDashboard() {
  const r = state.result;
  const total = r.matched.length + r.misplaced.length + r.missing.length +
                r.checkedOut.length + r.unknown.length;
  const acc = total ? ((r.matched.length / total) * 100).toFixed(1) : '—';
  document.getElementById('dashboard').innerHTML = `
    <div class="dash-header">
      <h2>盘点结果总览</h2>
      <span class="scope-tag">范围：${state.scopeDesc} ｜ 时间：${r.time}</span>
    </div>
    <div class="stat-row">
      ${statCard('盘点条目', total, '')}
      ${statCard('正常在架', r.matched.length, 'ok')}
      ${statCard('错架', r.misplaced.length, 'warn')}
      ${statCard('缺失', r.missing.length, 'bad')}
      ${statCard('借出/修补', r.checkedOut.length, 'muted')}
      ${statCard('未登记标签', r.unknown.length, 'muted')}
      ${statCard('在架准确率', acc + '%', acc >= 95 ? 'ok' : 'warn')}
    </div>`;
}

/* ---------------- 渲染：分层浏览（楼层→书库→分类号） ---------------- */

function badge(n, cls) { return n ? `<span class="badge ${cls}">${n}</span>` : `<span class="badge zero">0</span>`; }

function statsLine(s) {
  return `<span class="stats-line">
    正常 ${badge(s.matched, 'ok')} 错架 ${badge(s.misplaced, 'warn')}
    缺失 ${badge(s.missing, 'bad')} 借出 ${badge(s.checkedOut, 'muted')}
    ${s.unknown ? `未登记 ${badge(s.unknown, 'muted')}` : ''}
  </span>`;
}

function itemRow(e) {
  if (e.cat === 'unknown') {
    return `<tr class="row-unknown"><td>${e.scan.rfid}</td><td colspan="2">（系统无记录）</td>
      <td>扫于 ${e.scan.floor}/${e.scan.room}/${e.scan.shelf}</td><td>${CAT_LABEL.unknown}</td></tr>`;
  }
  const b = e.book;
  const loc = `${b.floor}/${b.room}/${b.shelf}`;
  let extra = loc;
  if (e.cat === 'misplaced') {
    extra = `应在 ${loc}，扫于 ${e.actual.floor}/${e.actual.room}/${e.actual.shelf}`;
  }
  return `<tr class="row-${e.cat}">
    <td>${b.barcode}</td><td class="t-title">${b.title}</td><td>${b.callNumber}</td>
    <td>${extra}</td><td>${CAT_LABEL[e.cat]}</td></tr>`;
}

function renderHierarchy() {
  const el = document.getElementById('hierarchy');
  let html = '';
  for (const f of state.hierarchy) {
    html += `<details class="lv1" open><summary>🏢 ${f.floor} <span class="dim">（${f.stats.total} 条）</span> ${statsLine(f.stats)}</summary>`;
    for (const r of f.rooms) {
      html += `<details class="lv2"><summary>📚 ${r.room} ${statsLine(r.stats)}</summary>`;
      for (const c of r.classes) {
        html += `<details class="lv3"><summary>分类号 ${c.classCode} ${statsLine(c.stats)}</summary>
          <table class="detail-table">
            <thead><tr><th>条码号</th><th>书名</th><th>索书号</th><th>位置信息</th><th>状态</th></tr></thead>
            <tbody>${c.items.map(itemRow).join('')}</tbody>
          </table></details>`;
      }
      html += '</details>';
    }
    html += '</details>';
  }
  el.innerHTML = html;
}

/* ---------------- 渲染：错架整理清单 ---------------- */

let misGroupMode = 'target';

function renderMisplaced() {
  const groups = buildMisplacedList(state.result, misGroupMode);
  const modeLabel = misGroupMode === 'target' ? '按应归架位分组（归架用）' : '按当前位置分组（取书用）';
  let html = `<div class="list-header">
      <span>共 <b>${state.result.misplaced.length}</b> 册错架图书 ｜ ${modeLabel}</span>
      <span>
        <button class="btn small" onclick="toggleMisMode()">切换分组方式</button>
        <button class="btn small" onclick="exportMisplaced()">导出 CSV</button>
        <button class="btn small" onclick="printSection('misplacedList','错架整理清单')">打印</button>
      </span></div>`;
  if (!groups.length) { html += '<p class="empty">🎉 没有错架图书</p>'; }
  for (const g of groups) {
    html += `<div class="group-block"><h4>📍 ${g.location} <span class="dim">（${g.items.length} 册）</span></h4>
      <table class="detail-table"><thead><tr>
        <th>条码号</th><th>书名</th><th>索书号</th><th>当前位置</th><th>应归位置</th><th>错架层级</th>
      </tr></thead><tbody>`;
    for (const e of g.items) {
      const b = e.book;
      html += `<tr><td>${b.barcode}</td><td class="t-title">${b.title}</td><td>${b.callNumber}</td>
        <td>${e.actual.floor}/${e.actual.room}/${e.actual.shelf}</td>
        <td>${b.floor}/${b.room}/${b.shelf}</td>
        <td><span class="badge warn">${e.misLevel}错架</span></td></tr>`;
    }
    html += '</tbody></table></div>';
  }
  document.getElementById('misplacedList').innerHTML = html;
}

function toggleMisMode() {
  misGroupMode = misGroupMode === 'target' ? 'current' : 'target';
  renderMisplaced();
}

function exportMisplaced() {
  const rows = state.result.misplaced.map(e => [
    e.book.barcode, e.book.title, e.book.callNumber,
    `${e.actual.floor}/${e.actual.room}/${e.actual.shelf}`,
    `${e.book.floor}/${e.book.room}/${e.book.shelf}`, e.misLevel,
  ]);
  downloadCsv('错架整理清单.csv', toCsv(rows, ['条码号', '书名', '索书号', '当前位置', '应归位置', '错架层级']));
}

/* ---------------- 渲染：缺失清单 ---------------- */

function renderMissing() {
  const byFloor = groupBy(state.result.missing, e => e.book.floor);
  let html = `<div class="list-header">
      <span>共 <b>${state.result.missing.length}</b> 册缺失图书（在馆但未扫到）</span>
      <span><button class="btn small" onclick="exportMissing()">导出 CSV</button>
      <button class="btn small" onclick="printSection('missingList','缺失图书清单')">打印</button></span></div>`;
  if (!state.result.missing.length) html += '<p class="empty">🎉 没有缺失图书</p>';
  for (const [floor, items] of [...byFloor.entries()].sort()) {
    html += `<div class="group-block"><h4>🏢 ${floor} <span class="dim">（${items.length} 册）</span></h4>
      <table class="detail-table"><thead><tr>
        <th>条码号</th><th>书名</th><th>索书号</th><th>应在位置</th>
      </tr></thead><tbody>`;
    for (const e of items) {
      const b = e.book;
      html += `<tr><td>${b.barcode}</td><td class="t-title">${b.title}</td><td>${b.callNumber}</td>
        <td>${b.floor}/${b.room}/${b.shelf}</td></tr>`;
    }
    html += '</tbody></table></div>';
  }
  document.getElementById('missingList').innerHTML = html;
}

function exportMissing() {
  const rows = state.result.missing.map(e => [
    e.book.barcode, e.book.title, e.book.callNumber,
    `${e.book.floor}/${e.book.room}/${e.book.shelf}`,
  ]);
  downloadCsv('缺失图书清单.csv', toCsv(rows, ['条码号', '书名', '索书号', '应在位置']));
}

/* ---------------- 打印 ---------------- */

function printSection(sectionId, title) {
  const content = document.getElementById(sectionId).innerHTML;
  const win = window.open('', '_blank');
  win.document.write(`<html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%;margin-bottom:16px}
    td,th{border:1px solid #999;padding:4px 8px;font-size:12px;text-align:left}h4{margin:12px 0 4px}</style>
    </head><body><h2>${title}</h2><p>盘点范围：${state.scopeDesc} ｜ ${state.result.time}</p>${content}</body></html>`);
  win.document.close();
  win.print();
}

/* ---------------- 标签页切换与初始化 ---------------- */

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}

function renderAll() {
  renderDashboard();
  renderHierarchy();
  renderMisplaced();
  renderMissing();
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('collectionSize').textContent = state.books.length;
});
