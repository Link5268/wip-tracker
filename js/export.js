import { ORDER_TYPES, dueBucket } from "./logic.js";

function textWidth(value) {
  const text = value == null ? "" : String(value);
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) > 255 ? 2 : 1;
  return width;
}

function applySheet(rows) {
  const XLSX = globalThis.XLSX;
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const widths = [];
  rows.forEach((row) => {
    row.forEach((cell, index) => {
      widths[index] = Math.min(42, Math.max(widths[index] || 10, textWidth(cell) + 2));
    });
  });
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  sheet["!autofilter"] = { ref: sheet["!ref"] };
  return sheet;
}

function dueLabel(days) {
  if (days == null) return "";
  if (days < 0) return `逾期 ${-days} 天`;
  if (days === 0) return "今天到期";
  return `剩 ${days} 天`;
}

function orderLine(row, dates) {
  return [
    row.type,
    row.urgent || "",
    row.supplier,
    row.prodNo,
    row.factoryCode,
    row.custModel,
    row.status,
    row.due,
    dueLabel(row.dueDays),
    row.how,
    row.stallDays,
    ...dates.map((date) => (row.dayCells[date] && row.dayCells[date].text) || "—"),
  ];
}

const ORDER_HEAD = ["较上日", "加急", "供应商", "生产编号", "厂编", "客户型号", "订单状态", "外发交期", "距交期", "匹配", "连续无进度天数"];

export function buildStatsWorkbook(report, { supplier = "全部", withinDays = 3 } = {}) {
  const XLSX = globalThis.XLSX;
  const keep = (row) => supplier === "全部" || row.supplier === supplier;
  const stats = report.dailyStats.filter(keep);
  const orders = report.orderRows.filter(keep);
  const dates = report.windowDates;
  const summary = [["供应商", "日期", "变化", "订单数", "其中加急"]];
  for (const item of stats) {
    for (const type of ORDER_TYPES) {
      summary.push([item.supplier, item.date, type, item.counts[type] || 0, item.urgent[type] || 0]);
    }
  }
  const detail = [[...ORDER_HEAD, ...dates]];
  orders.forEach((row) => detail.push(orderLine(row, dates)));
  const stalled = [["加急", "供应商", "生产编号", "厂编", "客户型号", "状态", "外发交期", "距交期", "当前工序", "连续无进度天数"]];
  orders.filter((row) => row.urgentFlag && row.type === "无进度").forEach((row) => {
    stalled.push([row.urgent, row.supplier, row.prodNo, row.factoryCode, row.custModel, row.status, row.due, dueLabel(row.dueDays), row.wipText, row.stallDays]);
  });
  const due = [["预警", "供应商", "加急", "生产编号", "厂编", "客户型号", "状态", "较上日", "外发交期", "距交期"]];
  orders.filter((row) => dueBucket(row, withinDays)).sort((a, b) => a.dueDays - b.dueDays).forEach((row) => {
    due.push([dueBucket(row, withinDays), row.supplier, row.urgent, row.prodNo, row.factoryCode, row.custModel, row.status, row.type, row.due, dueLabel(row.dueDays)]);
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, applySheet(summary), "汇总统计");
  XLSX.utils.book_append_sheet(book, applySheet(detail), "订单五日进度明细");
  XLSX.utils.book_append_sheet(book, applySheet(stalled), "加急且无进度");
  XLSX.utils.book_append_sheet(book, applySheet(due), "交期预警");
  return book;
}

export function buildFocusWorkbook(rows, dates) {
  const XLSX = globalThis.XLSX;
  const grid = [[...ORDER_HEAD, "我关注的", ...dates]];
  rows.forEach((row) => {
    grid.push([...orderLine(row, dates), row.starred ? "是" : ""]);
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, applySheet(grid), "重点急件进度");
  return book;
}

function withFrozenHeaders(bytes) {
  const fflate = globalThis.fflate;
  if (!fflate) return bytes;
  const files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const marker = "<sheetViews><sheetView workbookViewId=\"0\"/></sheetViews>";
  const frozen = "<sheetViews><sheetView tabSelected=\"1\" workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/><selection pane=\"bottomLeft\" activeCell=\"A2\" sqref=\"A2\"/></sheetView></sheetViews>";
  for (const name of Object.keys(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = fflate.strFromU8(files[name]);
    if (!xml.includes(marker) || xml.includes("ySplit=")) continue;
    files[name] = fflate.strToU8(xml.replace(marker, frozen));
  }
  return fflate.zipSync(files);
}

export function workbookBytes(book) {
  const raw = globalThis.XLSX.write(book, { bookType: "xlsx", type: "array", cellStyles: false });
  return withFrozenHeaders(raw);
}
