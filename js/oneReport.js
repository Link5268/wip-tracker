import { classifyPresence, joinSteps } from "./logic.js";
import { indexEntities, matchOrder, normKey } from "./lenient.js";

const HEADER = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } },
  font: { bold: true, color: { argb: "FFFFFFFF" }, name: "微软雅黑", size: 11 },
  alignment: { horizontal: "center", vertical: "middle", wrapText: true },
};
const TYPE_STYLE = {
  工序推进: ["FFC6EFCE", "FF006100", false],
  无进度: ["FFFFC000", "FF9C0006", true],
  已出WIP: ["FFD9D9D9", "FF595959", false],
  今日新增: ["FFDDEBF7", "FF1F4E78", false],
  未在WIP: ["FFF2F2F2", "FF808080", false],
};

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

function verdict(dates, stepsByDate) {
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

export function buildCombinedTables(records, date) {
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
      type: verdict(dates, entity.stepsByDate),
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
      const type = found.matched ? verdict(dates, stepsByDate) : "未在WIP";
      orders.push({
        customer: supplier,
        urgent: order.urgent || "",
        prodNo: order.prodNo,
        custModel: order.custModel,
        qty: order.orderQty || order.outQty || "",
        orderDate: order.orderDate || "",
        due: order.due || "",
        status: order.status || "",
        factoryCode: order.factoryCode || "",
        basis: found.basis,
        many: found.many,
        type,
        days: [0, 1, 2].map((index) => {
          const day = dates[index];
          return { date: day || "", text: day && stepsByDate[day] ? stepText(stepsByDate[day]) : "" };
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
    const texts = [];
    let saw = false;
    for (const entity of entities) {
      if (!(entity.dates || []).includes(day) || !present(entity.stepsByDate[day])) continue;
      saw = true;
      const text = stepText(entity.stepsByDate[day]);
      if (text) texts.push(text);
    }
    if (saw) stepsByDate[day] = texts;
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

export async function buildOneDaily(records, date) {
  if (!date) return { error: "请先选择日期" };
  const tables = buildCombinedTables(records, date);
  if (!tables.windows.y099.length && !tables.windows.Y100.length && !tables.windows.捷德310.length) return { error: `没有 ${date} 及之前的 WIP` };
  const book = workbook();
  writeSummary(book.addWorksheet("汇总"), tables);
  writeRaw(book, tables);
  writeProgress(book.addWorksheet("WIP进度对比"), tables);
  writeOrders(book.addWorksheet("订单WIP进度"), tables);
  const buffer = await book.xlsx.writeBuffer();
  return { filename: `WIP日报_${date}.xlsx`, buffer, tables };
}

function writeSummary(ws, tables) {
  paintHeader(ws.addRow(["客户", "来源", "工序推进", "无进度", "已出WIP", "今日新增", "型号数"]));
  for (const customer of ["奔强", "捷德"]) {
    const sources = [...new Set(tables.progress.filter((row) => row.customer === customer).map((row) => row.source))];
    for (const source of sources) {
      const rows = tables.progress.filter((row) => row.customer === customer && row.source === source);
      ws.addRow([
        customer,
        source,
        rows.filter((row) => row.type === "工序推进").length,
        rows.filter((row) => row.type === "无进度").length,
        rows.filter((row) => row.type === "已出WIP").length,
        rows.filter((row) => row.type === "今日新增").length,
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
  ws.addRow([`各来源用自己最近的有文件的日期做当天。y099 ${tables.windows.y099.join("、") || "无"}；Y100 ${tables.windows.Y100.join("、") || "无"}；捷德 ${tables.windows.捷德310.join("、") || "无"}`]);
  widths(ws, [12, 12, 12, 12, 12, 12, 12]);
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
  paintHeader(ws.addRow(["客户", "来源", "型号或投产单号", "料号或产品编号", "客户型号", "第1天", "第1天工序", "第2天", "第2天工序", "第3天", "第3天工序", "进度"]));
  for (const row of tables.progress) {
    const added = ws.addRow([
      row.customer, row.source, row.code, row.part, row.model,
      row.days[0].date, row.days[0].text, row.days[1].date, row.days[1].text, row.days[2].date, row.days[2].text, row.type,
    ]);
    paintType(added.getCell(12), row.type);
    if (row.type === "无进度") {
      for (const column of [7, 9, 11]) paintType(added.getCell(column), row.type);
    }
  }
  freeze(ws);
  widths(ws, [10, 10, 18, 16, 24, 12, 28, 12, 28, 12, 28, 12]);
}

function writeOrders(ws, tables) {
  paintHeader(ws.addRow(["客户", "加急", "生产编号", "客户型号", "数量", "下单日", "交期", "状态", "厂编", "匹配依据", "一对多", "进度", "第1天", "第1天工序", "第2天", "第2天工序", "第3天", "第3天工序"]));
  for (const row of tables.orders) {
    const added = ws.addRow([
      row.customer, row.urgent, row.prodNo, row.custModel, row.qty, row.orderDate, row.due, row.status, row.factoryCode,
      row.basis, row.many ? "一对多" : "", row.type,
      row.days[0].date, row.days[0].text, row.days[1].date, row.days[1].text, row.days[2].date, row.days[2].text,
    ]);
    paintType(added.getCell(12), row.type);
    if (row.urgent) added.getCell(2).font = { bold: true, color: { argb: "FFC00000" } };
    if (row.many) added.getCell(11).font = { bold: true, color: { argb: "FF9C5700" } };
  }
  freeze(ws);
  widths(ws, [10, 10, 16, 24, 10, 12, 12, 10, 16, 22, 10, 12, 12, 28, 12, 28, 12, 28]);
}
