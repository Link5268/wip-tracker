import { clean, cellText, isZeroQty, processSignature, STEP_ORDER } from "./logic.js";

const ORDER_MAP = new Map(STEP_ORDER.map((name, index) => [name, index + 1]));

function sheetRows(XLSX, sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true });
}

export function shanghaiDate(date) {
  const value = date instanceof Date ? date : (typeof date === "string" || typeof date === "number" ? new Date(date) : null);
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function filenameDate(name) {
  const match = String(name || "").match(/(20\d{2})[-_.年]?(0[1-9]|1[0-2])[-_.月]?([0-3]\d)/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function excelSerial(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = Date.UTC(1899, 11, 30) + value * 86400000;
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, stamp: `${y}-${m}-${d} ${hh}:${mm}` };
}

export function asDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return shanghaiDate(value);
  if (typeof value === "number") {
    const parsed = excelSerial(value);
    return parsed ? parsed.date : "";
  }
  const text = clean(value);
  const match = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return "";
}

function asStamp(value) {
  if (typeof value === "number") {
    const parsed = excelSerial(value);
    return parsed ? parsed.stamp : "";
  }
  return clean(value);
}

function findHeader(rows, required) {
  const limit = Math.min(rows.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const cells = (rows[index] || []).map(clean);
    if (required.every((name) => cells.includes(name))) return index;
  }
  return -1;
}

function supplierOf(name) {
  const text = clean(name);
  if (text.includes("奔强")) return "奔强";
  if (text.includes("捷德")) return "捷德";
  return "";
}

function benqiangSource(rows, sheetName) {
  const head = [sheetName, rows[0] && rows[0][0], rows[1] && rows[1][0]].map((item) => clean(item).toUpperCase()).join(" ");
  if (head.includes("Y100")) return "Y100";
  if (head.includes("Y099")) return "y099";
  return "y099";
}

function parseBenqiang(rows, sheetName) {
  const headerIndex = findHeader(rows, ["生产型号", "客户料号", "工艺名称"]);
  if (headerIndex < 0) return null;
  const header = (rows[headerIndex] || []).map(clean);
  const col = {
    sc: header.indexOf("生产型号"),
    pn: header.indexOf("客户料号"),
    step: header.indexOf("工艺名称"),
    cm: header.indexOf("客户型号"),
    po: header.indexOf("客户PO"),
    time: header.indexOf("下单时间"),
  };
  const source = benqiangSource(rows, sheetName);
  const models = new Map();
  let rowCount = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const sc = clean(row[col.sc]);
    if (!sc || sc === "生产型号" || sc.includes("WIP记录")) continue;
    const pn = clean(row[col.pn]);
    const step = clean(row[col.step]) || "(无工艺)";
    const key = `${source}|${sc.toUpperCase()}|${pn.toUpperCase()}`;
    let model = models.get(key);
    if (!model) {
      model = {
        key,
        source,
        sc,
        pn,
        pnU: pn.toUpperCase(),
        scU: sc.toUpperCase(),
        cm: clean(row[col.cm]),
        po: clean(row[col.po]),
        orderedAt: asStamp(row[col.time]),
        steps: [],
        rows: 0,
      };
      models.set(key, model);
    }
    model.rows += 1;
    if (!model.steps.includes(step)) model.steps.push(step);
    rowCount += 1;
  }
  if (!rowCount) return null;
  return {
    supplier: "奔强",
    kind: "wip",
    subtype: source,
    rowCount,
    models: [...models.values()],
  };
}

function parseJiede(rows) {
  const headerIndex = findHeader(rows, ["投产单号", "客户型号", "开料"]);
  if (headerIndex < 0) return null;
  const header = (rows[headerIndex] || []).map(clean);
  const start = header.indexOf("开料");
  const modelCol = header.indexOf("客户型号");
  const qtyCol = header.indexOf("销售合同数量");
  const dueCol = header.indexOf("最新交期");
  const shipCol = header.indexOf("交货日期");
  const names = [];
  for (let offset = 0; offset < 62; offset += 1) names.push(header[start + offset] || "");
  const batches = [];
  const tickets = [];
  let rowCount = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const model = clean(row[modelCol]);
    if (!model || model === "客户型号") continue;
    const po = clean(row[2]) || clean(row[header.indexOf("投产单号")]);
    const raw = [];
    for (let offset = 0; offset < 62; offset += 1) raw.push(row[start + offset] ?? "");
    const sigValues = [];
    const hits = [];
    names.forEach((name, offset) => {
      if (name === "客户简称" || name === "单只面积") return;
      sigValues.push(raw[offset]);
      if (!name || isZeroQty(raw[offset])) return;
      hits.push({ name, qty: clean(cellText(raw[offset])), order: ORDER_MAP.get(name) || 0 });
    });
    const known = hits.filter((hit) => hit.order > 0);
    // Furthest is the highest 工序顺序, which is not the rightmost column.
    let farHit = null;
    for (const hit of known) if (!farHit || hit.order >= farHit.order) farHit = hit;
    const near = known.length ? known.reduce((min, hit) => Math.min(min, hit.order), known[0].order) : 0;
    const modelKey = modelKeyOf(model);
    const batch = {
      po,
      model,
      modelKey,
      modelKeyU: modelKey.toUpperCase(),
      qty: clean(cellText(row[qtyCol])),
      display: columnDisplay(hits),
      steps: dedupe(hits.map((hit) => hit.name)),
    };
    batches.push(batch);
    rowCount += 1;
    if (!po || po === "投产单号" || ["合计", "小计", "-", "补料", "双面", "多层"].includes(po)) continue;
    tickets.push({
      po,
      model,
      modelKey,
      qty: batch.qty,
      due: asDate(row[dueCol]) || asDate(row[shipCol]),
      far: farHit ? farHit.order : 0,
      near,
      nproc: known.length,
      display: farHit ? `${farHit.name} ${farHit.qty}` : "",
      sig: processSignature(sigValues),
      steps: dedupe(known.map((hit) => hit.name)),
    });
  }
  if (!rowCount) return null;
  return {
    supplier: "捷德",
    kind: "wip",
    subtype: "310",
    rowCount: batches.length,
    ticketCount: tickets.length,
    batches,
    tickets,
    models: [],
  };
}

function columnDisplay(hits) {
  if (!hits.length) return "";
  const last = hits[hits.length - 1];
  if (hits.length === 1) return `${last.name} ${last.qty}`;
  const prev = hits[hits.length - 2];
  return `${prev.name} ${prev.qty} + ${last.name} ${last.qty}`;
}

function dedupe(list) {
  const out = [];
  for (const item of list) if (item && !out.includes(item)) out.push(item);
  return out;
}

function modelKeyOf(value) {
  let text = String(value ?? "").replace(/\u00a0/g, " ").replace(/\(/g, "（");
  text = text.replace(/[\t\r\n]/g, " ").replace(/ +/g, " ").trim();
  const cut = text.indexOf("（");
  if (cut >= 0) text = text.slice(0, cut).replace(/ +/g, " ").trim();
  return text;
}

function parseOrders(rows) {
  const headerIndex = findHeader(rows, ["生产编号", "外发交期", "供应商"]);
  if (headerIndex < 0) return [];
  const header = (rows[headerIndex] || []).map(clean);
  const col = (name) => header.indexOf(name);
  const groups = new Map();
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const prodNo = clean(row[col("生产编号")]);
    if (!prodNo || prodNo === "生产编号") continue;
    const supplier = supplierOf(row[col("供应商")]) || "未识别";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push({
      urgent: clean(row[col("加急")]),
      prodNo,
      customer: clean(row[col("客户")]),
      custModel: clean(row[col("客户型号")]),
      status: clean(row[col("状态")]),
      due: asDate(row[col("外发交期")]),
      outDate: asDate(row[col("外发日期")]),
      orderDate: asDate(row[col("下单日期")]),
      outQty: clean(cellText(row[col("外发数量")])),
      orderQty: clean(cellText(row[col("订单数量")])),
      factoryCode: clean(row[col("供应商厂编")]),
      supplierName: clean(row[col("供应商")]),
      salesman: clean(row[col("业务经理")]),
      po: clean(row[col("客户PO")]),
    });
  }
  const records = [];
  for (const [supplier, orders] of groups) {
    if (supplier !== "奔强" && supplier !== "捷德") continue;
    records.push({
      supplier,
      kind: "order",
      subtype: "",
      rowCount: orders.length,
      orders,
      models: [],
    });
  }
  return records;
}

export function parseWorkbook(buffer, filename) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error("SheetJS 未加载");
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false, raw: true });
  const created = shanghaiDate(workbook.Props && workbook.Props.CreatedDate);
  const named = filenameDate(filename);
  const detectedDate = created || named || "";
  const dateSource = created ? "created" : (named ? "filename" : "fallback");
  const records = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(XLSX, workbook.Sheets[sheetName]);
    const orders = parseOrders(rows);
    if (orders.length) {
      records.push(...orders.map((record) => decorate(record, filename, sheetName, detectedDate, dateSource)));
      continue;
    }
    const benqiang = parseBenqiang(rows, sheetName);
    if (benqiang) {
      records.push(decorate(benqiang, filename, sheetName, detectedDate, dateSource));
      continue;
    }
    const jiede = parseJiede(rows);
    if (jiede) records.push(decorate(jiede, filename, sheetName, detectedDate, dateSource));
  }
  return { records, detectedDate, dateSource };
}

function decorate(record, filename, sheetName, detectedDate, dateSource) {
  return {
    ...record,
    filename,
    sheetName,
    date: detectedDate,
    detectedDate,
    dateSource,
  };
}
