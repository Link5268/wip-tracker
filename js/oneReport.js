import { classifyPresence, dateDiff, joinSteps } from "./logic.js";
import { indexEntities, matchOrder, normKey } from "./lenient.js";
import { catalogsFrom, compareBySequence, sequenceLabel } from "./processOrder.js";

const HEADER = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } },
  font: { bold: true, color: { argb: "FFFFFFFF" }, name: "微软雅黑", size: 11 },
  alignment: { horizontal: "center", vertical: "middle", wrapText: true },
};
const TYPE_STYLE = {
  工序推进: ["FFC6EFCE", "FF006100", false],
  无进度: ["FFFFC000", "FF9C0006", true],
  工序回退: ["FFFECACA", "FF9F1239", true],
  "工序变化(顺序未知)": ["FFEDE9FE", "FF5B21B6", false],
  已出WIP: ["FFD9D9D9", "FF595959", false],
  今日新增: ["FFDDEBF7", "FF1F4E78", false],
  未在WIP: ["FFF2F2F2", "FF808080", false],
};

const SUMMARY_TYPES = ["工序推进", "无进度", "工序回退", "工序变化(顺序未知)", "已出WIP", "今日新增"];

function datesOf(records, supplier) {
  return [...new Set(records.filter((record) => record.supplier === supplier && record.kind === "wip" && record.date).map((record) => record.date))].sort();
}

function latestFiles(records, supplier, date) {
  const picked = new Map();
  records.filter((record) => record.supplier === supplier && record.kind === "wip" && record.date === date).forEach((record) => {
    const key = record.subtype || supplier;
    const prev = picked.get(key);
    if (!prev || String(prev.importedAt) < String(record.importedAt)) picked.set(key, record);
  });
  return [...picked.values()];
}

function sourceDates(records, supplier, subtype, date) {
  return [...new Set(records.filter((record) => record.supplier === supplier && record.kind === "wip" && record.subtype === subtype && record.date && record.date <= date).map((record) => record.date))].sort();
}

function sourceWindow(records, supplier, subtype, date) {
  const dates = sourceDates(records, supplier, subtype, date);
  const known = new Map();
  const days = [];
  for (const day of dates) {
    const file = latestFiles(records, supplier, day).find((item) => item.subtype === subtype);
    const models = new Map();
    for (const original of (file && file.models) || []) {
      const model = { ...original, steps: [...(original.steps || [])], source: subtype };
      const scKey = `${subtype}|${normKey(model.sc)}`;
      if (!normKey(model.pn) && known.has(scKey)) {
        const prior = known.get(scKey);
        model.pn = prior.pn;
        model.pnU = prior.pnU;
        model.pnFrom = "history";
        model.key = `${subtype}|${model.scU}|${model.pnU}`;
      }
      const existing = models.get(model.key);
      if (!existing) models.set(model.key, model);
      else {
        for (const step of model.steps) if (!existing.steps.includes(step)) existing.steps.push(step);
      }
      if (normKey(model.pn)) known.set(scKey, { pn: model.pn, pnU: normKey(model.pn) });
    }
    days.push({ date: day, models, file });
  }
  return { dates: dates.slice(-3), days: days.slice(-3), latest: dates[dates.length - 1] || "" };
}

function jiedeDays(records, date) {
  const dates = datesOf(records, "捷德").filter((item) => item <= date).slice(-3);
  return dates.map((day) => {
    const file = latestFiles(records, "捷德", day)[0];
    const tickets = new Map();
    for (const ticket of (file && file.tickets) || []) {
      const prev = tickets.get(ticket.po);
      if (!prev) {
        tickets.set(ticket.po, { ...ticket, steps: [...(ticket.steps || [])] });
        continue;
      }
      for (const step of ticket.steps || []) if (!prev.steps.includes(step)) prev.steps.push(step);
      if ((ticket.far || 0) >= (prev.far || 0)) prev.display = ticket.display;
    }
    const productByPo = productNumbers(file);
    const loose = [];
    for (const batch of (file && file.batches) || []) {
      if (batch.po) continue;
      loose.push(batch);
    }
    return { date: day, tickets, productByPo, loose };
  });
}

function productNumbers(file) {
  const map = new Map();
  const matrix = (file && file.sheetMatrix) || [];
  let header = -1;
  let productCol = 4;
  let poCol = 2;
  matrix.forEach((row, index) => {
    const cells = row.map((cell) => String(cell ?? "").trim());
    if (header < 0 && cells.includes("客户型号")) {
      header = index;
      const found = cells.indexOf("产品编号");
      if (found >= 0) productCol = found;
      return;
    }
    if (header < 0 || index === header) return;
    const po = String(row[poCol] ?? "").trim();
    const product = String(row[productCol] ?? "").trim();
    if (po && product && !map.has(po)) map.set(po, product);
  });
  return map;
}

function present(steps) {
  return Array.isArray(steps);
}

function verdict(dates, stepsByDate, catalog) {
  if (!dates.length) return "未在WIP";
  const current = dates[dates.length - 1];
  const previous = dates.length > 1 ? dates[dates.length - 2] : null;
  const onCurrent = present(stepsByDate[current]);
  const onPrevious = previous ? present(stepsByDate[previous]) : false;
  if (!onCurrent && !onPrevious) {
    return dates.slice(0, -1).some((day) => present(stepsByDate[day])) ? "已出WIP" : "未在WIP";
  }
  return compareBySequence(previous ? stepsByDate[previous] : null, stepsByDate[current], onPrevious, onCurrent, catalog);
}

function setVerdict(dates, stepsByDate) {
  if (!dates.length) return "未在WIP";
  const current = dates[dates.length - 1];
  const previous = dates.length > 1 ? dates[dates.length - 2] : null;
  const onCurrent = present(stepsByDate[current]);
  const onPrevious = previous ? present(stepsByDate[previous]) : false;
  if (!onCurrent && !onPrevious) {
    return dates.slice(0, -1).some((day) => present(stepsByDate[day])) ? "已出WIP" : "未在WIP";
  }
  return classifyPresence(previous ? stepsByDate[previous] : null, stepsByDate[current], onPrevious, onCurrent);
}

function todaySeq(dates, stepsByDate, catalog) {
  const current = dates[dates.length - 1];
  if (!current || !present(stepsByDate[current])) return "";
  return sequenceLabel(stepsByDate[current], catalog);
}

function stepText(steps) {
  if (!steps) return "";
  if (!steps.length) return "无在制";
  return joinSteps(steps);
}

function addBenqiangSource(records, date, subtype, entities) {
  const window = sourceWindow(records, "奔强", subtype, date);
  const map = new Map();
  for (const day of window.days) {
    for (const model of day.models.values()) {
      if (!map.has(model.key)) {
        map.set(model.key, {
          id: `奔强|${model.key}`,
          customer: "奔强",
          source: subtype,
          code: model.sc,
          pn: model.pn,
          sc: model.sc,
          cm: model.cm,
          po: "",
          productNo: "",
          qty: "",
          stepsByDate: {},
          dates: window.dates,
        });
      }
      map.get(model.key).stepsByDate[day.date] = model.steps || [];
    }
  }
  entities.push(...map.values());
  return window;
}

export function buildCombinedTables(records, date, catalogOverrides) {
  const catalogs = catalogsFrom(catalogOverrides);
  const entities = [];
  const y099 = addBenqiangSource(records, date, "y099", entities);
  const y100 = addBenqiangSource(records, date, "Y100", entities);
  const jdDays = jiedeDays(records, date);
  const jdDateList = jdDays.map((day) => day.date);
  const bqMap = new Map(entities.filter((entity) => entity.customer === "奔强").map((entity) => [entity.id, entity]));

  const jdMap = new Map();
  for (const day of jdDays) {
    for (const [po, ticket] of day.tickets) {
      const id = `捷德|${po}`;
      if (!jdMap.has(id)) {
        jdMap.set(id, {
          id,
          customer: "捷德",
          source: "310",
          code: po,
          pn: "",
          sc: "",
          cm: ticket.model,
          po,
          productNo: day.productByPo.get(po) || "",
          qty: ticket.qty || "",
          stepsByDate: {},
          dates: jdDateList,
        });
      }
      const entity = jdMap.get(id);
      if (!entity.productNo && day.productByPo.get(po)) entity.productNo = day.productByPo.get(po);
      entity.stepsByDate[day.date] = ticket.steps || [];
    }
    for (const batch of day.loose || []) {
      const id = `捷德|待投产|${normKey(batch.modelKey)}|${normKey(batch.qty)}`;
      if (!jdMap.has(id)) {
        jdMap.set(id, {
          id,
          customer: "捷德",
          source: "310",
          code: batch.model || "",
          pn: "",
          sc: "",
          cm: batch.model || "",
          po: "",
          productNo: "",
          qty: batch.qty || "",
          stepsByDate: {},
          dates: jdDateList,
        });
      }
      jdMap.get(id).stepsByDate[day.date] = batch.steps || [];
    }
  }
  entities.push(...jdMap.values());

  const progress = [...bqMap.values(), ...jdMap.values()].map((entity) => {
    const dates = entity.dates;
    const cells = [0, 1, 2].map((index) => {
      const day = dates[index];
      if (!day) return { date: "", text: "" };
      const steps = entity.stepsByDate[day];
      return { date: day, text: steps ? stepText(steps) : "" };
    });
    return {
      customer: entity.customer,
      source: entity.source,
      code: entity.code,
      part: entity.customer === "奔强" ? entity.pn : entity.productNo,
      model: entity.cm,
      days: cells,
      type: verdict(dates, entity.stepsByDate, catalogs[entity.customer]),
      setType: setVerdict(dates, entity.stepsByDate),
      seqLabel: todaySeq(dates, entity.stepsByDate, catalogs[entity.customer]),
      prevSteps: dates.length > 1 ? entity.stepsByDate[dates[dates.length - 2]] : null,
      currSteps: entity.stepsByDate[dates[dates.length - 1]] || null,
    };
  });

  const orders = [];
  for (const supplier of ["奔强", "捷德"]) {
    const book = records.filter((record) => record.supplier === supplier && record.kind === "order" && (!record.date || record.date <= date))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.importedAt).localeCompare(String(b.importedAt)))
      .pop();
    const pool = entities.filter((entity) => entity.customer === supplier);
    const index = indexEntities(pool);
    for (const order of (book && book.orders) || []) {
      const found = matchOrder(order, index);
      const trail = orderTrail(found.entities);
      const dates = trail.dates;
      const stepsByDate = trail.stepsByDate;
      const catalog = catalogs[supplier];
      const type = found.matched ? verdict(dates, stepsByDate, catalog) : "未在WIP";
      const sources = [...new Set(found.entities.map((entity) => entity.source).filter(Boolean))];
      orders.push({
        customer: supplier,
        source: sources.join("+"),
        urgent: order.urgent || "",
        prodNo: order.prodNo,
        custModel: order.custModel,
        qty: order.orderQty || order.outQty || "",
        orderDate: order.orderDate || "",
        due: order.due || "",
        status: order.status || "",
        factoryCode: order.factoryCode || "",
        po: order.po || "",
        basis: found.basis,
        many: found.many,
        type,
        setType: found.matched ? setVerdict(dates, stepsByDate) : "未在WIP",
        seqLabel: found.matched ? todaySeq(dates, stepsByDate, catalog) : "",
        wipQty: [...new Set(found.entities.map((entity) => entity.qty).filter(Boolean))].join(" / "),
        days: [0, 1, 2].map((index) => {
          const day = dates[index];
          const steps = day ? stepsByDate[day] : null;
          return {
            date: day || "",
            text: steps ? stepText(steps) : "",
            seq: steps ? sequenceLabel(steps, catalog) : "",
          };
        }),
      });
    }
  }

  const raw = {
    捷德310: fileOnLatest(records, "捷德", "310", date),
    y099: fileOnLatest(records, "奔强", "y099", date),
    Y100: fileOnLatest(records, "奔强", "Y100", date),
  };

  return {
    date,
    windows: { y099: y099.dates, Y100: y100.dates, 捷德310: jdDateList },
    bqDates: [...new Set([...y099.dates, ...y100.dates])].sort(),
    jdDates: jdDateList,
    progress,
    orders,
    raw,
  };
}

function fileOnLatest(records, supplier, subtype, date) {
  const latest = sourceDates(records, supplier, subtype, date).pop();
  if (!latest) return null;
  const file = latestFiles(records, supplier, latest).find((item) => item.subtype === subtype);
  return file ? { ...file, date: latest } : null;
}

function orderTrail(entities) {
  const dates = [...new Set(entities.flatMap((entity) => entity.dates || []))].sort().slice(-3);
  const stepsByDate = {};
  for (const day of dates) {
    const steps = [];
    const seen = new Set();
    let saw = false;
    for (const entity of entities) {
      if (!(entity.dates || []).includes(day) || !present(entity.stepsByDate[day])) continue;
      saw = true;
      for (const step of entity.stepsByDate[day] || []) {
        if (seen.has(step)) continue;
        seen.add(step);
        steps.push(step);
      }
    }
    if (saw) stepsByDate[day] = steps;
  }
  return { dates, stepsByDate };
}

function workbook() {
  const ExcelJS = globalThis.ExcelJS;
  if (!ExcelJS) throw new Error("ExcelJS 未加载");
  const book = new ExcelJS.Workbook();
  book.creator = "环祥货期跟踪";
  return book;
}

function paintHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER.fill;
    cell.font = HEADER.font;
    cell.alignment = HEADER.alignment;
  });
  row.height = 22;
}

function paintType(cell, type) {
  const style = TYPE_STYLE[type];
  if (!style) return;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style[0] } };
  cell.font = { bold: style[2], color: { argb: style[1] }, name: "微软雅黑", size: 11 };
}

function widths(ws, list) {
  list.forEach((width, index) => {
    if (width) ws.getColumn(index + 1).width = width;
  });
}

function freeze(ws) {
  ws.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2", activeCell: "A2" }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, ws.rowCount), column: ws.columnCount || 1 } };
}

function dailyOptions(value) {
  if (!value) return {};
  if (value.catalogs || value.stars || value.notes) return value;
  return { catalogs: value };
}

export async function buildOneDaily(records, date, options) {
  if (!date) return { error: "请先选择日期" };
  const settings = dailyOptions(options);
  const tables = buildCombinedTables(records, date, settings.catalogs);
  if (!tables.windows.y099.length && !tables.windows.Y100.length && !tables.windows.捷德310.length) return { error: `没有 ${date} 及之前的 WIP` };
  const book = workbook();
  writeSummary(book.addWorksheet("汇总"), tables);
  writeRaw(book, tables);
  writeProgress(book.addWorksheet("WIP进度对比"), tables);
  writeOrders(book.addWorksheet("订单WIP进度"), tables);
  writeFocus(book.addWorksheet("重点订单"), tables, settings);
  const buffer = await book.xlsx.writeBuffer();
  return { filename: `WIP日报_${date}.xlsx`, buffer, tables };
}

function writeSummary(ws, tables) {
  paintHeader(ws.addRow(["客户", "来源", ...SUMMARY_TYPES, "型号数"]));
  for (const customer of ["奔强", "捷德"]) {
    const sources = [...new Set(tables.progress.filter((row) => row.customer === customer).map((row) => row.source))];
    for (const source of sources) {
      const rows = tables.progress.filter((row) => row.customer === customer && row.source === source);
      ws.addRow([
        customer,
        source,
        ...SUMMARY_TYPES.map((type) => rows.filter((row) => row.type === type).length),
        rows.length,
      ]);
    }
  }
  ws.addRow([]);
  paintHeader(ws.addRow(["客户", "订单数", "已匹配", "其中一对多", "未在WIP"]));
  for (const customer of ["奔强", "捷德"]) {
    const rows = tables.orders.filter((row) => row.customer === customer);
    ws.addRow([
      customer,
      rows.length,
      rows.filter((row) => row.type !== "未在WIP").length,
      rows.filter((row) => row.many).length,
      rows.filter((row) => row.type === "未在WIP").length,
    ]);
  }
  ws.addRow([]);
  ws.addRow([`各来源用自己最近的有文件的日期做当天。y099 ${tables.windows.y099.join("、") || "无"}；Y100 ${tables.windows.Y100.join("、") || "无"}；捷德 ${tables.windows.捷德310.join("、") || "无"}。进度按工序顺序号比较。工程暂定第 0 道，仓库暂定第 999 道（视为完工），外发和 PCBA 顺序未知，等 Jay 确认。`]);
  widths(ws, [12, 12, 12, 12, 14, 18, 12, 12, 12]);
  ws.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }];
}

function writeRaw(book, tables) {
  const bqFields = [
    ["生产型号", "sc"],
    ["客户型号", "cm"],
    ["客户料号", "pn"],
    ["客户PO", "po"],
    ["下单时间", "orderedAt"],
    ["工艺名称", "step"],
    ["备注", "note"],
  ];
  for (const source of ["y099", "Y100"]) {
    const file = tables.raw[source];
    if (!file) continue;
    const ws = book.addWorksheet(`今日WIP-${source}-${file.date}`);
    const headers = file.headers && file.headers.length ? file.headers : bqFields.map((item) => item[0]);
    const columns = headers.includes("序号") ? ["文件日期", ...headers] : ["文件日期", "序号", ...headers];
    paintHeader(ws.addRow(columns));
    let seq = 0;
    for (const line of file.lines || []) {
      seq += 1;
      const map = { 文件日期: file.date, 序号: seq, 生产型号: line.sc, 客户型号: line.cm, 客户料号: line.pn, 客户PO: line.po, 下单时间: line.orderedAt, 工艺名称: line.step === "(无工艺)" ? "" : line.step, 备注: line.note };
      ws.addRow(columns.map((name) => map[name] ?? ""));
    }
    freeze(ws);
    widths(ws, [14, 8, 16, 28, 16, 18, 20, 14, 12]);
  }
  if (tables.raw.捷德310) {
    const file = tables.raw.捷德310;
    const ws = book.addWorksheet(`今日WIP-捷德310-${file.date}`);
    const matrix = file.sheetMatrix || [];
    matrix.forEach((source, index) => {
      const values = source.map((cell) => (cell == null ? "" : cell));
      ws.addRow(index === 0 ? ["文件日期", ...values] : [file.date, ...values]);
    });
    const headerRow = matrix.findIndex((row) => row.some((cell) => String(cell).trim() === "客户型号"));
    ws.views = [{ state: "frozen", ySplit: Math.max(1, headerRow + 1), topLeftCell: `A${Math.max(2, headerRow + 2)}` }];
    widths(ws, [14, 18, 8, 18, 12, 16, 20, 12]);
  }
}

function writeProgress(ws, tables) {
  paintHeader(ws.addRow(["客户", "来源", "型号或投产单号", "料号或产品编号", "客户型号", "第1天", "第1天工序", "第2天", "第2天工序", "第3天", "第3天工序", "进度", "今日工序顺序"]));
  for (const row of tables.progress) {
    const added = ws.addRow([
      row.customer, row.source, row.code, row.part, row.model,
      row.days[0].date, row.days[0].text, row.days[1].date, row.days[1].text, row.days[2].date, row.days[2].text, row.type, row.seqLabel || "",
    ]);
    paintType(added.getCell(12), row.type);
    if (row.type === "无进度" || row.type === "工序回退") {
      for (const column of [7, 9, 11]) paintType(added.getCell(column), row.type);
    }
  }
  freeze(ws);
  widths(ws, [10, 10, 18, 16, 24, 12, 28, 12, 28, 12, 28, 18, 16]);
}

function writeOrders(ws, tables) {
  paintHeader(ws.addRow(["客户", "加急", "生产编号", "客户型号", "数量", "下单日", "交期", "状态", "厂编", "匹配依据", "一对多", "进度", "今日工序顺序", "第1天", "第1天工序", "第2天", "第2天工序", "第3天", "第3天工序"]));
  for (const row of tables.orders) {
    const added = ws.addRow([
      row.customer, row.urgent, row.prodNo, row.custModel, row.qty, row.orderDate, row.due, row.status, row.factoryCode,
      row.basis, row.many ? "一对多" : "", row.type, row.seqLabel || "",
      row.days[0].date, row.days[0].text, row.days[1].date, row.days[1].text, row.days[2].date, row.days[2].text,
    ]);
    paintType(added.getCell(12), row.type);
    if (row.urgent) added.getCell(2).font = { bold: true, color: { argb: "FFC00000" } };
    if (row.many) added.getCell(11).font = { bold: true, color: { argb: "FF9C5700" } };
  }
  freeze(ws);
  widths(ws, [10, 10, 16, 24, 10, 12, 12, 10, 16, 22, 10, 18, 16, 12, 28, 12, 28, 12, 28]);
}

function starred(stars, id) {
  if (!stars) return false;
  if (typeof stars.has === "function") return stars.has(id);
  return Boolean(stars[id]);
}

function noteOf(notes, id) {
  if (!notes) return "";
  if (typeof notes.get === "function") return notes.get(id) || "";
  return notes[id] || "";
}

function urgentText(value) {
  const text = String(value || "").trim();
  return text === "加急" || text.startsWith("急");
}

function writeFocus(ws, tables, settings) {
  paintHeader(ws.addRow(["关注", "加急", "客户", "生产编号", "客户型号", "客户PO", "厂编", "订单数量", "在制数量", "下单日", "交期", "距交期天数", "进度", "今日工序顺序", "匹配依据", "跟进备注", "第1天", "第1天工序", "第1天顺序", "第2天", "第2天工序", "第2天顺序", "第3天", "第3天工序", "第3天顺序"]));
  const picked = tables.orders.filter((row) => {
    const id = `${row.customer}|${row.prodNo}`;
    return urgentText(row.urgent) || starred(settings.stars, id);
  });
  for (const row of picked) {
    const id = `${row.customer}|${row.prodNo}`;
    const dueDays = dateDiff(row.due, tables.date);
    const added = ws.addRow([
      starred(settings.stars, id) ? "我关注的" : "",
      row.urgent || "",
      row.customer,
      row.prodNo,
      row.custModel,
      row.po || "",
      row.factoryCode,
      row.qty,
      row.wipQty || "",
      row.orderDate,
      row.due,
      dueDays == null ? "" : dueDays,
      row.type,
      row.seqLabel || "",
      row.basis,
      noteOf(settings.notes, id),
      row.days[0].date, row.days[0].text, row.days[0].seq || "",
      row.days[1].date, row.days[1].text, row.days[1].seq || "",
      row.days[2].date, row.days[2].text, row.days[2].seq || "",
    ]);
    paintType(added.getCell(13), row.type);
    if (row.urgent) added.getCell(2).font = { bold: true, color: { argb: "FFC00000" } };
    if (dueDays != null && dueDays <= 3) added.getCell(12).font = { bold: true, color: { argb: "FF9F1239" } };
  }
  freeze(ws);
  widths(ws, [12, 10, 10, 16, 24, 18, 16, 12, 12, 12, 12, 12, 18, 16, 18, 24, 12, 22, 14, 12, 22, 14, 12, 22, 14]);
}

export async function buildSearchWorkbook(rows) {
  const book = workbook();
  const ws = book.addWorksheet("重点订单查询");
  paintHeader(ws.addRow(["关注", "加急", "客户", "生产编号", "客户型号", "客户PO", "生产型号", "厂编", "投产单号", "客户料号", "订单数量", "在制数量", "下单日", "交期", "距交期天数", "进度", "今日工序顺序", "匹配依据", "跟进备注"]));
  for (const row of rows) {
    const added = ws.addRow([
      row.starred ? "我关注的" : "",
      row.urgent || "",
      row.supplier,
      row.prodNo,
      row.custModel,
      row.po || "",
      row.wipSc || "",
      row.factoryCode || "",
      row.wipPo || "",
      row.wipPn || "",
      row.orderQty || row.outQty || "",
      row.wipQty || "",
      row.orderDate || "",
      row.due || "",
      row.dueDays == null ? "" : row.dueDays,
      row.type,
      row.seqLabel || "",
      row.how || "",
      row.note || "",
    ]);
    paintType(added.getCell(16), row.type);
    if (row.dueDays != null && row.dueDays <= 3) added.getCell(15).font = { bold: true, color: { argb: "FF9F1239" } };
  }
  freeze(ws);
  widths(ws, [12, 10, 10, 16, 24, 18, 16, 16, 16, 16, 12, 12, 12, 12, 12, 18, 16, 18, 28]);
  const buffer = await book.xlsx.writeBuffer();
  return { filename: "重点订单查询.xlsx", buffer };
}
