// Matching and day-over-day rules. Progress uses the operation sequence:
// a higher number moved forward, the same number did not move, a lower number
// moved backward. A name missing from that supplier's list is unordered.

import { JIEDE_NAMES, catalogsFrom, compareBySequence, sequenceLabel } from "./processOrder.js";

export const STEP_ORDER = JIEDE_NAMES;

const ORDER_MAP = new Map(STEP_ORDER.map((name, i) => [name, i + 1]));

export const BQ_TYPES = ["有变化", "无进度", "已出WIP", "今日新增"];
export const MODEL_TYPES = ["有变化", "工序推进", "无进度", "工序回退", "工序变化(顺序未知)", "已出WIP", "今日新增"];
export const ORDER_TYPES = ["有变化", "工序推进", "无进度", "工序回退", "工序变化(顺序未知)", "已出WIP", "今日新增", "未在WIP"];

export function clean(value) {
  if (value == null) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/[\t\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

export function sameStepSet(a, b) {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) {
    const sb = new Set(right);
    const sa = new Set(left);
    if (sa.size !== sb.size) return false;
    for (const step of sa) if (!sb.has(step)) return false;
    return true;
  }
  const sb = new Set(right);
  if (sb.size !== new Set(left).size) return false;
  for (const step of left) if (!sb.has(step)) return false;
  return true;
}

export function joinSteps(steps) {
  if (!steps || !steps.length) return "（无）";
  return steps.join(" + ");
}

export function classifyPresence(prevSteps, currSteps, prevExists, currExists) {
  if (!prevExists && !currExists) return "未在WIP";
  if (!prevExists && currExists) return "今日新增";
  if (prevExists && !currExists) return "已出WIP";
  return sameStepSet(prevSteps, currSteps) ? "无进度" : "工序推进";
}

// 奔强不使用固定工序顺序。工序名集合变了是有变化，相同是无进度。
export function compareByName(prevSteps, currSteps, prevExists, currExists) {
  if (!prevExists && !currExists) return "未在WIP";
  if (!prevExists && currExists) return "今日新增";
  if (prevExists && !currExists) return "已出WIP";
  return sameStepSet(prevSteps, currSteps) ? "无进度" : "有变化";
}

export function nameWindowVerdict(dates, stepsByDate) {
  if (!dates.length) return "未在WIP";
  const current = dates[dates.length - 1];
  const previous = dates.length > 1 ? dates[dates.length - 2] : null;
  const onCurrent = Object.prototype.hasOwnProperty.call(stepsByDate, current);
  const onPrevious = !!(previous && Object.prototype.hasOwnProperty.call(stepsByDate, previous));
  if (!onCurrent && !onPrevious) {
    return dates.slice(0, -1).some((day) => Object.prototype.hasOwnProperty.call(stepsByDate, day)) ? "已出WIP" : "未在WIP";
  }
  return compareByName(onPrevious ? stepsByDate[previous] : null, onCurrent ? stepsByDate[current] : null, onPrevious, onCurrent);
}

export function isUrgent(value) {
  const text = clean(value);
  return text === "加急" || text.startsWith("急");
}

export function dateDiff(due, asOf) {
  if (!due || !asOf) return null;
  const left = due.slice(0, 10).split("-").map(Number);
  const right = asOf.slice(0, 10).split("-").map(Number);
  if (left.length < 3 || right.length < 3 || left.some(Number.isNaN) || right.some(Number.isNaN)) return null;
  const a = Date.UTC(left[0], left[1] - 1, left[2]);
  const b = Date.UTC(right[0], right[1] - 1, right[2]);
  return Math.round((a - b) / 86400000);
}

export function emptyTypeCounts(types = MODEL_TYPES) {
  const counts = { total: 0 };
  for (const type of types) counts[type] = 0;
  return counts;
}

function bump(counts, type) {
  counts[type] = (counts[type] || 0) + 1;
  counts.total += 1;
}

function byImported(files) {
  return [...files].sort((a, b) => String(a.importedAt).localeCompare(String(b.importedAt)));
}

function pickLatest(files) {
  const best = new Map();
  for (const file of byImported(files)) {
    const key = `${file.supplier}|${file.kind}|${file.subtype || ""}`;
    best.set(key, file);
  }
  return [...best.values()];
}

export function filesOn(records, supplier, kind) {
  const grouped = new Map();
  for (const record of records) {
    if (record.supplier !== supplier || record.kind !== kind || !record.date) continue;
    if (!grouped.has(record.date)) grouped.set(record.date, []);
    grouped.get(record.date).push(record);
  }
  const dates = [...grouped.keys()].sort();
  const map = new Map();
  for (const date of dates) map.set(date, pickLatest(grouped.get(date)));
  return { dates, map };
}

function mergeBenqiang(files) {
  const models = new Map();
  const ordered = [...files].sort((a, b) => (a.subtype === "Y100") - (b.subtype === "Y100"));
  let rows = 0;
  const rowBySource = { y099: 0, Y100: 0 };
  for (const file of ordered) {
    rows += file.rowCount || 0;
    if (file.subtype) rowBySource[file.subtype] = file.rowCount || 0;
    for (const model of file.models || []) {
      if (!models.has(model.key)) models.set(model.key, model);
    }
  }
  return { models, rows, rowBySource };
}

function indexBenqiang(models) {
  const both = new Map();
  const byPn = new Map();
  const bySc = new Map();
  for (const model of models.values()) {
    if (model.pnU && model.scU && !both.has(`${model.pnU}|${model.scU}`)) both.set(`${model.pnU}|${model.scU}`, model.key);
    if (model.pnU && !byPn.has(model.pnU)) byPn.set(model.pnU, model.key);
    if (model.scU && !bySc.has(model.scU)) bySc.set(model.scU, model.key);
  }
  return { both, byPn, bySc, models };
}

function resolveBenqiangKey(order, days) {
  const pn = clean(order.prodNo).toUpperCase();
  const sc = clean(order.factoryCode).toUpperCase();
  const levels = [
    (index) => (pn && sc ? index.both.get(`${pn}|${sc}`) : undefined),
    (index) => (pn ? index.byPn.get(pn) : undefined),
    (index) => (sc ? index.bySc.get(sc) : undefined),
  ];
  const how = ["生产编号+厂编", "生产编号", "厂编"];
  for (let level = 0; level < levels.length; level += 1) {
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const key = levels[level](days[i].index);
      if (key) return { key, how: how[level] };
    }
  }
  return { key: "", how: "未匹配" };
}

function attachOrderFlags(models, orders) {
  const byPn = new Map();
  const bySc = new Map();
  for (const order of orders) {
    const pn = clean(order.prodNo).toUpperCase();
    const sc = clean(order.factoryCode).toUpperCase();
    if (pn && !byPn.has(pn)) byPn.set(pn, order);
    if (sc && !bySc.has(sc)) bySc.set(sc, order);
  }
  for (const model of models.values()) {
    const byProd = model.pnU && byPn.get(model.pnU);
    const byFactory = model.scU && bySc.get(model.scU);
    const order = byProd || byFactory || null;
    model.urgent = order ? clean(order.urgent) : "";
    model.due = order ? order.due || "" : "";
    model.orderStatus = order ? order.status || "" : "";
    model.prodNo = order ? order.prodNo || "" : "";
    if (!order) model.how = "未找到订单";
    else if (model.pnFrom === "history" && byProd) model.how = "回填客户料号";
    else if (byProd) model.how = "生产编号";
    else model.how = "厂编";
  }
}

export function isZeroQty(value) {
  if (value == null || value === "") return true;
  if (typeof value === "number") return value === 0;
  const text = String(value).trim();
  if (!text) return true;
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return false;
  return Number(text) === 0;
}

export function cellText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return String(value);
  }
  return String(value);
}

function replaceAll(text, from, to) {
  return text.split(from).join(to);
}

export function processSignature(values) {
  let sig = `|${values.map(cellText).join("|")}|`;
  sig = replaceAll(sig, " ", "");
  sig = replaceAll(sig, "|0|", "||");
  sig = replaceAll(sig, "|0|", "||");
  return sig;
}

export function segment(prev, curr) {
  if (!prev && !curr) return "";
  if (!prev) return "新增";
  if (!curr) return "消失";
  const prevFar = prev.far || 0;
  const currFar = curr.far || 0;
  if (prevFar === 0 && currFar === 0) return "无在制";
  if (prevFar === 0) return "推进";
  if (currFar === 0) return "消失";
  if (currFar < prevFar) return currFar < (prev.near || 0) ? "倒退" : "部分";
  if (currFar > prevFar) return "推进";
  if (prev.sig === curr.sig) return "未动";
  return "部分";
}

export function triStatus(day1, day2, day3) {
  const has = (day) => !!(day && day.far > 0);
  const first = segment(day1, day2);
  const second = segment(day2, day3);
  let status;
  if (!has(day3)) status = has(day1) || has(day2) ? "已完成或消失" : "无在制";
  else if (!has(day1) && !has(day2)) status = "新增";
  else if (!has(day2)) status = "消失后又出现";
  else if (first === "倒退" || second === "倒退") status = "倒退";
  else if (second === "未动") status = first === "未动" ? "连续3天未动" : "近1天未动";
  else if (second === "推进") status = "正常推进";
  else status = "部分推进";
  const advance12 = day1 && day2 && day1.far > 0 && day2.far > 0 ? day2.far - day1.far : null;
  const advance23 = day2 && day3 && day2.far > 0 && day3.far > 0 ? day3.far - day2.far : null;
  return { status, first, second, advance12, advance23 };
}

export function triRisk(status, dueDays, advance12, advance23) {
  if (status === "已完成或消失") return "消失";
  if (status === "无在制") return "无在制";
  if (status === "倒退") return "高风险";
  if (dueDays != null && dueDays < 0) return "高风险";
  if (status === "新增") return "新增";
  if (status === "连续3天未动" || status === "近1天未动") {
    return dueDays != null && dueDays <= 3 ? "高风险" : "关注";
  }
  const slowed = advance12 != null && advance23 != null && advance12 >= 3 && advance23 <= 1;
  if (status === "消失后又出现" || slowed) return "关注";
  return "正常";
}

export function ticketLabel(ticket) {
  if (!ticket || !ticket.far) return "无在制数";
  return ticket.display + (ticket.nproc > 1 ? `（共${ticket.nproc}个工序有数）` : "");
}

function mergeTickets(files) {
  const tickets = new Map();
  const batches = [];
  for (const file of byImported(files)) {
    for (const ticket of file.tickets || []) {
      const prev = tickets.get(ticket.po);
      if (!prev) {
        tickets.set(ticket.po, { ...ticket, steps: [...(ticket.steps || [])] });
        continue;
      }
      const far = ticket.far || 0;
      if (far > 0 && (prev.far === 0 || far >= prev.far)) prev.display = ticket.display;
      prev.far = Math.max(prev.far || 0, far);
      if ((ticket.near || 0) > 0) prev.near = prev.near ? Math.min(prev.near, ticket.near) : ticket.near;
      prev.nproc = (prev.nproc || 0) + (ticket.nproc || 0);
      prev.sig = `${prev.sig}/${ticket.sig}`;
      prev.due = ticket.due || prev.due || "";
      prev.model = ticket.model || prev.model;
      prev.modelKey = ticket.modelKey || prev.modelKey;
      prev.productNo = ticket.productNo || prev.productNo || "";
      prev.orderDate = ticket.orderDate || prev.orderDate || "";
      prev.shipDate = ticket.shipDate || prev.shipDate || "";
      prev.qty = ticket.qty || prev.qty || "";
      for (const step of ticket.steps || []) if (!prev.steps.includes(step)) prev.steps.push(step);
    }
    batches.push(...(file.batches || []));
  }
  return { tickets, batches };
}

function excelModelKey(value) {
  let text = String(value ?? "").replace(/\u00a0/g, " ").replace(/\(/g, "（");
  text = text.replace(/[\t\r\n]/g, " ");
  text = text.replace(/ +/g, " ").trim();
  const cut = text.indexOf("（");
  if (cut >= 0) text = text.slice(0, cut).replace(/ +/g, " ").trim();
  return text;
}

export function jiedeMatch(order, batches) {
  const modelKey = excelModelKey(order.custModel).toUpperCase();
  const qty = clean(cellText(order.outQty));
  if (!modelKey) return { how: "未匹配", text: "", steps: [], present: false };
  const sameModel = batches.filter((batch) => batch.modelKeyU === modelKey);
  if (!sameModel.length) return { how: "未匹配", text: "未匹配", steps: [], present: false };
  const sameQty = sameModel.filter((batch) => batch.qty === qty && batch.display);
  const pool = sameQty.length ? sameQty : sameModel.filter((batch) => batch.display);
  if (!pool.length) {
    const pos = [];
    const productNos = [];
    let orderDate = "";
    for (const batch of sameModel) {
      const po = clean(batch.po);
      if (po && po !== "投产单号" && !["合计", "小计", "-", "补料", "双面", "多层"].includes(po) && !pos.includes(po)) pos.push(po);
      if (batch.productNo && !productNos.includes(batch.productNo)) productNos.push(batch.productNo);
      if (!orderDate && batch.orderDate) orderDate = batch.orderDate;
    }
    return { how: "无在制", text: "捷德:无在制数", steps: [], present: true, pos, qty: "", productNo: productNos.join(" "), orderDate };
  }
  const text = pool.map((batch) => batch.display).join(" / ");
  const steps = [];
  for (const batch of pool) {
    for (const step of batch.steps) if (!steps.includes(step)) steps.push(step);
  }
  const pos = [];
  const qtys = [];
  const productNos = [];
  let orderDate = "";
  for (const batch of sameModel) {
    const po = clean(batch.po);
    if (po && po !== "投产单号" && !["合计", "小计", "-", "补料", "双面", "多层"].includes(po) && !pos.includes(po)) pos.push(po);
    if (batch.productNo && !productNos.includes(batch.productNo)) productNos.push(batch.productNo);
    if (!orderDate && batch.orderDate) orderDate = batch.orderDate;
  }
  for (const batch of pool) if (batch.qty && !qtys.includes(batch.qty)) qtys.push(batch.qty);
  return {
    how: sameQty.length ? "数量" : "型号",
    text: `捷德:${text}`,
    steps,
    present: true,
    pos,
    qty: qtys.join(" / "),
    productNo: productNos.join(" "),
    orderDate,
  };
}

function buildJiedeTri(days) {
  if (days.length < 3) return null;
  const last = days.slice(-3);
  const maps = last.map((day) => day.tickets);
  const keys = [];
  const seen = new Set();
  for (const map of [...maps].reverse()) {
    for (const key of map.keys()) if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  const statusCounts = {};
  const riskCounts = {};
  const rows = [];
  for (const key of keys) {
    const trio = maps.map((map) => map.get(key) || null);
    const judged = triStatus(trio[0], trio[1], trio[2]);
    const latest = trio[2] || trio[1] || trio[0];
    const dueDays = dateDiff(latest && latest.due, last[2].date);
    const risk = triRisk(judged.status, dueDays, judged.advance12, judged.advance23);
    statusCounts[judged.status] = (statusCounts[judged.status] || 0) + 1;
    riskCounts[risk] = (riskCounts[risk] || 0) + 1;
    rows.push({
      po: key,
      model: latest ? latest.model : "",
      due: latest ? latest.due : "",
      dueDays,
      status: judged.status,
      risk,
      days: trio.map((ticket) => (ticket ? ticketLabel(ticket) : "（无此单）")),
      advance12: judged.advance12,
      advance23: judged.advance23,
    });
  }
  return {
    dates: last.map((day) => day.date),
    total: keys.length,
    statusCounts,
    riskCounts,
    rows,
  };
}

function latestOrderBook(records, supplier) {
  const books = records.filter((record) => record.supplier === supplier && record.kind === "order");
  books.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.importedAt).localeCompare(String(b.importedAt)));
  return books.length ? books[books.length - 1] : null;
}

function benqiangDay(files) {
  const merged = mergeBenqiang(files);
  return {
    models: merged.models,
    index: indexBenqiang(merged.models),
    rows: merged.rows,
    rowBySource: merged.rowBySource,
  };
}

// A later export can omit 客户料号. Reuse the 生产型号 → 客户料号 seen on earlier days
// so the comparison key stays source|型号|料号 instead of looking like a brand-new model.
function alignBenqiangKeys(days) {
  const known = new Map();
  for (const day of days) {
    const next = new Map();
    for (const original of day.models.values()) {
      const model = { ...original, steps: [...(original.steps || [])] };
      const scKey = `${model.source}|${model.scU}`;
      if (!model.pnU && known.has(scKey)) {
        const prior = known.get(scKey);
        model.pn = prior.pn;
        model.pnU = prior.pnU;
        model.pnFrom = "history";
        model.key = `${model.source}|${model.scU}|${model.pnU}`;
      } else if (!model.pnU) {
        model.pnFrom = "missing";
        model.key = `${model.source}|${model.scU}|`;
      } else {
        model.pnFrom = "sheet";
      }
      const existing = next.get(model.key);
      if (!existing) next.set(model.key, model);
      else {
        existing.rows = (existing.rows || 0) + (model.rows || 0);
        for (const step of model.steps) if (!existing.steps.includes(step)) existing.steps.push(step);
      }
      if (model.pnU) known.set(scKey, { pn: model.pn, pnU: model.pnU });
    }
    day.models = next;
    day.index = indexBenqiang(next);
  }
}

function datesForSource(days, source) {
  return days.filter((day) => [...day.models.values()].some((model) => model.source === source)).map((day) => day.date);
}

function sourceOfKey(days, key) {
  if (!key) return "";
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const model = days[index].models.get(key);
    if (model && model.source) return model.source;
  }
  return "";
}

function compareBenqiangSources(days, orders) {
  const parts = [];
  for (const source of ["y099", "Y100"]) {
    const own = days.filter((day) => [...day.models.values()].some((model) => model.source === source));
    if (!own.length) continue;
    const window = own.slice(-3);
    for (const day of window) attachOrderFlags(day.models, orders);
    const dates = window.map((day) => day.date);
    const keys = [];
    const seen = new Set();
    for (const day of window) {
      for (const [key, model] of day.models) {
        if (model.source !== source || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }
    const counts = emptyTypeCounts();
    const rows = [];
    let urgentStall = 0;
    for (const key of keys) {
      const stepsByDate = {};
      let model = null;
      for (const day of window) {
        const found = day.models.get(key);
        if (!found || found.source !== source) continue;
        stepsByDate[day.date] = found.steps || [];
        model = found;
      }
      const type = nameWindowVerdict(dates, stepsByDate);
      bump(counts, type);
      if (type === "无进度" && model.urgent) urgentStall += 1;
      const cells = [{ date: "", text: "" }, { date: "", text: "" }, { date: "", text: "" }];
      dates.forEach((date, index) => {
        cells[3 - dates.length + index] = {
          date,
          text: Object.prototype.hasOwnProperty.call(stepsByDate, date) ? joinSteps(stepsByDate[date]) : "",
        };
      });
      const prevDate = dates.length > 1 ? dates[dates.length - 2] : "";
      const currDate = dates[dates.length - 1] || "";
      rows.push({
        key,
        source,
        sc: model.sc,
        pn: model.pn,
        cm: model.cm,
        po: model.po,
        orderedAt: model.orderedAt || "",
        prevText: prevDate && stepsByDate[prevDate] ? joinSteps(stepsByDate[prevDate]) : "（无）",
        currText: currDate && stepsByDate[currDate] ? joinSteps(stepsByDate[currDate]) : "（无）",
        seqLabel: "",
        days: cells,
        prevRows: prevDate && window.find((day) => day.date === prevDate).models.get(key) ? window.find((day) => day.date === prevDate).models.get(key).rows : 0,
        currRows: currDate && window.find((day) => day.date === currDate).models.get(key) ? window.find((day) => day.date === currDate).models.get(key).rows : 0,
        type,
        urgent: model.urgent || "",
        due: model.due || "",
        orderStatus: model.orderStatus || "",
        how: model.how || "",
        prodNo: model.prodNo || "",
      });
    }
    const prev = window.length > 1 ? window[window.length - 2] : null;
    const curr = window[window.length - 1];
    parts.push({
      source,
      prev: prev ? prev.date : "",
      curr: curr.date,
      dates,
      prevRows: prev ? prev.rowBySource[source] || 0 : 0,
      currRows: curr.rowBySource[source] || 0,
      counts,
      urgentStall,
      rows,
    });
  }
  if (!parts.length) return null;
  const counts = emptyTypeCounts();
  const bySource = { y099: emptyTypeCounts(), Y100: emptyTypeCounts() };
  const rows = [];
  let urgentStall = 0;
  for (const part of parts) {
    rows.push(...part.rows);
    urgentStall += part.urgentStall;
    bySource[part.source] = {
      ...part.counts,
      prev: part.prev,
      curr: part.curr,
      dates: part.dates,
      prevRows: part.prevRows,
      currRows: part.currRows,
    };
    for (const type of MODEL_TYPES) counts[type] += part.counts[type] || 0;
    counts.total += part.counts.total || 0;
  }
  return {
    prev: parts[0].prev,
    curr: parts[parts.length - 1].curr,
    prevRows: { y099: bySource.y099.prevRows || 0, Y100: bySource.Y100.prevRows || 0 },
    currRows: { y099: bySource.y099.currRows || 0, Y100: bySource.Y100.currRows || 0 },
    pairs: parts.map((part) => ({ source: part.source, prev: part.prev, curr: part.curr })),
    counts,
    bySource,
    urgentStall,
    rows,
  };
}

export function buildReport(records, options = {}) {
  const from = options.from || "";
  const to = options.to || "";
  const asOfCap = options.asOf || "";
  const inRange = (date) => (!from || date >= from) && (!to || date <= to) && (!asOfCap || date <= asOfCap);
  const capped = asOfCap ? records.filter((record) => !record.date || record.date <= asOfCap) : records;
  const bq = filesOn(capped, "奔强", "wip");
  const jd = filesOn(capped, "捷德", "wip");
  const bqOrders = latestOrderBook(capped, "奔强");
  const jdOrders = latestOrderBook(capped, "捷德");
  const bqDays = bq.dates.map((date) => ({ date, ...benqiangDay(bq.map.get(date)) }));
  alignBenqiangKeys(bqDays);
  const jdDays = jd.dates.map((date) => ({ date, ...mergeTickets(jd.map.get(date)) }));

  const catalogs = catalogsFrom(options.catalogs);
  let benqiang = null;
  if (bqDays.length >= 1) {
    const orders = (bqOrders && bqOrders.orders) || [];
    benqiang = compareBenqiangSources(bqDays, orders);
  }

  const bqDates = bq.dates.filter(inRange);
  const jdDates = jd.dates.filter(inRange);
  const pair = bqDays.filter((day) => inRange(day.date)).slice(-2);
  const orderCounts = emptyTypeCounts(ORDER_TYPES);
  let orderUrgentStall = 0;
  const orderRows = [];
  const rangeDates = [...new Set([...bqDates, ...jdDates])].sort();
  const windowDates = rangeDates.slice(-5);
  const asOf = rangeDates[rangeDates.length - 1] || "";

  for (const order of (bqOrders && bqOrders.orders) || []) {
    const resolved = resolveBenqiangKey(order, pair.length ? pair : bqDays);
    const dayCells = {};
    for (const date of rangeDates) {
      const day = bqDays.find((item) => item.date === date);
      if (!day) {
        dayCells[date] = { text: "—", present: false, snapshot: false };
        continue;
      }
      const model = resolved.key ? day.models.get(resolved.key) : null;
      dayCells[date] = {
        text: model ? joinSteps(model.steps) : "未在WIP",
        present: !!model,
        snapshot: true,
        steps: model ? model.steps : [],
        source: model ? model.source : "",
        sc: model ? model.sc || "" : "",
        pn: model ? model.pn || "" : "",
        seqLabel: "",
      };
    }
    const supplierDates = bqDates.filter((date) => date <= (asOf || "9999"));
    const latestDate = supplierDates[supplierDates.length - 1] || "";
    const previousDate = supplierDates[supplierDates.length - 2] || "";
    const latest = latestDate ? dayCells[latestDate] : null;
    const previous = previousDate ? dayCells[previousDate] : null;
    const ownSource = sourceOfKey(bqDays, resolved.key);
    const ownDates = (ownSource ? datesForSource(bqDays, ownSource) : bqDates).filter(inRange);
    const ownLatestDate = ownDates[ownDates.length - 1] || "";
    const ownPrevDate = ownDates[ownDates.length - 2] || "";
    const ownLatest = ownLatestDate ? dayCells[ownLatestDate] : null;
    const ownPrevious = ownPrevDate ? dayCells[ownPrevDate] : null;
    const shownDates = ownDates.slice(-3);
    const stepsByDate = {};
    for (const date of shownDates) if (dayCells[date] && dayCells[date].present) stepsByDate[date] = dayCells[date].steps || [];
    const type = nameWindowVerdict(shownDates, stepsByDate);
    bump(orderCounts, type);
    if (type === "无进度" && isUrgent(order.urgent)) orderUrgentStall += 1;
    orderRows.push(orderRow(order, "奔强", type, resolved.how, dayCells, asOf, ownLatest && ownLatest.present ? ownLatest.text : "", shownDates, "", null));
  }

  const jdMatchCounts = { 数量: 0, 型号: 0, 无在制: 0, 未匹配: 0, total: 0 };
  const latestJd = jdDays[jdDays.length - 1] || null;
  for (const order of (jdOrders && jdOrders.orders) || []) {
    const dayCells = {};
    const matches = {};
    for (const date of rangeDates) {
      const day = jdDays.find((item) => item.date === date);
      if (!day) {
        dayCells[date] = { text: "—", present: false, snapshot: false };
        continue;
      }
      const matched = jiedeMatch(order, day.batches);
      matches[date] = matched;
      dayCells[date] = {
        text: matched.present ? (matched.steps.length ? joinSteps(matched.steps) : "无在制") : "未在WIP",
        detail: matched.text,
        present: matched.present,
        snapshot: true,
        steps: matched.steps,
        pos: matched.pos || [],
        qty: matched.qty || "",
        productNo: matched.productNo || "",
        orderDate: matched.orderDate || "",
        seqLabel: matched.present ? sequenceLabel(matched.steps, catalogs["捷德"]) : "",
      };
    }
    if (latestJd) {
      const matched = matches[latestJd.date] || jiedeMatch(order, latestJd.batches);
      jdMatchCounts[matched.how] = (jdMatchCounts[matched.how] || 0) + 1;
      jdMatchCounts.total += 1;
    }
    const supplierDates = jdDates.filter((date) => !asOf || date <= asOf);
    const latestDate = supplierDates[supplierDates.length - 1] || "";
    const previousDate = supplierDates[supplierDates.length - 2] || "";
    const latest = latestDate ? dayCells[latestDate] : null;
    const previous = previousDate ? dayCells[previousDate] : null;
    const type = compareBySequence(
      previous && previous.steps,
      latest && latest.steps,
      !!(previous && previous.present),
      !!(latest && latest.present),
      catalogs["捷德"],
    );
    orderRows.push(orderRow(order, "捷德", type, (matches[latestDate] && matches[latestDate].how) || "未匹配", dayCells, asOf, latest && latest.present ? (latest.detail || latest.text) : "", supplierDates, latest && latest.present ? sequenceLabel(latest.steps, catalogs["捷德"]) : "", catalogs["捷德"]));
  }

  return {
    asOf,
    windowDates,
    bqDates: bq.dates,
    jdDates: jd.dates,
    backfill: backfillSummary(bqDays[bqDays.length - 1]),
    benqiang,
    jiede: buildJiedeTri(jdDays),
    jdMatch: latestJd ? { date: latestJd.date, counts: jdMatchCounts } : null,
    orderCounts,
    orderUrgentStall,
    orderRows,
    wipOnly: collectUnmatchedWip(bqDays.filter((day) => inRange(day.date)), jdDays.filter((day) => inRange(day.date)), (bqOrders && bqOrders.orders) || [], (jdOrders && jdOrders.orders) || [], catalogs, asOf),
    dailyStats: dailyStats(orderRows, catalogs),
    bqOrderTotal: (bqOrders && bqOrders.orders.length) || 0,
    jdOrderTotal: (jdOrders && jdOrders.orders.length) || 0,
  };
}

function backfillSummary(day) {
  const byRule = {};
  let models = 0;
  let rows = 0;
  if (!day) return { models, rows, byRule };
  for (const model of day.models.values()) {
    if (model.pnFrom !== "history") continue;
    models += 1;
    rows += model.rows || 0;
    const rule = model.how || "未找到订单";
    byRule[rule] = (byRule[rule] || 0) + (model.rows || 0);
  }
  return { models, rows, byRule };
}

function stepVerdict(supplier, prevSteps, currSteps, prevExists, currExists, catalog) {
  if (supplier === "奔强") return compareByName(prevSteps, currSteps, prevExists, currExists);
  return compareBySequence(prevSteps, currSteps, prevExists, currExists, catalog);
}

function consecutiveStall(dayCells, dates, supplier, catalog) {
  let count = 0;
  for (let index = dates.length - 1; index >= 1; index -= 1) {
    const current = dayCells[dates[index]];
    const previous = dayCells[dates[index - 1]];
    const type = stepVerdict(
      supplier,
      previous && previous.steps,
      current && current.steps,
      !!(previous && previous.present),
      !!(current && current.present),
      catalog,
    );
    if (type !== "无进度") break;
    count += 1;
  }
  return count;
}

function dailyStats(orderRows, catalogs) {
  const grouped = new Map();
  for (const row of orderRows) {
    const dates = row.supplierDates || [];
    dates.forEach((date, index) => {
      const id = `${row.supplier}|${date}`;
      if (!grouped.has(id)) {
        grouped.set(id, {
          supplier: row.supplier,
          date,
          counts: emptyTypeCounts(ORDER_TYPES),
          urgent: emptyTypeCounts(ORDER_TYPES),
        });
      }
      const bucket = grouped.get(id);
      const current = row.dayCells[date];
      const previous = index > 0 ? row.dayCells[dates[index - 1]] : null;
      const type = stepVerdict(
        row.supplier,
        previous && previous.steps,
        current && current.steps,
        !!(previous && previous.present),
        !!(current && current.present),
        catalogs[row.supplier] || catalogs["捷德"],
      );
      bump(bucket.counts, type);
      if (row.urgentFlag) bump(bucket.urgent, type);
    });
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier, "zh"));
}

function orderRow(order, supplier, type, how, dayCells, asOf, wipText, supplierDates = [], seqLabel = "", catalog) {
  const dueDays = dateDiff(order.due, asOf);
  let wip = null;
  for (let index = supplierDates.length - 1; index >= 0; index -= 1) {
    const cell = dayCells[supplierDates[index]];
    if (cell && cell.present) {
      wip = cell;
      break;
    }
  }
  return {
    supplierDates,
    supplier,
    urgent: clean(order.urgent),
    urgentFlag: isUrgent(order.urgent),
    prodNo: order.prodNo || "",
    factoryCode: order.factoryCode || "",
    custModel: order.custModel || "",
    customer: order.customer || "",
    status: order.status || "",
    due: order.due || "",
    dueDays,
    outQty: order.outQty || "",
    type,
    how,
    wipText: wipText || "",
    stallDays: consecutiveStall(dayCells, supplierDates, supplier, catalog),
    seqLabel,
    po: order.po || "",
    orderQty: order.orderQty || "",
    orderDate: order.orderDate || "",
    wipSc: wip ? wip.sc || "" : "",
    wipPn: wip ? wip.pn || "" : "",
    wipPo: wip && Array.isArray(wip.pos) ? wip.pos.filter(Boolean).join(" ") : "",
    wipQty: wip ? wip.qty || "" : "",
    productNo: wip ? wip.productNo || "" : "",
    dayCells,
  };
}

const BLOCKED_PO = new Set(["合计", "小计", "-", "补料", "双面", "多层", "投产单号"]);

function usablePo(value) {
  const po = clean(value);
  if (!po || BLOCKED_PO.has(po)) return "";
  return po;
}

function orderHitsBenqiang(model, orders) {
  const pn = model.pnU || "";
  const sc = model.scU || "";
  return orders.some((order) => {
    const prodNo = clean(order.prodNo).toUpperCase();
    const factory = clean(order.factoryCode).toUpperCase();
    if (pn && prodNo && pn === prodNo) return true;
    if (sc && factory && sc === factory) return true;
    return false;
  });
}

function orderHitsJiede(modelKeyU, orders) {
  if (!modelKeyU) return false;
  return orders.some((order) => excelModelKey(order.custModel).toUpperCase() === modelKeyU);
}

function presenceVerdict(dates, dayCells, supplier, catalog) {
  const current = dates[dates.length - 1] || "";
  const previous = dates.length > 1 ? dates[dates.length - 2] : "";
  const onCurrent = !!(current && dayCells[current] && dayCells[current].present);
  const onPrevious = !!(previous && dayCells[previous] && dayCells[previous].present);
  if (!onCurrent && !onPrevious) {
    return dates.slice(0, -1).some((date) => dayCells[date] && dayCells[date].present) ? "已出WIP" : "未在WIP";
  }
  return stepVerdict(
    supplier,
    onPrevious ? dayCells[previous].steps : null,
    onCurrent ? dayCells[current].steps : null,
    onPrevious,
    onCurrent,
    catalog,
  );
}

function wipRow(base, dates, dayCells, catalog, asOf) {
  const type = presenceVerdict(dates, dayCells, base.supplier, catalog);
  const current = dates[dates.length - 1] || "";
  const latest = current && dayCells[current] && dayCells[current].present ? dayCells[current] : null;
  return {
    ...base,
    wipOnly: true,
    origin: "仅WIP",
    urgent: "",
    urgentFlag: false,
    status: "",
    type,
    how: "未找到订单",
    seqLabel: base.supplier === "捷德" && latest ? latest.seqLabel || "" : "",
    dueDays: dateDiff(base.due, asOf),
    supplierDates: dates,
    dayCells,
    wipText: latest ? latest.text || "" : "",
  };
}

function collectUnmatchedWip(bqDays, jdDays, bqOrders, jdOrders, catalogs, asOf) {
  const rows = [];
  const bqCatalog = catalogs["奔强"];
  const grouped = new Map();
  for (const day of bqDays) {
    for (const model of day.models.values()) {
      if (orderHitsBenqiang(model, bqOrders)) continue;
      if (!grouped.has(model.key)) {
        grouped.set(model.key, {
          key: model.key,
          source: model.source,
          sc: model.sc || "",
          pn: model.pn || "",
          cm: model.cm || "",
          po: model.po || "",
          orderedAt: model.orderedAt || "",
          byDate: {},
        });
      }
      const item = grouped.get(model.key);
      item.byDate[day.date] = model;
      if (model.cm) item.cm = model.cm;
      if (model.po) item.po = model.po;
      if (model.orderedAt) item.orderedAt = model.orderedAt;
      if (model.pn) item.pn = model.pn;
    }
  }
  for (const item of grouped.values()) {
    const dates = datesForSource(bqDays, item.source);
    const dayCells = {};
    for (const date of dates) {
      const model = item.byDate[date];
      dayCells[date] = {
        text: model ? joinSteps(model.steps) : "未在WIP",
        present: !!model,
        snapshot: true,
        steps: model ? model.steps : [],
        seqLabel: model ? sequenceLabel(model.steps, bqCatalog) : "",
        sc: item.sc,
        pn: item.pn,
      };
    }
    const scKey = item.sc.toUpperCase();
    const pnKey = item.pn.toUpperCase();
    rows.push(wipRow({
      trackId: `奔强|WIP|${item.source}|${scKey}|${pnKey}`,
      supplier: "奔强",
      customer: "奔强",
      source: item.source,
      prodNo: "",
      factoryCode: item.sc,
      wipSc: item.sc,
      wipPn: item.pn,
      custModel: item.cm,
      po: item.po,
      wipPo: "",
      productNo: "",
      orderQty: "",
      wipQty: "",
      orderDate: item.orderedAt,
      due: "",
    }, dates, dayCells, bqCatalog, asOf));
  }

  const jdCatalog = catalogs["捷德"];
  const jdDates = jdDays.map((day) => day.date);
  const tickets = new Map();
  const looseModels = new Map();
  for (const day of jdDays) {
    for (const ticket of day.tickets.values()) {
      const po = usablePo(ticket.po);
      if (!po) continue;
      const modelKeyU = (ticket.modelKey || excelModelKey(ticket.model)).toUpperCase();
      if (orderHitsJiede(modelKeyU, jdOrders)) continue;
      if (!tickets.has(po)) {
        tickets.set(po, {
          po,
          model: ticket.model || "",
          modelKeyU,
          qty: ticket.qty || "",
          productNo: ticket.productNo || "",
          orderDate: ticket.orderDate || "",
          due: ticket.due || "",
          shipDate: ticket.shipDate || "",
          byDate: {},
        });
      }
      const item = tickets.get(po);
      item.byDate[day.date] = ticket;
      if (ticket.model) item.model = ticket.model;
      if (ticket.qty) item.qty = ticket.qty;
      if (ticket.productNo) item.productNo = ticket.productNo;
      if (ticket.orderDate) item.orderDate = ticket.orderDate;
      if (ticket.due) item.due = ticket.due;
      if (ticket.shipDate) item.shipDate = ticket.shipDate;
    }
    for (const batch of day.batches || []) {
      if (usablePo(batch.po)) continue;
      const modelKeyU = batch.modelKeyU || excelModelKey(batch.model).toUpperCase();
      if (!modelKeyU || orderHitsJiede(modelKeyU, jdOrders)) continue;
      if (!looseModels.has(modelKeyU)) {
        looseModels.set(modelKeyU, {
          model: batch.model || "",
          modelKeyU,
          qty: batch.qty || "",
          productNo: batch.productNo || "",
          orderDate: batch.orderDate || "",
          due: batch.due || "",
          shipDate: batch.shipDate || "",
          byDate: {},
        });
      }
      const item = looseModels.get(modelKeyU);
      if (!item.byDate[day.date]) item.byDate[day.date] = { steps: [] };
      const held = item.byDate[day.date];
      for (const step of batch.steps || []) if (!held.steps.includes(step)) held.steps.push(step);
      if (batch.qty) item.qty = batch.qty;
      if (batch.productNo) item.productNo = batch.productNo;
      if (batch.orderDate) item.orderDate = batch.orderDate;
      if (batch.due) item.due = batch.due;
      if (batch.shipDate) item.shipDate = batch.shipDate;
      if (batch.model) item.model = batch.model;
    }
  }
  for (const item of tickets.values()) {
    const dayCells = {};
    for (const date of jdDates) {
      const ticket = item.byDate[date];
      dayCells[date] = {
        text: ticket ? (ticket.steps && ticket.steps.length ? joinSteps(ticket.steps) : "无在制") : "未在WIP",
        present: !!ticket,
        snapshot: true,
        steps: ticket ? ticket.steps || [] : [],
        seqLabel: ticket ? sequenceLabel(ticket.steps, jdCatalog) : "",
        pos: [item.po],
        qty: item.qty,
        productNo: item.productNo,
      };
    }
    rows.push(wipRow({
      trackId: `捷德|WIP|310|${item.po.toUpperCase()}`,
      supplier: "捷德",
      customer: "捷德",
      source: "310",
      prodNo: "",
      factoryCode: "",
      wipSc: "",
      wipPn: "",
      custModel: item.model,
      po: "",
      wipPo: item.po,
      productNo: item.productNo,
      orderQty: item.qty,
      wipQty: item.qty,
      orderDate: item.orderDate,
      due: item.due,
      shipDate: item.shipDate,
    }, jdDates, dayCells, jdCatalog, asOf));
  }
  for (const item of looseModels.values()) {
    if ([...tickets.values()].some((ticket) => ticket.modelKeyU === item.modelKeyU)) continue;
    const dayCells = {};
    for (const date of jdDates) {
      const held = item.byDate[date];
      dayCells[date] = {
        text: held ? (held.steps.length ? joinSteps(held.steps) : "无在制") : "未在WIP",
        present: !!held,
        snapshot: true,
        steps: held ? held.steps : [],
        seqLabel: held ? sequenceLabel(held.steps, jdCatalog) : "",
        qty: item.qty,
        productNo: item.productNo,
      };
    }
    rows.push(wipRow({
      trackId: `捷德|WIP|310|${item.modelKeyU}|${clean(item.qty).toUpperCase()}`,
      supplier: "捷德",
      customer: "捷德",
      source: "310",
      prodNo: "",
      factoryCode: "",
      wipSc: "",
      wipPn: "",
      custModel: item.model,
      po: "",
      wipPo: "",
      productNo: item.productNo,
      orderQty: item.qty,
      wipQty: item.qty,
      orderDate: item.orderDate,
      due: item.due,
      shipDate: item.shipDate,
    }, jdDates, dayCells, jdCatalog, asOf));
  }
  return rows;
}

export function compareFocus(a, b) {
  const rank = (a.type === "无进度" ? 0 : 1) - (b.type === "无进度" ? 0 : 1);
  if (rank) return rank;
  const left = a.dueDays == null ? 100000 : a.dueDays;
  const right = b.dueDays == null ? 100000 : b.dueDays;
  if (left !== right) return left - right;
  return String(a.prodNo).localeCompare(String(b.prodNo));
}

export function dueBucket(row, withinDays) {
  if (row.dueDays == null) return "";
  if (row.status === "出库") return "";
  if (row.dueDays < 0) return "逾期";
  if (row.dueDays <= withinDays) return "临近";
  return "";
}
