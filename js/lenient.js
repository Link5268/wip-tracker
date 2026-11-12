// Lenient workbook matching. The on-page report keeps the stricter rules in logic.js.

const BLOCK = new Set([
  "加急", "已外发", "入库", "出库", "新单", "返单", "电路板", "器件", "PCS",
  "P19", "P22", "奔强", "捷德", "无", "无工艺", "客户型号", "生产型号", "生产编号",
  "供应商", "厂编",
]);

export function normKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u00a0\u3000]+/g, "")
    .toUpperCase();
}

export function modelCore(value) {
  let text = String(value ?? "").normalize("NFKC").replace(/\(/g, "（");
  const cut = text.indexOf("（");
  if (cut >= 0) text = text.slice(0, cut);
  return normKey(text);
}

export function usableKey(value) {
  const key = normKey(value);
  if (!key || key.length < 5 || BLOCK.has(key)) return "";
  if (/^\d{1,4}$/.test(key)) return "";
  return key;
}

function modelKey(value) {
  return usableKey(modelCore(value));
}

export function normQty(value) {
  const key = normKey(value);
  if (!key) return "";
  if (/^\d+(\.\d+)?$/.test(key)) {
    const number = Number(key);
    if (Math.abs(number - Math.round(number)) < 1e-6) return String(Math.round(number));
  }
  return key;
}

function remember(index, name, key, entity) {
  if (!key) return;
  if (!index[name]) index[name] = new Map();
  const bucket = index[name];
  if (!bucket.has(key)) bucket.set(key, []);
  const list = bucket.get(key);
  if (!list.some((item) => item.id === entity.id)) list.push(entity);
}

export function indexEntities(entities) {
  const index = {};
  for (const entity of entities) {
    const pn = usableKey(entity.pn);
    const sc = usableKey(entity.sc);
    const cm = modelKey(entity.cm);
    const po = usableKey(entity.po);
    const product = usableKey(entity.productNo);
    const qty = normQty(entity.qty);
    if (pn && sc) remember(index, "pn+sc", `${pn}|${sc}`, entity);
    if (product && cm) remember(index, "product+cm", `${product}|${cm}`, entity);
    if (cm && qty) remember(index, "cm+qty", `${cm}|${qty}`, entity);
    remember(index, "pn", pn, entity);
    remember(index, "sc", sc, entity);
    remember(index, "po", po, entity);
    remember(index, "product", product, entity);
    remember(index, "cm", cm, entity);
  }
  return index;
}

const LEVELS = [
  ["生产编号+厂编", "pn+sc", (order) => pair(usableKey(order.prodNo), usableKey(order.factoryCode))],
  ["生产编号+客户型号", "product+cm", (order) => pair(usableKey(order.prodNo), modelKey(order.custModel))],
  ["客户型号+数量", "cm+qty", (order) => pair(modelKey(order.custModel), normQty(order.outQty))],
  ["生产编号=客户料号", "pn", (order) => usableKey(order.prodNo)],
  ["厂编=生产型号", "sc", (order) => usableKey(order.factoryCode)],
  ["生产编号=生产型号", "sc", (order) => usableKey(order.prodNo)],
  ["生产编号=投产单号", "po", (order) => usableKey(order.prodNo)],
  ["厂编=投产单号", "po", (order) => usableKey(order.factoryCode)],
  ["生产编号=产品编号", "product", (order) => usableKey(order.prodNo)],
  ["客户型号", "cm", (order) => modelKey(order.custModel)],
];

function pair(left, right) {
  if (!left || !right) return "";
  return `${left}|${right}`;
}

export function matchOrder(order, index) {
  for (const [label, slot, keyOf] of LEVELS) {
    const key = keyOf(order);
    const hits = key && index[slot] ? index[slot].get(key) || [] : [];
    if (!hits.length) continue;
    return {
      entities: hits,
      basis: hits.length > 1 ? `${label}（一对多）` : label,
      many: hits.length > 1,
      matched: true,
    };
  }
  return { entities: [], basis: "未在WIP", many: false, matched: false };
}
