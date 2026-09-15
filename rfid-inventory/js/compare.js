/* ============================================================
 * compare.js — 盘点比对引擎
 * 将 RFID 扫描结果与馆藏记录比对，产出五类结果：
 *   matched    正常在架
 *   misplaced  错架（扫到但位置不符）→ 生成整理清单
 *   missing    缺失（应在馆但未扫到）
 *   checkedOut 借出/修补（未扫到但状态可解释）
 *   unknown    未登记（扫到但系统无记录）
 * ============================================================ */

/**
 * 比对一次盘点
 * @param {Array<Book>} books  盘点范围内的馆藏
 * @param {Array<Scan>} scans  扫描记录
 * @returns {InventoryResult}
 */
function compareInventory(books, scans) {
  const bookByRfid = new Map(books.map(b => [b.rfid, b]));
  const scannedRfids = new Set(scans.map(s => s.rfid));

  const result = {
    time: new Date().toLocaleString('zh-CN'),
    matched: [],    // {book}
    misplaced: [],  // {book, actual:{floor,room,shelf}, misLevel:'架位'|'书库'|'楼层'}
    missing: [],    // {book}
    checkedOut: [], // {book} 借出/修补，未扫到属正常
    unknown: [],    // {scan} 系统无记录
  };

  // 1) 处理扫描到的标签
  for (const scan of scans) {
    const book = bookByRfid.get(scan.rfid);
    if (!book) {
      result.unknown.push({ scan });
      continue;
    }
    if (book.floor === scan.floor && book.room === scan.room && book.shelf === scan.shelf) {
      result.matched.push({ book });
    } else {
      // 判定错架层级：同室错架位 / 同层跨书库 / 跨楼层
      let misLevel = '架位';
      if (book.floor !== scan.floor) misLevel = '楼层';
      else if (book.room !== scan.room) misLevel = '书库';
      result.misplaced.push({
        book,
        actual: { floor: scan.floor, room: scan.room, shelf: scan.shelf },
        misLevel,
      });
    }
  }

  // 2) 处理未扫到的馆藏
  for (const book of books) {
    if (scannedRfids.has(book.rfid)) continue;
    if (book.status === '在馆') {
      result.missing.push({ book });   // 应在馆却未扫到 → 缺失
    } else {
      result.checkedOut.push({ book }); // 借出/修补 → 可解释
    }
  }
  return result;
}

/* ---------- 分组统计工具（用于分层视图，避免输出长表格） ---------- */

/** 通用分组：按 keyFn 分桶，并递归统计 */
function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/**
 * 构建三级分层视图：楼层 → 书库 → 分类号
 * 每个节点都带统计与明细，供前端折叠展开
 */
function buildHierarchy(result) {
  // 把五类结果统一成带类别标记的条目流
  const tagged = [
    ...result.matched.map(e    => ({ ...e, cat: 'matched' })),
    ...result.misplaced.map(e  => ({ ...e, cat: 'misplaced' })),
    ...result.missing.map(e    => ({ ...e, cat: 'missing' })),
    ...result.checkedOut.map(e => ({ ...e, cat: 'checkedOut' })),
    ...result.unknown.map(e    => ({ ...e, cat: 'unknown' })),
  ];

  // 条目所属位置：错架/未登记按“应属位置”归档，便于按馆藏结构查看
  const locOf = e => {
    if (e.cat === 'unknown') {
      return { floor: e.scan.floor, room: e.scan.room, cls: '未登记' };
    }
    return { floor: e.book.floor, room: e.book.room, cls: e.book.classCode };
  };

  const floors = [];
  for (const [floor, fItems] of groupBy(tagged, e => locOf(e).floor)) {
    const rooms = [];
    for (const [room, rItems] of groupBy(fItems, e => locOf(e).room)) {
      const classes = [];
      for (const [cls, cItems] of groupBy(rItems, e => locOf(e).cls)) {
        classes.push({
          classCode: cls,
          stats: summarizeClass(cItems),
          items: cItems,
        });
      }
      classes.sort((a, b) => a.classCode.localeCompare(b.classCode));
      rooms.push({ room, classes, stats: summarizeNode(classes.map(c => c.stats)) });
    }
    floors.push({ floor, rooms, stats: summarizeNode(rooms.map(r => r.stats)) });
  }
  floors.sort((a, b) => a.floor.localeCompare(b.floor));
  return floors;
}

function summarizeClass(items) {
  const s = { matched: 0, misplaced: 0, missing: 0, checkedOut: 0, unknown: 0, total: 0 };
  for (const e of items) s[e.cat]++;
  s.total = items.length;
  return s;
}
function summarizeNode(childStats) {
  const s = { matched: 0, misplaced: 0, missing: 0, checkedOut: 0, unknown: 0, total: 0 };
  for (const c of childStats) for (const k of Object.keys(s)) s[k] += c[k];
  return s;
}

/* ---------- 错架整理清单 ---------- */

/**
 * 生成错架整理清单
 * @param result 比对结果
 * @param groupMode 'target' 按应归架位分组（上架用） | 'current' 按当前位置分组（取书用）
 */
function buildMisplacedList(result, groupMode = 'target') {
  const keyFn = groupMode === 'target'
    ? e => `${e.book.floor} · ${e.book.room} · ${e.book.shelf}`
    : e => `${e.actual.floor} · ${e.actual.room} · ${e.actual.shelf}`;
  const groups = [];
  for (const [loc, items] of groupBy(result.misplaced, keyFn)) {
    groups.push({ location: loc, items });
  }
  groups.sort((a, b) => a.location.localeCompare(b.location));
  return groups;
}

/* ---------- CSV 导出 ---------- */

function toCsv(rows, headers) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return '﻿' + lines.join('\r\n'); // BOM 便于 Excel 识别中文
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
