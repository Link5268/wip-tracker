// Matching and day-over-day rules ported from the 奔强 / 捷德 reference workbooks.
// 无进度 = the set of process names is unchanged (order may differ). That is what
// the verified 奔强 counts use; one model keeps the same steps in a different order.

export const STEP_ORDER = [
  "开料", "内层线路", "蚀刻去膜", "内层AOI", "内层钻孔", "内层电镀", "压合", "钻孔",
  "锣金属槽", "钻半孔", "控深钻", "等离子", "沉铜", "加镀", "电镀塞孔", "内层线路1",
  "树脂塞孔", "树脂塞孔2", "减铜", "内层线路2", "蚀刻去膜1", "内层AOI1", "沉铜1", "沉铜2",
  "加镀2", "减铜1", "二钻", "外层线路", "外层线路1", "外层线路2", "二次干膜", "电铜锡",
  "外层蚀刻", "蚀刻引线", "锣半孔", "三钻", "钻沉头孔", "钻沉头孔1", "外层AOI", "曝光阻焊",
  "阻焊2", "文字", "文字2", "表面处理", "成品阻抗测试", "飞针测试", "大板V-CUT", "控深锣",
  "控深锣1", "控深锣2", "一次锣板", "锣板", "锣板1", "小板V-CUT", "斜边", "金手指斜边",
  "*电测", "*OSP", "*FQC", "*包装",
];

const ORDER_MAP = new Map(STEP_ORDER.map((name, i) => [name, i + 1]));

export const MODEL_TYPES = ["工序推进", "无进度", "已出WIP", "今日新增"];
export const ORDER_TYPES = ["工序推进", "无进度", "已出WIP", "今日新增", "未在WIP"];

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

function compareModelMaps(prev, curr) {
  const keys = [];
  const seen = new Set();
  for (const key of prev.keys()) {
    keys.push(key);
    seen.add(key);
  }
  for (const key of curr.keys()) if (!seen.has(key)) keys.push(key);
  const counts = emptyTypeCounts();
  const bySource = {
    y099: emptyTypeCounts(),
    Y100: emptyTypeCounts(),
  };
  let urgentStall = 0;
  const rows = [];
  for (const key of keys) {
    const before = prev.get(key) || null;
    const after = curr.get(key) || null;
    const type = classifyPresence(before && before.steps, after && after.steps, !!before, !!after);
    const model = after || before;
    bump(counts, type);
    if (bySource[model.source]) bump(bySource[model.source], type);
    if (type === "无进度" && model.urgent) urgentStall += 1;
    rows.push({
      key,
      source: model.source,
      sc: model.sc,
      pn: model.pn,
      cm: model.cm,
      po: model.po,
      orderedAt: (after || before).orderedAt || "",
      prevText: before ? joinSteps(before.steps) : "（无）",
      currText: after ? joinSteps(after.steps) : "（无）",
      prevRows: before ? before.rows : 0,
      currRows: after ? after.rows : 0,
      type,
      urgent: model.urgent || "",
      due: model.due || "",
      orderStatus: model.orderStatus || "",
      how: model.how || "",
      prodNo: model.prodNo || "",
    });
  }
  return { counts, bySource, urgentStall, rows };
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
    const order = (model.pnU && byPn.get(model.pnU)) || (model.scU && bySc.get(model.scU)) || null;
    model.urgent = order ? clean(order.urgent) : "";
    model.due = order ? order.due || "" : "";
    model.orderStatus = order ? order.status || "" : "";
    model.prodNo = order ? order.prodNo || "" : "";
    model.how = order ? (model.pnU && byPn.get(model.pnU) ? "生产编号" : "厂编") : "未找到订单";
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
      prev.due = ticket.due || "";
      prev.model = ticket.model || prev.model;
      prev.modelKey = ticket.modelKey || prev.modelKey;
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
  if (!pool.length) return { how: "无在制", text: "捷德:无在制数", steps: [], present: true };
  const text = pool.map((batch) => batch.display).join(" / ");
  const steps = [];
  for (const batch of pool) {
    for (const step of batch.steps) if (!steps.includes(step)) steps.push(step);
  }
  return {
    how: sameQty.length ? "数量" : "型号",
    text: `捷德:${text}`,
    steps,
    present: true,
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

export function buildReport(records) {
  const bq = filesOn(records, "奔强", "wip");
  const jd = filesOn(records, "捷德", "wip");
  const bqOrders = latestOrderBook(records, "奔强");
  const jdOrders = latestOrderBook(records, "捷德");
  const bqDays = bq.dates.map((date) => ({ date, ...benqiangDay(bq.map.get(date)) }));
  const jdDays = jd.dates.map((date) => ({ date, ...mergeTickets(jd.map.get(date)) }));

  let benqiang = null;
  if (bqDays.length >= 2) {
    const prev = bqDays[bqDays.length - 2];
    const curr = bqDays[bqDays.length - 1];
    attachOrderFlags(prev.models, (bqOrders && bqOrders.orders) || []);
    attachOrderFlags(curr.models, (bqOrders && bqOrders.orders) || []);
    // Flags used for display come from whichever side exists. Compare reads model.urgent off the surviving side.
    for (const [key, model] of prev.models) {
      if (!curr.models.has(key)) {
        const twin = curr.models.get(key);
        if (!twin) model.urgent = model.urgent || "";
      }
    }
    const compared = compareModelMaps(prev.models, curr.models);
    // Re-apply urgent from either day so a model only present yesterday still shows the order flag.
    for (const row of compared.rows) {
      const model = curr.models.get(row.key) || prev.models.get(row.key);
      row.urgent = model.urgent || "";
      row.due = model.due || "";
      row.orderStatus = model.orderStatus || "";
      row.prodNo = model.prodNo || "";
      row.how = model.how || "";
    }
    compared.urgentStall = compared.rows.filter((row) => row.type === "无进度" && row.urgent).length;
    benqiang = {
      prev: prev.date,
      curr: curr.date,
      prevRows: prev.rowBySource,
      currRows: curr.rowBySource,
      ...compared,
    };
  }

  const pair = bqDays.slice(-2);
  const orderCounts = emptyTypeCounts(ORDER_TYPES);
  let orderUrgentStall = 0;
  const orderRows = [];
  const asOf = [...bq.dates, ...jd.dates].sort().slice(-1)[0] || "";
  const windowDates = [...new Set([...bq.dates, ...jd.dates])].sort().slice(-5);

  for (const order of (bqOrders && bqOrders.orders) || []) {
    const resolved = resolveBenqiangKey(order, pair.length ? pair : bqDays);
    const dayCells = {};
    for (const date of windowDates) {
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
      };
    }
    const supplierDates = bq.dates.filter((date) => date <= (asOf || "9999"));
    const latestDate = supplierDates[supplierDates.length - 1] || "";
    const previousDate = supplierDates[supplierDates.length - 2] || "";
    const latest = latestDate ? dayCells[latestDate] : null;
    const previous = previousDate ? dayCells[previousDate] : null;
    const type = classifyPresence(
      previous && previous.steps,
      latest && latest.steps,
      !!(previous && previous.present),
      !!(latest && latest.present),
    );
    bump(orderCounts, type);
    if (type === "无进度" && isUrgent(order.urgent)) orderUrgentStall += 1;
    orderRows.push(orderRow(order, "奔强", type, resolved.how, dayCells, asOf, latest && latest.text));
  }

  const jdMatchCounts = { 数量: 0, 型号: 0, 无在制: 0, 未匹配: 0, total: 0 };
  const latestJd = jdDays[jdDays.length - 1] || null;
  for (const order of (jdOrders && jdOrders.orders) || []) {
    const dayCells = {};
    const matches = {};
    for (const date of windowDates) {
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
      };
    }
    if (latestJd) {
      const matched = matches[latestJd.date] || jiedeMatch(order, latestJd.batches);
      jdMatchCounts[matched.how] = (jdMatchCounts[matched.how] || 0) + 1;
      jdMatchCounts.total += 1;
    }
    const supplierDates = jd.dates.filter((date) => !asOf || date <= asOf);
    const latestDate = supplierDates[supplierDates.length - 1] || "";
    const previousDate = supplierDates[supplierDates.length - 2] || "";
    const latest = latestDate ? dayCells[latestDate] : null;
    const previous = previousDate ? dayCells[previousDate] : null;
    const type = classifyPresence(
      previous && previous.steps,
      latest && latest.steps,
      !!(previous && previous.present),
      !!(latest && latest.present),
    );
    orderRows.push(orderRow(order, "捷德", type, (matches[latestDate] && matches[latestDate].how) || "未匹配", dayCells, asOf, latest && (latest.detail || latest.text)));
  }

  return {
    asOf,
    windowDates,
    bqDates: bq.dates,
    jdDates: jd.dates,
    benqiang,
    jiede: buildJiedeTri(jdDays),
    jdMatch: latestJd ? { date: latestJd.date, counts: jdMatchCounts } : null,
    orderCounts,
    orderUrgentStall,
    orderRows,
    bqOrderTotal: (bqOrders && bqOrders.orders.length) || 0,
    jdOrderTotal: (jdOrders && jdOrders.orders.length) || 0,
  };
}

function orderRow(order, supplier, type, how, dayCells, asOf, wipText) {
  const dueDays = dateDiff(order.due, asOf);
  return {
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
    dayCells,
  };
}

export function dueBucket(row, withinDays) {
  if (row.dueDays == null) return "";
  if (row.status === "出库") return "";
  if (row.dueDays < 0) return "逾期";
  if (row.dueDays <= withinDays) return "临近";
  return "";
}
