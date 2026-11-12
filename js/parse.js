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

function cellAt(row, index) {
  if (index == null || index < 0) return "";
  return row[index];
}

function supplierOf(name) {
  const text = clean(name);
  if (text.includes("奔强")) return "奔强";
  if (text.includes("捷德")) return "捷德";
  return "";
}

function benqiangSource(rows, sheetName, filename, headerIndex, scCol) {
  const head = [sheetName, rows[0] && rows[0][0], rows[1] && rows[1][0]].map((item) => clean(item).toUpperCase()).join(" ");
  if (head.includes("Y100")) return "Y100";
  if (head.includes("Y099")) return "y099";
  for (let index = headerIndex + 1; index < Math.min(rows.length, headerIndex + 12); index += 1) {
    const sc = clean(cellAt(rows[index] || [], scCol)).toUpperCase();
    if (sc.startsWith("Y100")) return "Y100";
    if (sc.startsWith("Y099")) return "y099";
  }
  const file = clean(filename).toUpperCase();
  if (file.includes("Y100")) return "Y100";
  if (file.includes("Y099")) return "y099";
  return "y099";
}

function parseBenqiang(rows, sheetName, filename) {
  // 客户料号、客户PO、备注、下单时间 are optional. Some Y100 exports only have six columns.
  const headerIndex = findHeader(rows, ["生产型号", "工艺名称"]);
  if (headerIndex < 0) return null;
  const header = (rows[headerIndex] || []).map(clean);
  const col = {
    sc: header.indexOf("生产型号"),
    pn: header.indexOf("客户料号"),
    step: header.indexOf("工艺名称"),
    cm: header.indexOf("客户型号"),
    po: header.indexOf("客户PO"),
    time: header.indexOf("下单时间"),
    note: header.indexOf("备注"),
  };
  const source = benqiangSource(rows, sheetName, filename, headerIndex, col.sc);
  const models = new Map();
  const lines = [];
  let rowCount = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const sc = clean(cellAt(row, col.sc));
    if (!sc || sc === "生产型号" || sc.includes("WIP记录")) continue;
    const pn = clean(cellAt(row, col.pn));
    const step = clean(cellAt(row, col.step)) || "(无工艺)";
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
        cm: clean(cellAt(row, col.cm)),
        po: clean(cellAt(row, col.po)),
        orderedAt: asStamp(cellAt(row, col.time)),
        pnFrom: pn ? "sheet" : "missing",
        steps: [],
        rows: 0,
      };
      models.set(key, model);
    }
    model.rows += 1;
    if (!model.steps.includes(step)) model.steps.push(step);
    rowCount += 1;
    lines.push({
      sc,
      cm: clean(cellAt(row, col.cm)),
      pn,
      po: clean(cellAt(row, col.po)),
      orderedAt: asStamp(cellAt(row, col.time)),
      step,
      note: clean(cellAt(row, col.note)),
    });
  }
  if (!rowCount) return null;
  return {
    supplier: "奔强",
    kind: "wip",
    subtype: source,
    rowCount,
    title: clean((rows[0] && rows[0][0]) || sheetName),
    headers: header.filter((name) => name),
    lines,
    models: [...models.values()],
  };
}

function processSpan(header) {
  const indexes = [];
  header.forEach((name, index) => {
    if (ORDER_MAP.has(name)) indexes.push(index);
  });
  if (!indexes.length) return null;
  return { start: Math.min(...indexes), end: Math.max(...indexes) };
}

function poColumn(header, rows, headerIndex) {
  const labeled = header.indexOf("投产单号");
  const sample = [];
  for (let index = headerIndex + 1; index < Math.min(rows.length, headerIndex + 40); index += 1) sample.push(rows[index] || []);
  const scoreOf = (column) => sample.reduce((score, row) => {
    const text = clean(row[column]);
    if (/^JK/i.test(text)) return score + 5;
    return score;
  }, 0);
  let best = labeled;
  let bestScore = labeled >= 0 ? scoreOf(labeled) : -1;
  const width = Math.max(header.length, 0, ...sample.map((row) => row.length));
  for (let column = 0; column < Math.min(width, 12); column += 1) {
    const score = scoreOf(column);
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }
  return bestScore > 0 ? best : Math.max(labeled, 0);
}

function parseJiede(rows) {
  // 开料 is one process column, not a required marker. 销售合同数量 and the due dates are optional.
  const headerIndex = findHeader(rows, ["投产单号", "客户型号"]);
  if (headerIndex < 0) return null;
  const header = (rows[headerIndex] || []).map(clean);
  const span = processSpan(header);
  if (!span) return null;
  const modelCol = header.indexOf("客户型号");
  const qtyCol = header.indexOf("销售合同数量");
  const dueCol = header.indexOf("最新交期");
  const shipCol = header.indexOf("交货日期");
  const poCol = poColumn(header, rows, headerIndex);
  const names = [];
  for (let index = span.start; index <= span.end; index += 1) names.push(header[index] || "");
  const batches = [];
  const tickets = [];
  let rowCount = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const model = clean(cellAt(row, modelCol));
    if (!model || model === "客户型号") continue;
    const po = clean(cellAt(row, poCol));
    const raw = [];
    for (let offset = 0; offset < names.length; offset += 1) raw.push(row[span.start + offset] ?? "");
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
      qty: clean(cellText(cellAt(row, qtyCol))),
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
      due: asDate(cellAt(row, dueCol)) || asDate(cellAt(row, shipCol)),
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
    sheetMatrix: rows.slice(0, 800).map((row) => (row || []).slice(0, 80).map((cell) => (cell == null ? "" : cell))),
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
  // 外发交期、厂编、客户型号 and the quantity columns are optional. Supplier still decides 奔强 vs 捷德.
  const headerIndex = findHeader(rows, ["生产编号", "供应商"]);
  if (headerIndex < 0) return [];
  const header = (rows[headerIndex] || []).map(clean);
  const col = (name) => header.indexOf(name);
  const groups = new Map();
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const prodNo = clean(cellAt(row, col("生产编号")));
    if (!prodNo || prodNo === "生产编号") continue;
    const supplier = supplierOf(cellAt(row, col("供应商"))) || "未识别";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push({
      urgent: clean(cellAt(row, col("加急"))),
      prodNo,
      customer: clean(cellAt(row, col("客户"))),
      custModel: clean(cellAt(row, col("客户型号"))),
      status: clean(cellAt(row, col("状态"))),
      due: asDate(cellAt(row, col("外发交期"))),
      outDate: asDate(cellAt(row, col("外发日期"))),
      orderDate: asDate(cellAt(row, col("下单日期"))),
      outQty: clean(cellText(cellAt(row, col("外发数量")))),
      orderQty: clean(cellText(cellAt(row, col("订单数量")))),
      factoryCode: clean(cellAt(row, col("供应商厂编"))),
      supplierName: clean(cellAt(row, col("供应商"))),
      salesman: clean(cellAt(row, col("业务经理"))),
      po: clean(cellAt(row, col("客户PO"))),
      shortName: clean(cellAt(row, col("客户简称"))),
      boardType: clean(cellAt(row, col("类型"))),
      orderKind: clean(cellAt(row, col("订单"))),
      engNote: clean(cellAt(row, col("工程备注"))),
      note: clean(cellAt(row, col("备注"))),
      eqStart: clean(cellAt(row, col("EQ开始"))),
      eqEnd: clean(cellAt(row, col("EQ结束"))),
      eqHours: clean(cellAt(row, col("EQ耗时"))),
      stockIn: clean(cellText(cellAt(row, col("已入库")))),
      stockOut: clean(cellText(cellAt(row, col("已出库")))),
      shortage: clean(cellText(cellAt(row, col("欠数")))),
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
    const benqiang = parseBenqiang(rows, sheetName, filename);
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
