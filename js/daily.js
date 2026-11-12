import { buildReport, dateDiff, STEP_ORDER } from "./logic.js";

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
  高风险: ["FFFFC7CE", "FF9C0006", true],
  关注: ["FFFFEB9C", "FF9C5700", false],
  正常: ["FFC6EFCE", "FF006100", false],
  新增: ["FFDDEBF7", "FF1F4E78", false],
  消失: ["FFD9D9D9", "FF595959", false],
  无在制: ["FFF2F2F2", "FF808080", false],
  倒退: ["FFFFC7CE", "FF9C0006", true],
  正常推进: ["FFC6EFCE", "FF006100", false],
  部分推进: ["FFDDEBF7", "FF1F4E78", false],
  近1天未动: ["FFFFC000", "FF9C0006", true],
  连续3天未动: ["FFFFC000", "FF9C0006", true],
  已完成或消失: ["FFD9D9D9", "FF595959", false],
  消失后又出现: ["FFDDEBF7", "FF1F4E78", false],
};

function book() {
  const ExcelJS = globalThis.ExcelJS;
  if (!ExcelJS) throw new Error("ExcelJS 未加载");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "环祥货期跟踪";
  return workbook;
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

function freeze(ws, xSplit, ySplit, topLeftCell) {
  ws.views = [{ state: "frozen", xSplit, ySplit, topLeftCell, activeCell: topLeftCell }];
}

function asDate(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return value;
  const [year, month, day] = text.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function datesOf(records, supplier) {
  return [...new Set(records.filter((record) => record.supplier === supplier && record.kind === "wip" && record.date).map((record) => record.date))].sort();
}

function filesOn(records, supplier, date, subtype) {
  return records
    .filter((record) => record.supplier === supplier && record.kind === "wip" && record.date === date && (!subtype || record.subtype === subtype))
    .sort((a, b) => String(a.importedAt).localeCompare(String(b.importedAt)));
}

function latestFile(records, supplier, date, subtype) {
  const list = filesOn(records, supplier, date, subtype);
  return list[list.length - 1] || null;
}

export function dailyStatus(records, date) {
  if (!date) {
    return { benqiangCompare: "请先选择日期", benqiangMatch: "请先选择日期", jiedeMatch: "请先选择日期", jiedeTri: "请先选择日期" };
  }
  const bq = datesOf(records, "奔强");
  const jd = datesOf(records, "捷德");
  const prev = bq.filter((item) => item < date).pop();
  const ordersBq = records.some((record) => record.supplier === "奔强" && record.kind === "order" && (!record.date || record.date <= date));
  const ordersJd = records.some((record) => record.supplier === "捷德" && record.kind === "order" && (!record.date || record.date <= date));
  const jdUpto = jd.filter((item) => item <= date);
  return {
    benqiangCompare: bq.includes(date)
      ? (prev ? "" : `缺少 ${date} 之前的奔强 WIP，无法和前一天对比`)
      : `缺少 ${date} 的奔强 WIP（y099 或 Y100）`,
    benqiangMatch: !bq.includes(date)
      ? `缺少 ${date} 的奔强 WIP（y099 或 Y100）`
      : (ordersBq ? "" : "缺少伯仁奔强订单表"),
    jiedeMatch: !jd.includes(date)
      ? `缺少 ${date} 的捷德 310 WIP`
      : (ordersJd ? "" : "缺少伯仁捷德订单表"),
    jiedeTri: jdUpto.length >= 3 ? "" : `捷德 WIP 在 ${date} 及之前只有 ${jdUpto.length} 天，三日对比需要连续 3 天`,
  };
}

function countOf(rows, source, type) {
  return rows.filter((row) => row.source === source && row.type === type).length;
}

function urgentOf(rows, source, type) {
  return rows.filter((row) => row.source === source && row.type === type && row.urgent).length;
}

async function benqiangCompare(records, date) {
  const message = dailyStatus(records, date).benqiangCompare;
  if (message) return { error: message };
  const report = reportAt(records, date);
  const compared = report.benqiang;
  const prevDate = compared.prev;
  const workbook = book();
  const summary = workbook.addWorksheet("汇总");
  summary.getCell("A1").value = "奔强 WIP 每日进度对比 汇总";
  summary.getCell("A1").font = { bold: true, size: 14, name: "微软雅黑" };
  summary.mergeCells("A2:F2");
  summary.getCell("A2").value = `上一日 ${prevDate} → 当日 ${date}。缺客户料号的型号已按更早的生产型号回填料号。本表由页面直接算出数值。`;
  summary.getCell("A2").alignment = { wrapText: true };
  const head = summary.addRow(["变化类型", "y099", "Y100", "合计", "其中加急", "说明"]);
  paintHeader(head);
  const notes = {
    工序推进: "今日顺序号比上一日大",
    无进度: "两天最远顺序号相同",
    工序回退: "今日顺序号比上一日小",
    "工序变化(顺序未知)": "有工序不在顺序表里，无法比较",
    已出WIP: "昨日有、今日没有（多为完工入库/出货）",
    今日新增: "今日新出现（多为新单）",
  };
  const summaryTypes = ["工序推进", "无进度", "工序回退", "工序变化(顺序未知)", "已出WIP", "今日新增"];
  for (const type of summaryTypes) {
    const row = summary.addRow([
      type,
      countOf(compared.rows, "y099", type),
      countOf(compared.rows, "Y100", type),
      compared.counts[type] || 0,
      urgentOf(compared.rows, "y099", type) + urgentOf(compared.rows, "Y100", type),
      notes[type],
    ]);
    paintType(row.getCell(1), type);
    for (let column = 1; column <= 5; column += 1) paintType(row.getCell(column), type);
  }
  const y099Prev = latestFile(records, "奔强", prevDate, "y099");
  const y099Curr = latestFile(records, "奔强", date, "y099");
  const y100Prev = latestFile(records, "奔强", prevDate, "Y100");
  const y100Curr = latestFile(records, "奔强", date, "Y100");
  const total = summary.addRow(["合计", summaryTypes.reduce((sum, type) => sum + countOf(compared.rows, "y099", type), 0), summaryTypes.reduce((sum, type) => sum + countOf(compared.rows, "Y100", type), 0), compared.rows.length, compared.rows.filter((row) => row.urgent).length]);
  total.font = { bold: true };
  summary.addRow([]);
  summary.addRow(["加急且无进度", compared.rows.filter((row) => row.type === "无进度" && row.urgent).length]);
  summary.addRow(["WIP行数 昨日→今日", `${y099Prev ? y099Prev.rowCount : 0}→${y099Curr ? y099Curr.rowCount : 0}`, `${y100Prev ? y100Prev.rowCount : 0}→${y100Curr ? y100Curr.rowCount : 0}`]);
  widths(summary, [18, 12, 12, 10, 12, 44]);

  const orders = report.orderRows.filter((row) => row.supplier === "奔强");
  const progress = workbook.addWorksheet("订单进度");
  paintHeader(progress.addRow(["加急", "生产编号", "客户", "客户型号", "订单数量", "下单日期", "状态", "外发日期", "外发交期", "供应商厂编", "来源", "昨日工艺", "今日工艺", "进度", "匹配依据", "距交期天数", "_今料号+厂编", "_今料号", "_昨料号+厂编", "_昨料号", "_今厂编", "_昨厂编", "_WIP键", "_对比行"]));
  orders.forEach((row) => {
    const added = progress.addRow([
      row.urgent, row.prodNo, row.customer, row.custModel, row.outQty, asDate(row.orderDate), row.status,
      asDate(row.outDate), asDate(row.due), row.factoryCode,
      (row.dayCells[date] && row.dayCells[date].source) || (row.dayCells[prevDate] && row.dayCells[prevDate].source) || "",
      (row.dayCells[prevDate] && row.dayCells[prevDate].present) ? row.dayCells[prevDate].text : "（无）",
      (row.dayCells[date] && row.dayCells[date].present) ? row.dayCells[date].text : "（无）",
      row.type, row.how, row.dueDays,
    ]);
    for (let column = 1; column <= 16; column += 1) paintType(added.getCell(column), row.type);
    if (row.urgent) added.getCell(1).font = { bold: true, color: { argb: "FFC00000" } };
    if (row.dueDays != null && row.dueDays < 0 && row.status === "已外发") {
      added.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
      added.getCell(9).font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
  });
  freeze(progress, 2, 1, "C2");
  widths(progress, [8, 14, 8, 24, 10, 12, 10, 18, 12, 16, 8, 28, 28, 12, 14, 12]);
  progress.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, progress.rowCount), column: 16 } };

  const detail = workbook.addWorksheet("进度对比");
  paintHeader(detail.addRow(["序", "来源", "变化类型", "加急", "生产型号", "客户型号", "客户料号", "客户PO", "下单时间", "昨日工艺", "今日工艺", "昨日行数", "今日行数", "外发交期", "订单状态", "_类别", "_首行", "_键", "_昨日行", "_今日行", "_订单行"]));
  const ordered = [...compared.rows.filter((row) => row.currRows), ...compared.rows.filter((row) => !row.currRows)];
  ordered.forEach((row, index) => {
    const added = detail.addRow([
      index + 1, row.source, row.type, row.urgent, row.sc, row.cm, row.pn, row.po, row.orderedAt,
      row.prevText, row.currText, row.prevRows || null, row.currRows || null, asDate(row.due), row.orderStatus,
      row.currRows ? 1 : 2, null, row.key,
    ]);
    for (let column = 1; column <= 15; column += 1) paintType(added.getCell(column), row.type);
    if (row.urgent) added.getCell(4).font = { bold: true, color: { argb: "FFC00000" } };
  });
  freeze(detail, 5, 1, "F2");
  widths(detail, [5, 8, 12, 10, 16, 28, 16, 18, 18, 30, 30, 10, 10, 12, 12]);
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, detail.rowCount), column: 15 } };

  writeBenqiangPaste(workbook.addWorksheet("昨日WIP"), [latestFile(records, "奔强", prevDate, "y099"), latestFile(records, "奔强", prevDate, "Y100")].filter(Boolean));
  writeBenqiangPaste(workbook.addWorksheet("今日WIP"), [latestFile(records, "奔强", date, "y099"), latestFile(records, "奔强", date, "Y100")].filter(Boolean));
  writeOrderPaste(workbook.addWorksheet("订单粘贴"), report.orderRows.filter((row) => row.supplier === "奔强"), records, "奔强", date);
  writeGuide(workbook.addWorksheet("使用说明"), [
    "奔强 WIP 每日进度对比",
    "",
    "本文件由货期跟踪页面按所选日期生成，结果格是算好的数值，方便用 WPS 2019 直接打开。",
    "汇总、订单进度、进度对比的列和底色与原来的模板一致。无进度为橙色底、深红字。",
    "昨日WIP / 今日WIP 写入当天的 y099 与 Y100 原始行。缺客户料号时，进度对比里的料号来自更早日期的回填。",
    "订单粘贴是所选日期及之前最近的一份伯仁奔强订单。",
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  return { filename: `奔强WIP每日进度对比_${date}.xlsx`, buffer };
}

function writeBenqiangPaste(ws, files) {
  ["标题来源", "生产型号", "来源", "键(来源|型号|料号)", "工艺(去空格)", "键+工艺", "前面同键行数", "累计工艺(去重)", "累计不同工艺数", "行号", "列表序号", "工艺昨日也有", "客户料号键", "料号|型号键"].forEach((name, index) => {
    const cell = ws.getCell(1, 11 + index);
    cell.value = name;
    cell.font = { bold: true, color: { argb: "FF9C5700" }, name: "微软雅黑", size: 11 };
  });
  let rowIndex = 1;
  files.forEach((file) => {
    ws.getCell(rowIndex, 1).value = file.title || `${file.subtype}客户WIP记录`;
    ws.getCell(rowIndex, 1).font = { bold: true };
    rowIndex += 1;
    const header = ws.getRow(rowIndex);
    ["序号", "生产型号", "客户型号", "客户料号", "客户PO", "下单时间", "工艺名称", "备注"].forEach((name, index) => {
      header.getCell(index + 1).value = name;
    });
    paintHeader(header);
    rowIndex += 1;
    (file.lines || []).forEach((line, index) => {
      const row = ws.getRow(rowIndex);
      [index + 1, line.sc, line.cm, line.pn, line.po, line.orderedAt, line.step === "(无工艺)" ? "" : line.step, line.note].forEach((value, column) => {
        row.getCell(column + 1).value = value == null ? "" : value;
      });
      rowIndex += 1;
    });
  });
  freeze(ws, 0, 2, "A3");
  widths(ws, [8, 16, 30, 16, 18, 20, 14, 12]);
}

function writeOrderPaste(ws, orderRows, records, supplier, date) {
  const book = records.filter((record) => record.supplier === supplier && record.kind === "order" && (!record.date || record.date <= date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.importedAt).localeCompare(String(b.importedAt))).pop();
  const orders = (book && book.orders) || [];
  paintHeader(ws.addRow(["加急", "生产编号", "客户", "客户简称", "类型", "订单", "客户型号", "客户PO", "订单数量", "下单日期", "状态", "工程备注", "备注", "供应商", "外发日期", "外发交期", "外发数量", "EQ开始", "EQ结束", "EQ耗时", "供应商厂编", "业务经理", "", "生产编号键", "供应商厂编键"]));
  orders.forEach((order) => {
    ws.addRow([
      order.urgent, order.prodNo, order.customer, order.shortName, order.boardType, order.orderKind, order.custModel, order.po,
      order.orderQty, asDate(order.orderDate), order.status, order.engNote, order.note, order.supplierName,
      asDate(order.outDate), asDate(order.due), order.outQty, order.eqStart, order.eqEnd, order.eqHours, order.factoryCode, order.salesman,
    ]);
  });
  freeze(ws, 2, 1, "C2");
  widths(ws, [8, 16, 8, 12, 10, 8, 24, 16, 10, 12, 10, 16, 16, 28, 20, 12, 10, 12, 12, 10, 16, 10]);
}

function writeGuide(ws, lines) {
  lines.forEach((line, index) => {
    ws.getCell(index + 1, 1).value = line;
    ws.getCell(index + 1, 1).alignment = { wrapText: true, vertical: "top" };
  });
  ws.getColumn(1).width = 110;
  ws.getCell(1, 1).font = { bold: true, size: 14, name: "微软雅黑" };
}

async function benqiangMatch(records, date) {
  const message = dailyStatus(records, date).benqiangMatch;
  if (message) return { error: message };
  const report = reportAt(records, date);
  const byProd = new Map(report.orderRows.filter((row) => row.supplier === "奔强").map((row) => [row.prodNo, row]));
  const bookOrders = records.filter((record) => record.supplier === "奔强" && record.kind === "order" && (!record.date || record.date <= date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.importedAt).localeCompare(String(b.importedAt))).pop();
  const workbook = book();
  const sheet = workbook.addWorksheet("Sheet1");
  paintHeader(sheet.addRow(["加急", "生产编号", "客户", "客户简称", "类型", "订单", "客户型号", "客户PO", "订单数量", "下单日期", "状态", "工程备注", "备注", "供应商", "外发日期", "外发交期", "外发数量", "EQ开始", "EQ结束", "EQ耗时", "供应商厂编", "业务经理", "WIP", "匹配依据", "WIP下单时间", "料号键", "厂编键", "料号+厂编键"]));
  ((bookOrders && bookOrders.orders) || []).forEach((order) => {
    const matched = byProd.get(order.prodNo);
    const added = sheet.addRow([
      order.urgent, order.prodNo, order.customer, order.shortName, order.boardType, order.orderKind, order.custModel, order.po,
      order.orderQty, asDate(order.orderDate), order.status, order.engNote, order.note, order.supplierName,
      asDate(order.outDate), asDate(order.due), order.outQty, order.eqStart, order.eqEnd, order.eqHours, order.factoryCode, order.salesman,
      matched ? matched.wipText : "未在WIP", matched ? matched.how : "未匹配", "", order.prodNo, order.factoryCode, order.prodNo && order.factoryCode ? `${order.prodNo}|${order.factoryCode}` : "",
    ]);
    if (matched) paintType(added.getCell(23), matched.type);
  });
  freeze(sheet, 4, 1, "E2");
  widths(sheet, [8, 16, 8, 12, 10, 8, 24, 16, 10, 12, 10, 14, 14, 28, 20, 12, 10, 12, 12, 10, 16, 10, 28, 14, 12]);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, sheet.rowCount), column: 25 } };

  const urgent = workbook.addWorksheet("加急重点订单");
  urgent.getCell("A1").value = "奔强 加急重点订单";
  urgent.getCell("A1").font = { bold: true, size: 14 };
  paintHeader(urgent.getRow(4));
  ["序", "加急", "生产编号", "客户", "客户型号", "订单数量", "下单日期", "状态", "外发交期", "距外发交期天数", "外发数量", "供应商厂编", "业务经理", "WIP结果", "匹配依据", "WIP下单时间", "跟进记录", "预计交期", "下次跟进日期", "备注"].forEach((name, index) => {
    urgent.getRow(4).getCell(index + 1).value = name;
  });
  paintHeader(urgent.getRow(4));
  let index = 0;
  ((bookOrders && bookOrders.orders) || []).filter((order) => order.urgent).forEach((order) => {
    index += 1;
    const matched = byProd.get(order.prodNo);
    const row = urgent.getRow(4 + index);
    [index, order.urgent, order.prodNo, order.customer, order.custModel, order.orderQty, asDate(order.orderDate), order.status, asDate(order.due), dateDiff(order.due, date), order.outQty, order.factoryCode, order.salesman, matched ? matched.wipText : "未在WIP", matched ? matched.how : "未匹配"].forEach((value, column) => {
      row.getCell(column + 1).value = value == null ? "" : value;
    });
    row.getCell(2).font = { bold: true, color: { argb: "FFC00000" } };
  });
  freeze(urgent, 3, 4, "D5");
  widths(urgent, [6, 10, 16, 8, 24, 10, 12, 10, 12, 14, 10, 16, 10, 28, 14]);

  const follow = workbook.addWorksheet("加急跟进登记");
  paintHeader(follow.addRow(["生产编号(手填)", "跟进记录", "预计交期", "下次跟进日期", "备注", "是否在加急清单", "_键"]));
  freeze(follow, 1, 1, "B2");
  widths(follow, [16, 40, 14, 14, 24, 16]);
  writeBenqiangPaste(workbook.addWorksheet("y099粘贴"), [latestFile(records, "奔强", date, "y099")].filter(Boolean));
  writeBenqiangPaste(workbook.addWorksheet("Y100粘贴"), [latestFile(records, "奔强", date, "Y100")].filter(Boolean));
  writeGuide(workbook.addWorksheet("使用说明"), [
    "奔强订单 y099 / Y100 WIP 匹配",
    "",
    `对照日期 ${date}。Sheet1 的 WIP、匹配依据是页面按「生产编号+厂编，其次生产编号，再次厂编」算好的数值。`,
    "y099粘贴、Y100粘贴是当天原始行。没有客户料号的行会留空，匹配时仍会用历史料号或厂编。",
    "加急跟进登记留给手工填写，不会覆盖已经手填过的记录（每次下载是一份新文件）。",
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  return { filename: `奔强订单_y099Y100_WIP匹配_${date}.xlsx`, buffer };
}

async function jiedeMatchBook(records, date) {
  const message = dailyStatus(records, date).jiedeMatch;
  if (message) return { error: message };
  const report = reportAt(records, date);
  const byProd = new Map(report.orderRows.filter((row) => row.supplier === "捷德").map((row) => [row.prodNo, row]));
  const bookOrders = records.filter((record) => record.supplier === "捷德" && record.kind === "order" && (!record.date || record.date <= date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.importedAt).localeCompare(String(b.importedAt))).pop();
  const workbook = book();
  const sheet = workbook.addWorksheet("Sheet1");
  paintHeader(sheet.addRow(["加急", "生产编号", "客户", "客户简称", "类型", "订单", "客户型号", "客户PO", "订单数量", "下单日期", "状态", "工程备注", "备注", "供应商", "外发日期", "外发交期", "外发数量", "已入库", "已出库", "欠数", "EQ开始", "EQ结束", "EQ耗时", "供应商厂编", "业务经理", "WIP", "型号键(辅助)", "型号+数量键(辅助)"]));
  ((bookOrders && bookOrders.orders) || []).forEach((order) => {
    const matched = byProd.get(order.prodNo);
    const added = sheet.addRow([
      order.urgent, order.prodNo, order.customer, order.shortName, order.boardType, order.orderKind, order.custModel, order.po,
      order.orderQty, asDate(order.orderDate), order.status, order.engNote, order.note, order.supplierName,
      asDate(order.outDate), asDate(order.due), order.outQty, order.stockIn, order.stockOut, order.shortage,
      order.eqStart, order.eqEnd, order.eqHours, order.factoryCode, order.salesman, matched ? matched.wipText : "未匹配",
    ]);
    if (matched && matched.type === "无进度") paintType(added.getCell(26), "无进度");
  });
  freeze(sheet, 4, 1, "E2");
  widths(sheet, [8, 16, 8, 12, 10, 8, 22, 14, 10, 12, 10, 12, 12, 28, 20, 12, 10, 10, 10, 10, 12, 12, 10, 14, 10, 36]);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, sheet.rowCount), column: 26 } };
  writeJiedeMatrix(workbook.addWorksheet("JK粘贴"), latestFile(records, "捷德", date, "310"));
  writeGuide(workbook.addWorksheet("使用说明"), [
    "我司订单表 捷德 WIP 匹配",
    "",
    `对照日期 ${date}。Z 列「WIP」是按客户型号（去掉括号说明）和优先按外发数量匹配后的工序，格式与原表相同：捷德:工序 数量。`,
    "同一型号多批用「 / 」隔开，一批跨两个工序用「 + 」。找不到是「未匹配」，型号在 WIP 里但没有工序数量是「捷德:无在制数」。",
    "JK粘贴是当天 310 WIP 原表内容。",
  ]);
  const helper = workbook.addWorksheet("辅助列号");
  for (let column = 1; column <= 78; column += 1) helper.getCell(1, column).value = column;
  helper.getCell(2, 1).value = "本表为列号常量（第1行 = 列序号）。生成的匹配结果写在 Sheet1，不再依赖这里的公式。";
  const buffer = await workbook.xlsx.writeBuffer();
  return { filename: `我司订单表_捷德WIP匹配_${date}.xlsx`, buffer };
}

const RISK_ORDER = ["高风险", "关注", "正常", "新增", "消失", "无在制"];

async function jiedeTriBook(records, date) {
  const message = dailyStatus(records, date).jiedeTri;
  if (message) return { error: message };
  const report = reportAt(records, date);
  const tri = report.jiede;
  const workbook = book();
  const compare = workbook.addWorksheet("对比");
  compare.getCell("A1").value = "捷德 WIP 三日进度对比";
  compare.getCell("A1").font = { bold: true, size: 14, name: "微软雅黑" };
  const labels = ["第1天日期", tri.dates[0], "第2天日期", tri.dates[1], "第3天日期", tri.dates[2]];
  labels.forEach((value, index) => {
    compare.getCell(2, index + 1).value = index % 2 ? asDate(value) : value;
    if (index % 2) compare.getCell(2, index + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF99" } };
  });
  const risks = ["高风险", "关注", "正常", "新增", "消失", "无在制"];
  compare.getCell(3, 1).value = "风险";
  compare.getCell(4, 1).value = "单数";
  risks.forEach((risk, index) => {
    compare.getCell(3, index + 2).value = risk;
    compare.getCell(4, index + 2).value = tri.riskCounts[risk] || 0;
    paintType(compare.getCell(3, index + 2), risk);
    paintType(compare.getCell(4, index + 2), risk);
  });
  const statuses = ["倒退", "连续3天未动", "近1天未动", "正常推进", "部分推进", "新增", "消失后又出现", "已完成或消失", "无在制"];
  compare.getCell(6, 1).value = "状态";
  compare.getCell(7, 1).value = "单数";
  statuses.forEach((status, index) => {
    compare.getCell(6, index + 2).value = status;
    compare.getCell(7, index + 2).value = tri.statusCounts[status] || 0;
  });
  const header = compare.getRow(10);
  ["序", "_行", "风险", "状态", "投产单号", "客户型号", "最新交期", "距交期天数", "第1天工序(数量)", "第2天工序(数量)", "第3天工序(数量)", "推进 1→2", "推进 2→3", "三天合计"].forEach((name, index) => {
    header.getCell(index + 1).value = name;
  });
  paintHeader(header);
  const rows = [...tri.rows].sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || ((a.dueDays == null ? 99999 : a.dueDays) - (b.dueDays == null ? 99999 : b.dueDays)));
  rows.forEach((row, index) => {
    const added = compare.getRow(11 + index);
    const total = row.advance12 != null && row.advance23 != null ? row.advance12 + row.advance23 : null;
    [index + 1, index + 1, row.risk, row.status, row.po, row.model, asDate(row.due), row.dueDays, row.days[0], row.days[1], row.days[2], row.advance12, row.advance23, total].forEach((value, column) => {
      added.getCell(column + 1).value = value == null ? "" : value;
    });
    for (let column = 1; column <= 14; column += 1) paintType(added.getCell(column), row.risk);
    if (row.status === "倒退") added.getCell(4).font = { bold: true, color: { argb: "FFC00000" } };
  });
  freeze(compare, 5, 10, "F11");
  widths(compare, [6, 8, 12, 16, 18, 18, 14, 12, 28, 28, 28, 12, 12, 12]);
  compare.autoFilter = { from: { row: 10, column: 1 }, to: { row: Math.max(11, 10 + rows.length), column: 14 } };

  const focus = workbook.addWorksheet("加急重点订单");
  focus.getCell("A1").value = "加急 / 重点订单跟踪";
  focus.getCell("A1").font = { bold: true, size: 14 };
  focus.getCell("A3").value = "黄色列留给手工跟进。本页只列出订单里标了加急、并且能在这三天 WIP 里对上客户型号的单。";
  const focusHeader = focus.getRow(5);
  ["序", "客户型号", "优先级", "加急原因", "客户要求交期", "当前阶段(手填)", "捷德投产单号", "单数", "捷德最新交期", "第1天工序(数量)", "第2天工序(数量)", "第3天工序(数量)", "三天推进", "WIP风险", "距客户交期天数", "提醒", "负责人/联系人", "下次跟进日期", "状态", "跟进记录"].forEach((name, index) => {
    focusHeader.getCell(index + 1).value = name;
  });
  paintHeader(focusHeader);
  freeze(focus, 2, 5, "C6");
  widths(focus, [6, 22, 10, 16, 14, 10, 18, 28, 14, 12]);

  writeGuide(workbook.addWorksheet("使用说明"), [
    "捷德 WIP 三日进度对比",
    "",
    `三日为 ${tri.dates.join("、")}。对比表按投产单汇总，规则与原来的三日表相同：最远工序顺序号、数量签名、倒退和风险。`,
    "第1天、第2天、第3天写入这三天的 310 原表。工序顺序表可以对照。结果格是算好的数值。",
  ]);
  const calc = workbook.addWorksheet("计算");
  const calcHeader = ["投产单号", "第1天末行", "第2天末行", "第3天末行", "客户型号", "最新交期", "第1天最远", "第2天最远", "第3天最远", "第1天最近", "第2天最近", "第1天签名", "第2天签名", "第3天签名", "第1天工序", "第2天工序", "第3天工序", "推进1→2", "推进2→3", "三天合计", "段1→2", "段2→3", "状态", "距交期天数", "风险"];
  paintHeader(calc.addRow(calcHeader));
  rows.forEach((row) => {
    const values = Array(calcHeader.length).fill("");
    values[0] = row.po;
    values[4] = row.model;
    values[5] = asDate(row.due);
    values[14] = row.days[0];
    values[15] = row.days[1];
    values[16] = row.days[2];
    values[17] = row.advance12;
    values[18] = row.advance23;
    values[22] = row.status;
    values[23] = row.dueDays;
    values[24] = row.risk;
    calc.addRow(values);
  });
  freeze(calc, 1, 1, "B2");
  const jdDates = datesOf(records, "捷德").filter((item) => item <= date).slice(-3);
  ["第1天", "第2天", "第3天"].forEach((name, index) => writeJiedeMatrix(workbook.addWorksheet(name), latestFile(records, "捷德", jdDates[index], "310"), true));
  const order = workbook.addWorksheet("工序顺序");
  paintHeader(order.addRow(["工序名称", "顺序号（越大越靠后，可修改/增加）"]));
  STEP_ORDER.forEach((name, index) => order.addRow([name, index + 1]));
  widths(order, [18, 36]);
  const buffer = await workbook.xlsx.writeBuffer();
  return { filename: `捷德WIP三日进度对比_${date}.xlsx`, buffer };
}

function writeJiedeMatrix(ws, file, wideFreeze) {
  const matrix = (file && file.sheetMatrix) || [];
  matrix.forEach((source, rowIndex) => {
    const row = ws.getRow(rowIndex + 1);
    source.forEach((value, column) => {
      if (value !== "" && value != null) row.getCell(column + 1).value = value;
    });
  });
  if (!matrix.length) ws.getCell("A1").value = "这一天没有捷德 WIP";
  if (wideFreeze) freeze(ws, 6, 2, "G3");
  widths(ws, [18, 10, 18, 12, 16, 18, 14, 8, 12, 12, 12, 12, 12]);
}

let activeCatalogs = null;

function reportAt(records, date) {
  return buildReport(records, { asOf: date, catalogs: activeCatalogs });
}

export async function buildDailyWorkbook(records, date, kind, catalogs) {
  activeCatalogs = catalogs || null;
  try {
    if (kind === "benqiangCompare") return await benqiangCompare(records, date);
    if (kind === "benqiangMatch") return await benqiangMatch(records, date);
    if (kind === "jiedeMatch") return await jiedeMatchBook(records, date);
    if (kind === "jiedeTri") return await jiedeTriBook(records, date);
    return { error: "未知的表格类型" };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

export async function buildDailyZip(records, date, catalogs) {
  activeCatalogs = catalogs || null;
  const fflate = globalThis.fflate;
  if (!fflate) return { error: "打包组件未加载" };
  const kinds = ["benqiangCompare", "benqiangMatch", "jiedeMatch", "jiedeTri"];
  const files = {};
  const errors = [];
  for (const kind of kinds) {
    const result = await buildDailyWorkbook(records, date, kind, activeCatalogs);
    if (result.error) errors.push(result.error);
    else files[result.filename] = new Uint8Array(result.buffer);
  }
  if (!Object.keys(files).length) return { error: errors.join("；") };
  const zipped = fflate.zipSync(files);
  return { filename: `货期日报_${date}.zip`, buffer: zipped, errors };
}
