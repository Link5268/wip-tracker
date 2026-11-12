// Default operation sequences. Names and numbers only — no order or WIP rows.
// 奔强 comes from the factory sequence board. Entries marked truncated on that
// board are completed below. 捷德 comes from the 工序顺序 sheet (60 names).

export const PROGRESS_TYPES = ["工序推进", "无进度", "工序回退", "工序变化(顺序未知)", "已出WIP", "今日新增"];

// Visible stem kept when the screenshot cut the trailing suffix and no longer
// WIP name shares that prefix. Exact WIP names are used when one does.
export const BENQIANG_COMPLETIONS = [
  ["内层蚀刻1", "内层蚀刻1", "截图被截断；WIP 里没有以它开头的更长工序名"],
  ["阻抗测试2", "阻抗测试2", "截图被截断；WIP 里没有以它开头的更长工序名"],
  ["钻沉头孔1", "钻沉头孔1", "WIP 里有同名工序"],
  ["激光钻孔1", "激光钻孔1", "WIP 里有同名工序"],
  ["激光钻孔2", "激光钻孔2", "WIP 里有同名工序"],
  ["二次线路1", "二次线路1", "截图被截断；WIP 里没有以它开头的更长工序名"],
  ["沉铜板电1", "沉铜板电1", "截图被截断；WIP 只有「沉铜板电」，没有更长的「沉铜板电1」"],
  ["印选化油墨", "印选化油墨", "截图被截断；WIP 里没有以它开头的更长工序名"],
  ["阻焊固化2", "阻焊固化2", "WIP 里有同名工序"],
  ["锣金属化孔", "锣金属化孔", "截图被截断；WIP 里没有以它开头的更长工序名"],
  ["锣金属包边", "锣金属包边", "截图被截断；WIP 里没有以它开头的更长工序名"],
  ["化学清洗1", "化学清洗1", "截图被截断；WIP 里没有以它开头的更长工序名"],
];

// [sequence, board name]. Trailing P/S/U and "|" are stripped when matching.
const BENQIANG_RAW = [
  [1, "计划投料P"], [2, "开料P"], [3, "镀孔打磨P"], [4, "IQCP"], [5, "IQC1P"],
  [6, "IQC3P"], [7, "内层线路P"], [8, "内层电镀P"], [9, "内层蚀刻P"], [10, "内层蚀刻1"],
  [11, "内层AOIP"], [12, "内层AOI2P"], [13, "外碱蚀刻P"], [14, "阻抗测试2"], [15, "配套中心P"],
  [16, "减铜P"], [17, "减铜1P"], [18, "棕化P"], [19, "棕化1P"], [20, "层压P"],
  [21, "层压1P"], [22, "冲孔P"], [23, "外层钻孔P"], [24, "除胶渣P"], [25, "镀孔填实P"],
  [26, "内层钻孔P"], [27, "钻半孔P"], [28, "钻沉头孔P"], [29, "钻盘中孔P"], [30, "二钻P"],
  [31, "控深钻1P"], [32, "钻沉头孔1"], [33, "控深钻2P"], [34, "三钻|P"], [35, "三钻|S"],
  [36, "验孔P"], [37, "验孔1P"], [38, "激光钻孔1"], [39, "激光钻孔2"], [40, "控深锣P"],
  [41, "锣半孔P"], [42, "二次线路P"], [43, "一次线路P"], [44, "二次线路1"], [45, "沉铜板电P"],
  [46, "沉铜板电1"], [47, "外层线路P"], [48, "板面电镀P"], [49, "加厚铜P"], [50, "图形电镀P"],
  [51, "镀孔P"], [52, "镀孔1P"], [53, "电镀塞孔P"], [54, "铜浆塞孔P"], [55, "树脂塞孔P"],
  [56, "阻焊P"], [57, "阻焊2P"], [58, "阻焊3P"], [59, "钻外围孔P"], [60, "外层AOIP"],
  [61, "外层AOI2P"], [62, "AOI1P"], [63, "外酸蚀刻P"], [64, "外层蚀刻P"], [65, "字符P"],
  [66, "印选化油墨"], [67, "中间测试P"], [68, "切板2P"], [69, "字符1P"], [70, "阻焊固化P"],
  [71, "树脂打磨P"], [72, "阻焊固化2"], [73, "一次锣P"], [74, "无铅喷锡P"], [75, "有铅喷锡P"],
  [76, "沉锡S"], [77, "沉金P"], [78, "镀金P"], [79, "镀镍金P"], [80, "内碱蚀刻P"],
  [81, "成型|P"], [82, "成型|S"], [83, "内斜边P"], [84, "斜边P"], [85, "V-CUTP"],
  [86, "锣PPP"], [87, "锣金属化孔"], [88, "锣金属包边"], [89, "激光切割P"], [90, "测试|P"],
  [91, "测试|S"], [92, "终检|S"], [93, "终检|U"], [94, "终检二S"], [95, "沉银|P"],
  [96, "沉银|S"], [97, "等离子P"], [98, "沉镍钯金P"], [99, "退选化P"], [100, "点胶P"],
  [101, "快压P"], [102, "快压1P"], [103, "切割P"], [104, "化学清洗P"], [105, "化学清洗1"],
];

export const JIEDE_NAMES = [
  "开料", "内层线路", "蚀刻去膜", "内层AOI", "内层钻孔", "内层电镀", "压合", "钻孔",
  "锣金属槽", "钻半孔", "控深钻", "等离子", "沉铜", "加镀", "电镀塞孔", "内层线路1",
  "树脂塞孔", "树脂塞孔2", "减铜", "内层线路2", "蚀刻去膜1", "内层AOI1", "沉铜1", "沉铜2",
  "加镀2", "减铜1", "二钻", "外层线路", "外层线路1", "外层线路2", "二次干膜", "电铜锡",
  "外层蚀刻", "蚀刻引线", "锣半孔", "三钻", "钻沉头孔", "钻沉头孔1", "外层AOI", "曝光阻焊",
  "阻焊2", "文字", "文字2", "表面处理", "成品阻抗测试", "飞针测试", "大板V-CUT", "控深锣",
  "控深锣1", "控深锣2", "一次锣板", "锣板", "锣板1", "小板V-CUT", "斜边", "金手指斜边",
  "*电测", "*OSP", "*FQC", "*包装",
];

// Not on the 奔强 board. Defaults until Jay confirms. 外发 and PCBA stay unlisted.
export const BENQIANG_PENDING = [
  { name: "工程", seq: 0, note: "暂定为第 0 道（最先），等 Jay 确认" },
  { name: "仓库", seq: 999, note: "暂定为第 999 道（最后，视为已完工），等 Jay 确认" },
  { name: "外发", seq: null, note: "顺序未知，等 Jay 确认" },
  { name: "PCBA", seq: null, note: "顺序未知，等 Jay 确认" },
];

const cache = new Map();

export function normalizeOp(value) {
  let text = String(value == null ? "" : value).normalize("NFKC");
  text = text.replace(/[\s\u3000]+/g, "");
  text = text.replace(/[|｜][PSU]$/i, "");
  text = text.replace(/[|｜]+$/g, "");
  if (text.length > 1) text = text.replace(/[PSU]$/i, "");
  return text.toUpperCase();
}

export function catalogFromItems(items) {
  const byName = new Map();
  for (const item of items || []) {
    const name = normalizeOp(item.name);
    const seq = Number(item.seq);
    if (!name || !Number.isFinite(seq)) continue;
    const prev = byName.get(name);
    if (prev == null || seq < prev) byName.set(name, seq);
  }
  const kept = [...byName.entries()]
    .map(([name, seq]) => ({ name, seq }))
    .sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name, "zh"));
  const official = kept.map((item) => item.seq).filter((seq) => seq >= 1 && seq < 900);
  const total = official.length ? Math.max(...official) : kept.length;
  return {
    items: kept,
    total,
    lookup(step) {
      const name = normalizeOp(step);
      return byName.has(name) ? byName.get(name) : null;
    },
  };
}

function benqiangDefaultItems() {
  return [
    ...BENQIANG_RAW.map(([seq, name]) => ({ name, seq })),
    ...BENQIANG_PENDING.filter((item) => item.seq != null).map((item) => ({ name: item.name, seq: item.seq })),
  ];
}

export function defaultCatalog(supplier) {
  if (cache.has(supplier)) return cache.get(supplier);
  const items = supplier === "捷德"
    ? JIEDE_NAMES.map((name, index) => ({ name, seq: index + 1 }))
    : benqiangDefaultItems();
  const catalog = catalogFromItems(items);
  cache.set(supplier, catalog);
  return catalog;
}

export function catalogsFrom(overrides) {
  const pick = (supplier) => {
    const items = overrides && overrides[supplier];
    return items && items.length ? catalogFromItems(items) : defaultCatalog(supplier);
  };
  return { 奔强: pick("奔强"), 捷德: pick("捷德") };
}

export function rankSteps(steps, catalog) {
  const list = steps || [];
  if (!list.length) return { max: null, unknown: false, empty: true };
  let max = null;
  let unknown = false;
  for (const step of list) {
    const seq = catalog.lookup(step);
    if (seq == null) unknown = true;
    else if (max == null || seq > max) max = seq;
  }
  return { max, unknown, empty: false };
}

export function sequenceLabel(steps, catalog) {
  if (!steps) return "";
  if (!steps.length) return "无在制";
  const rank = rankSteps(steps, catalog);
  if (rank.unknown || rank.max == null) return "顺序未知";
  return `第${rank.max}/${catalog.total}道`;
}

export function itemsFromSheetRows(rows) {
  const source = rows || [];
  if (!source.length) return [];
  let nameCol = 0;
  let seqCol = 1;
  let start = 0;
  const head = (source[0] || []).map((cell) => String(cell == null ? "" : cell).trim());
  const nameAt = head.findIndex((cell) => cell === "工序名称" || cell === "工序");
  const seqAt = head.findIndex((cell) => cell === "顺序号" || cell === "顺序" || cell === "序号");
  if (nameAt >= 0 && seqAt >= 0) {
    nameCol = nameAt;
    seqCol = seqAt;
    start = 1;
  }
  const items = [];
  for (const row of source.slice(start)) {
    const name = String(row[nameCol] == null ? "" : row[nameCol]).trim();
    const seq = Number(String(row[seqCol] == null ? "" : row[seqCol]).trim());
    if (!name || !Number.isFinite(seq)) continue;
    items.push({ name, seq });
  }
  return catalogFromItems(items).items;
}

export function compareBySequence(prevSteps, currSteps, prevExists, currExists, catalog) {
  if (!prevExists && !currExists) return "未在WIP";
  if (!prevExists && currExists) return "今日新增";
  if (prevExists && !currExists) return "已出WIP";
  const prev = rankSteps(prevSteps, catalog);
  const curr = rankSteps(currSteps, catalog);
  if (prev.unknown || curr.unknown) return "工序变化(顺序未知)";
  if (prev.max == null && curr.max == null) return "无进度";
  if (prev.max == null || curr.max == null) return "工序变化(顺序未知)";
  if (curr.max > prev.max) return "工序推进";
  if (curr.max < prev.max) return "工序回退";
  return "无进度";
}
