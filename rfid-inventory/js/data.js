/* ============================================================
 * data.js — 馆藏数据模型 + 示例数据 + 盘点扫描模拟
 * ============================================================ */

/** 馆藏地点结构：楼层 → 书库 → 架位 */
const LOCATIONS = [
  { floor: '1F', rooms: [
    { room: '社科借阅区', classes: ['A', 'B', 'C', 'D'], shelves: 8 },
    { room: '文学借阅区', classes: ['I'],                  shelves: 10 },
  ]},
  { floor: '2F', rooms: [
    { room: '科技借阅区', classes: ['TP', 'TU', 'R', 'Q'], shelves: 8 },
    { room: '少儿借阅区', classes: ['G', 'H', 'J'],        shelves: 6 },
  ]},
  { floor: '3F', rooms: [
    { room: '历史地理区', classes: ['K'],                  shelves: 6 },
    { room: '密集书库',   classes: ['F', 'N', 'Z'],        shelves: 6 },
  ]},
];

/** 各分类号下的示例书名池（中图法大类） */
const TITLE_POOL = {
  A: ['马克思主义基本原理', '列宁选集导读', '科学社会主义概论'],
  B: ['中国哲学简史', '西方哲学史', '逻辑学导论', '伦理学原理'],
  C: ['社会学概论', '社会调查研究方法', '统计学基础'],
  D: ['政治学原理', '法学概论', '宪法学讲义'],
  F: ['经济学原理', '宏观经济学', '国际贸易实务', '财务管理学'],
  G: ['教育学原理', '儿童心理学', '绘本阅读指导', '家庭教育读本'],
  H: ['现代汉语', '英语语法大全', '少儿英语启蒙', '汉字的故事'],
  I: ['红楼梦', '活着', '百年孤独', '平凡的世界', '围城', '人间词话'],
  J: ['少儿美术启蒙', '音乐欣赏入门', '儿童简笔画教程'],
  K: ['中国通史', '史记选读', '世界文明史', '地理大发现'],
  N: ['自然科学概论', '十万个为什么'],
  Q: ['普通生物学', '基因传', '昆虫记'],
  R: ['家庭医学手册', '营养学基础', '急救常识'],
  TP: ['Python 程序设计', '数据结构与算法', '计算机网络', '人工智能导论', '数据库系统概论'],
  TU: ['建筑初步', '中国建筑史', '室内设计原理'],
  Z: ['中国大百科全书(卷一)', '年鉴汇编', '图书馆学概论'],
};

/** 可复现的伪随机数生成器（保证每次刷新示例数据一致） */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 生成示例馆藏数据
 * @returns {Array<Book>} Book: {rfid, barcode, title, author, callNumber,
 *                               floor, room, shelf, status}
 */
function generateCollection() {
  const rng = makeRng(20260915);
  const books = [];
  let seq = 1;
  const authors = ['王明', '李华', '张建国', '陈晓', '刘洋', '(英) 史密斯', '(美) 约翰逊', '赵丽'];

  for (const fl of LOCATIONS) {
    for (const rm of fl.rooms) {
      for (const cls of rm.classes) {
        const pool = TITLE_POOL[cls] || [`${cls} 类图书`];
        // 每个分类分布在若干架上
        const shelvesForClass = Math.min(rm.shelves, 2 + Math.floor(rng() * 3));
        for (let s = 0; s < shelvesForClass; s++) {
          const shelfNo = `${cls}${String(s + 1).padStart(2, '0')}`;
          const count = 6 + Math.floor(rng() * 5); // 每架 6~10 册
          for (let i = 0; i < count; i++) {
            const title = pool[Math.floor(rng() * pool.length)];
            const r = rng();
            // 状态分布：88% 在馆，10% 借出，2% 修补
            const status = r < 0.88 ? '在馆' : (r < 0.98 ? '借出' : '修补');
            books.push({
              rfid: `E00401${String(seq).padStart(8, '0')}`,
              barcode: `B${String(100000 + seq)}`,
              title,
              author: authors[Math.floor(rng() * authors.length)],
              callNumber: `${cls}${10 + Math.floor(rng() * 989)}.${1 + Math.floor(rng() * 9)}/${seq}`,
              classCode: cls,
              floor: fl.floor,
              room: rm.room,
              shelf: shelfNo,
              status,
            });
            seq++;
          }
        }
      }
    }
  }
  return books;
}

/**
 * 模拟一次手持设备盘点扫描
 * 规则：
 *  - 在馆图书：约 90% 正常扫到；约 6% 被错放到别的架位（同室/跨室/跨层）；约 4% 未扫到（缺失）
 *  - 借出/修补：不出现在扫描结果中
 *  - 额外加入 2 条系统未登记的 RFID（外来图书）
 * @param {Array<Book>} books 馆藏
 * @param {(book) => boolean} scopeFilter 盘点范围过滤
 * @returns {Array<Scan>} Scan: {rfid, floor, room, shelf, time}
 */
function simulateScan(books, scopeFilter) {
  const rng = makeRng(Date.now() % 2147483647);
  const scans = [];
  const inScope = books.filter(scopeFilter);
  const now = Date.now();

  inScope.forEach((book, idx) => {
    if (book.status !== '在馆') return; // 借出/修补不在架上
    const r = rng();
    const time = new Date(now + idx * 1500).toISOString();
    if (r < 0.90) {
      // 正常在架
      scans.push({ rfid: book.rfid, floor: book.floor, room: book.room, shelf: book.shelf, time });
    } else if (r < 0.96) {
      // 错架：随机放到另一个位置
      const target = inScope[Math.floor(rng() * inScope.length)];
      scans.push({ rfid: book.rfid, floor: target.floor, room: target.room, shelf: target.shelf, time });
    }
    // 其余 ~4%：未扫到 → 缺失
  });

  // 未登记标签（外来图书 / 标签未关联），落在本次盘点范围内
  for (let i = 0; i < 2; i++) {
    const anyBook = inScope[Math.floor(rng() * inScope.length)];
    scans.push({
      rfid: `E00409UNKNOWN${i}`,
      floor: anyBook.floor, room: anyBook.room, shelf: anyBook.shelf,
      time: new Date(now + inScope.length * 1500 + i * 2000).toISOString(),
    });
  }
  return scans;
}
