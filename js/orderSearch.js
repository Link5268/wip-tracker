import { normKey } from "./lenient.js";

export const SEARCH_FIELDS = ["全部", "客户型号", "生产编号", "生产型号", "厂编", "投产单号", "客户料号", "客户PO", "产品编号"];

const FIELD_KEYS = {
  客户型号: ["custModel"],
  生产编号: ["prodNo"],
  生产型号: ["wipSc"],
  厂编: ["factoryCode"],
  投产单号: ["wipPo"],
  客户料号: ["wipPn"],
  客户PO: ["po"],
  产品编号: ["productNo"],
};

export function resultId(row) {
  return row.trackId || `${row.supplier}|${row.prodNo}`;
}

export function parseBatch(text) {
  return String(text || "")
    .split(/[\n\r,，;；\t ]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesToken(row, needle, field) {
  const keys = field && field !== "全部" ? (FIELD_KEYS[field] || []) : Object.values(FIELD_KEYS).flat();
  return keys.some((key) => normKey(row[key]).includes(needle));
}

export function searchOrders(rows, options = {}) {
  const supplier = options.supplier || "全部";
  const kind = options.kind || "全部订单";
  const field = options.field || "全部";
  let list = rows.filter((row) => {
    if (supplier !== "全部" && row.supplier !== supplier) return false;
    if (kind === "加急" && !row.urgentFlag) return false;
    if (kind === "我关注的" && !row.starred) return false;
    return true;
  });
  const tokens = parseBatch(options.query);
  if (!tokens.length) {
    if (kind === "全部订单") return { rows: [], missed: [], idle: true };
    return { rows: list, missed: [], idle: false };
  }
  const matched = [];
  const seen = new Set();
  const missed = [];
  for (const token of tokens) {
    const needle = normKey(token);
    if (!needle) continue;
    const hits = list.filter((row) => matchesToken(row, needle, field));
    if (!hits.length) {
      missed.push(token);
      continue;
    }
    for (const hit of hits) {
      const id = resultId(hit);
      if (seen.has(id)) continue;
      seen.add(id);
      matched.push(hit);
    }
  }
  return { rows: matched, missed, idle: false };
}
