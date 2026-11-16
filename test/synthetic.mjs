import assert from "node:assert/strict";
import { classifyPresence, compareByName, sameStepSet, triStatus, triRisk, jiedeMatch, dateDiff, buildReport, compareFocus } from "../js/logic.js";
import { dailyStatus } from "../js/daily.js";
import { matchOrder, indexEntities, normKey, usableKey } from "../js/lenient.js";
import { compareBySequence, defaultCatalog, itemsFromSheetRows, normalizeOp } from "../js/processOrder.js";
import { parseBatch, searchOrders } from "../js/orderSearch.js";
import { buildBackup, readBackup } from "../js/backup.js";
import { buildCombinedTables } from "../js/oneReport.js";

assert.equal(sameStepSet(["钻孔", "电镀"], ["电镀", "钻孔"]), true);
assert.equal(classifyPresence(["钻孔"], ["电镀", "钻孔"], true, true), "工序推进");
assert.equal(classifyPresence(["文字", "阻焊"], ["阻焊", "文字"], true, true), "无进度");
assert.equal(classifyPresence(["开料"], null, true, false), "已出WIP");
assert.equal(classifyPresence(null, ["开料"], false, true), "今日新增");
assert.equal(classifyPresence(null, null, false, false), "未在WIP");

const back = triStatus(
  { far: 20, near: 20, sig: "a" },
  { far: 8, near: 8, sig: "b" },
  { far: 8, near: 8, sig: "b" },
);
assert.equal(back.status, "倒退");
assert.equal(triRisk("倒退", 10, null, null), "高风险");
assert.equal(triRisk("近1天未动", 2, 0, 0), "高风险");
assert.equal(triRisk("近1天未动", 9, 0, 0), "关注");
assert.equal(triRisk("正常推进", -1, 4, 2), "高风险");

const matched = jiedeMatch(
  { custModel: "BOARD-A(备注)", outQty: "10" },
  [
    { modelKeyU: "BOARD-A", qty: "10", display: "开料 10", steps: ["开料"] },
    { modelKeyU: "BOARD-A", qty: "99", display: "文字 99", steps: ["文字"] },
  ],
);
assert.equal(matched.how, "数量");
assert.equal(matched.text, "捷德:开料 10");
assert.deepEqual(matched.steps, ["开料"]);

const missed = jiedeMatch({ custModel: "OTHER", outQty: "1" }, []);
assert.equal(missed.how, "未匹配");
assert.equal(dateDiff("2026-11-08", "2026-11-11"), -3);

const report = buildReport([
  {
    id: "a", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-01", importedAt: "1", rowCount: 1,
    models: [{ key: "y099|M1|P1", source: "y099", sc: "M1", pn: "P1", pnU: "P1", scU: "M1", cm: "cm", po: "", orderedAt: "", steps: ["工程"], rows: 1 }],
  },
  {
    id: "b", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-02", importedAt: "2", rowCount: 1,
    models: [{ key: "y099|M1|P1", source: "y099", sc: "M1", pn: "P1", pnU: "P1", scU: "M1", cm: "cm", po: "", orderedAt: "", steps: ["工程"], rows: 1 }],
  },
  {
    id: "o", supplier: "奔强", kind: "order", subtype: "", date: "2026-11-02", importedAt: "3",
    orders: [{ urgent: "加急", prodNo: "P1", factoryCode: "M1", custModel: "cm", status: "已外发", due: "2026-11-03", outQty: "1" }],
  },
]);
assert.equal(report.benqiang.counts["无进度"], 1);
assert.equal(report.orderUrgentStall, 1);
assert.equal(report.orderRows[0].how, "生产编号+厂编");
assert.equal(report.orderRows[0].dayCells["2026-11-02"].text, "工程");

const continued = buildReport([
  {
    id: "d1", supplier: "奔强", kind: "wip", subtype: "Y100", date: "2026-11-11", importedAt: "1", rowCount: 1,
    models: [{ key: "Y100|SC1|PN1", source: "Y100", sc: "SC1", pn: "PN1", pnU: "PN1", scU: "SC1", cm: "", po: "", orderedAt: "", steps: ["内层线路"], rows: 1, pnFrom: "sheet" }],
  },
  {
    id: "d2", supplier: "奔强", kind: "wip", subtype: "Y100", date: "2026-11-12", importedAt: "2", rowCount: 2,
    models: [{ key: "Y100|SC1|", source: "Y100", sc: "SC1", pn: "", pnU: "", scU: "SC1", cm: "", po: "", orderedAt: "", steps: ["棕化"], rows: 2, pnFrom: "missing" }],
  },
  {
    id: "ord", supplier: "奔强", kind: "order", subtype: "", date: "2026-11-12", importedAt: "3",
    orders: [{ urgent: "", prodNo: "PN1", factoryCode: "OTHER", custModel: "", status: "已外发", due: "2026-11-20", outQty: "1" }],
  },
]);
assert.equal(continued.benqiang.bySource.Y100["有变化"], 1);
assert.equal(continued.benqiang.bySource.Y100["工序推进"] || 0, 0);
assert.equal(continued.benqiang.rows[0].seqLabel, "");
assert.equal(continued.benqiang.rows[0].days.length, 3);
assert.equal(continued.benqiang.bySource.Y100["今日新增"], 0);
assert.equal(continued.benqiang.bySource.Y100["已出WIP"], 0);
assert.equal(continued.backfill.rows, 2);
assert.equal(continued.backfill.byRule["回填客户料号"], 2);
assert.equal(continued.benqiang.rows[0].pn, "PN1");
assert.equal(continued.dailyStats.some((item) => item.supplier === "奔强" && item.date === "2026-11-12" && item.counts["有变化"] === 1), true);
assert.equal(compareFocus({ type: "无进度", dueDays: 5, prodNo: "b" }, { type: "工序推进", dueDays: -1, prodNo: "a" }) < 0, true);
assert.equal(compareFocus({ type: "无进度", dueDays: 1, prodNo: "a" }, { type: "无进度", dueDays: 4, prodNo: "b" }) < 0, true);

const missing = dailyStatus([], "2026-11-11");
assert.equal(missing.benqiangCompare.includes("奔强 WIP"), true);
assert.equal(missing.jiedeTri.includes("3"), true);
assert.equal(normKey(" Ｙ099　abc "), "Y099ABC");
assert.equal(usableKey("P19"), "");
const entities = [
  { id: "a", pn: "PN10001", sc: "SCMODEL1", cm: "MODEL-A", po: "JKTC10001", productNo: "P10001", qty: "10" },
  { id: "b", pn: "PN10002", sc: "SCMODEL2", cm: "MODEL-A", po: "JKTC10002", productNo: "P10002", qty: "10" },
];
const indexed = indexEntities(entities);
const unique = matchOrder({ prodNo: "PN10001", factoryCode: "SCMODEL1", custModel: "MODEL-A", outQty: "10" }, indexed);
assert.equal(unique.basis, "生产编号+厂编");
assert.equal(unique.many, false);
const many = matchOrder({ prodNo: "ZZZZZZ", factoryCode: "", custModel: "MODEL-A", outQty: "" }, indexed);
assert.equal(many.many, true);
assert.equal(many.basis.includes("一对多"), true);

const bq = defaultCatalog("奔强");
const jd = defaultCatalog("捷德");
assert.equal(bq.total, 105);
assert.equal(jd.total, 60);
assert.equal(normalizeOp("成型|P"), "成型");
assert.equal(normalizeOp("终检二S"), "终检二");
assert.equal(normalizeOp(" 开料Ｐ "), "开料");
assert.equal(bq.lookup("三钻"), 34);
assert.equal(bq.lookup("开料"), 2);
assert.equal(bq.lookup("工程"), 0);
assert.equal(bq.lookup("仓库"), 999);
assert.equal(bq.lookup("外发"), null);
assert.equal(bq.lookup("PCBA"), null);
assert.equal(compareBySequence(["棕化"], ["层压"], true, true, bq), "工序推进");
assert.equal(compareBySequence(["层压"], ["棕化"], true, true, bq), "工序回退");
assert.equal(compareBySequence(["内层AOI", "内层线路"], ["内层线路", "内层AOI"], true, true, bq), "无进度");
assert.equal(compareBySequence(["工程"], ["开料"], true, true, bq), "工序推进");
assert.equal(compareBySequence(["终检"], ["仓库"], true, true, bq), "工序推进");
assert.equal(compareBySequence(["外发"], ["测试"], true, true, bq), "工序变化(顺序未知)");
assert.equal(compareByName(["层压", "开料"], ["开料", "层压"], true, true), "无进度");
assert.equal(compareByName(["开料"], ["工程"], true, true), "有变化");
assert.equal(compareByName(["开料"], null, true, false), "已出WIP");
assert.equal(compareBySequence(["开料"], null, true, false, bq), "已出WIP");
assert.equal(jd.lookup("*电测"), 57);
assert.deepEqual(itemsFromSheetRows([["工序名称", "顺序号"], ["钻孔", 8], ["钻孔", 3], ["文字", 9]]), [
  { name: "钻孔", seq: 3 },
  { name: "文字", seq: 9 },
]);

assert.deepEqual(parseBatch("A1, A2，A3\nA4\tA5  A6"), ["A1", "A2", "A3", "A4", "A5", "A6"]);
const sample = [
  { supplier: "奔强", prodNo: "PN10001", factoryCode: "SCMODEL1", custModel: "Board-A", po: "PO-9", wipSc: "SCMODEL1", wipPn: "PN10001", wipPo: "", urgentFlag: true, starred: false },
  { supplier: "捷德", prodNo: "PN20002", factoryCode: "SCMODEL2", custModel: "Other", po: "PO-1", wipSc: "", wipPn: "", wipPo: "JK10001", urgentFlag: false, starred: true },
];
assert.equal(searchOrders(sample, { query: "board-a", field: "客户型号" }).rows.length, 1);
assert.equal(searchOrders(sample, { query: "pn10001", field: "生产编号" }).rows[0].prodNo, "PN10001");
assert.equal(searchOrders(sample, { query: "scmodel1", field: "厂编" }).rows[0].prodNo, "PN10001");
assert.equal(searchOrders(sample, { query: "po-9", field: "客户PO" }).rows.length, 1);
assert.equal(searchOrders(sample, { query: "pn10001", field: "客户型号" }).rows.length, 0);
const batch = searchOrders(sample, { query: "PN10001，没有这单\nJK10001", field: "全部" });
assert.deepEqual(batch.rows.map((row) => row.prodNo), ["PN10001", "PN20002"]);
assert.deepEqual(batch.missed, ["没有这单"]);
assert.equal(searchOrders(sample, { query: "", kind: "加急" }).rows.length, 1);
assert.equal(searchOrders(sample, { query: "", kind: "我关注的" }).rows[0].prodNo, "PN20002");
assert.equal(searchOrders(sample, { query: "", kind: "全部订单" }).idle, true);

const packed = buildBackup({
  files: [{ id: "f", supplier: "奔强", kind: "order" }],
  stars: [{ id: "奔强|PN10001", supplier: "奔强", prodNo: "PN10001" }],
  notes: [{ id: "奔强|PN10001", supplier: "奔强", prodNo: "PN10001", note: "明天问交期" }],
  processOrders: [{ supplier: "奔强", items: [{ name: "开料", seq: 2 }] }],
  exportedAt: "2026-11-12T00:00:00.000Z",
});
const restored = readBackup(packed);
assert.equal(restored.notes[0].note, "明天问交期");
assert.equal(restored.stars[0].id, "奔强|PN10001");
assert.equal(restored.processOrders[0].items[0].seq, 2);
assert.equal(restored.files.length, 1);

const mixed = buildReport([
  {
    id: "w1", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-10", importedAt: "1", rowCount: 2,
    models: [
      { key: "y099|MATCH1|PNMATCH", source: "y099", sc: "MATCH1", pn: "PNMATCH", pnU: "PNMATCH", scU: "MATCH1", cm: "ORDER-MODEL", po: "PO-1", orderedAt: "2026-11-01", steps: ["开料"], rows: 1 },
      { key: "y099|LONE1|", source: "y099", sc: "LONE1", pn: "", pnU: "", scU: "LONE1", cm: "WIP-ONLY-MODEL", po: "PO-WIP", orderedAt: "2026-11-02", steps: ["工程"], rows: 1 },
    ],
  },
  {
    id: "w2", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-11", importedAt: "2", rowCount: 2,
    models: [
      { key: "y099|MATCH1|PNMATCH", source: "y099", sc: "MATCH1", pn: "PNMATCH", pnU: "PNMATCH", scU: "MATCH1", cm: "ORDER-MODEL", po: "PO-1", orderedAt: "2026-11-01", steps: ["层压"], rows: 1 },
      { key: "y099|LONE1|", source: "y099", sc: "LONE1", pn: "", pnU: "", scU: "LONE1", cm: "WIP-ONLY-MODEL", po: "PO-WIP", orderedAt: "2026-11-02", steps: ["开料"], rows: 1 },
    ],
  },
  {
    id: "o1", supplier: "奔强", kind: "order", subtype: "", date: "2026-11-11", importedAt: "3",
    orders: [{ urgent: "", prodNo: "PNMATCH", factoryCode: "OTHER-CODE", custModel: "ORDER-MODEL", po: "PO-1", status: "已外发", due: "2026-11-20", outQty: "8", orderQty: "8" }],
  },
  {
    id: "j1", supplier: "捷德", kind: "wip", subtype: "310", date: "2026-11-11", importedAt: "4", rowCount: 2,
    tickets: [
      { po: "JK-MATCH", model: "JD-ORDER", modelKey: "JD-ORDER", qty: "3", productNo: "P-1", orderDate: "2026-11-01", due: "2026-11-18", steps: ["开料"] },
      { po: "JK-LONE", model: "JD-WIP-ONLY", modelKey: "JD-WIP-ONLY", qty: "4", productNo: "P-2", orderDate: "2026-11-02", due: "2026-11-19", steps: ["钻孔"] },
    ],
    batches: [
      { po: "JK-MATCH", model: "JD-ORDER", modelKey: "JD-ORDER", modelKeyU: "JD-ORDER", qty: "3", productNo: "P-1", orderDate: "2026-11-01", due: "2026-11-18", display: "开料 3", steps: ["开料"] },
      { po: "JK-LONE", model: "JD-WIP-ONLY", modelKey: "JD-WIP-ONLY", modelKeyU: "JD-WIP-ONLY", qty: "4", productNo: "P-2", orderDate: "2026-11-02", due: "2026-11-19", display: "钻孔 4", steps: ["钻孔"] },
    ],
  },
  {
    id: "jo", supplier: "捷德", kind: "order", subtype: "", date: "2026-11-11", importedAt: "5",
    orders: [{ urgent: "", prodNo: "JDORDER1", factoryCode: "", custModel: "JD-ORDER", status: "已外发", due: "2026-11-18", outQty: "3" }],
  },
]);
const catalog = [...mixed.orderRows, ...mixed.wipOnly].map((row) => ({
  ...row,
  origin: row.wipOnly ? "仅WIP" : ((row.supplierDates || []).some((date) => row.dayCells[date] && row.dayCells[date].present) ? "订单+WIP" : "仅订单"),
  starred: false,
}));
assert.equal(mixed.wipOnly.length, 2);
assert.equal(mixed.wipOnly.find((row) => row.wipSc === "MATCH1"), undefined);
assert.equal(mixed.wipOnly.find((row) => row.wipPo === "JK-MATCH"), undefined);
const lone = mixed.wipOnly.find((row) => row.wipSc === "LONE1");
assert.equal(lone.trackId, "奔强|WIP|y099|LONE1|");
assert.equal(lone.origin, "仅WIP");
assert.equal(lone.type, "有变化");
assert.equal(lone.seqLabel, "");
assert.equal(lone.custModel, "WIP-ONLY-MODEL");
const jdLone = mixed.wipOnly.find((row) => row.wipPo === "JK-LONE");
assert.equal(jdLone.trackId, "捷德|WIP|310|JK-LONE");
assert.equal(jdLone.productNo, "P-2");
assert.equal(jdLone.seqLabel, "第8/60道");
assert.equal(searchOrders(catalog, { query: "LONE1", field: "生产型号" }).rows[0].trackId, lone.trackId);
assert.equal(searchOrders(catalog, { query: "lone1", field: "厂编" }).rows[0].origin, "仅WIP");
assert.equal(searchOrders(catalog, { query: "P-2", field: "产品编号" }).rows[0].wipPo, "JK-LONE");
const byModelNo = searchOrders(catalog, { query: "MATCH1", field: "生产型号" }).rows;
assert.equal(byModelNo.length, 1);
assert.equal(byModelNo[0].prodNo, "PNMATCH");
assert.equal(byModelNo[0].origin, "订单+WIP");
const byTicket = searchOrders(catalog, { query: "JK-MATCH", field: "投产单号" }).rows;
assert.equal(byTicket.length, 1);
assert.equal(byTicket[0].prodNo, "JDORDER1");
assert.equal(byTicket[0].origin, "订单+WIP");
const mixedBatch = searchOrders(catalog, { query: "PNMATCH，LONE1\nNOPE-404", field: "全部" });
assert.deepEqual(mixedBatch.rows.map((row) => row.origin).sort(), ["仅WIP", "订单+WIP"]);
assert.deepEqual(mixedBatch.missed, ["NOPE-404"]);
const kept = readBackup(buildBackup({
  files: [{ id: "f", supplier: "奔强", kind: "wip" }],
  stars: [{ id: "奔强|WIP|y099|LONE1|", supplier: "奔强", prodNo: "WIP|y099|LONE1|" }],
  notes: [{ id: "奔强|WIP|y099|LONE1|", supplier: "奔强", prodNo: "WIP|y099|LONE1|", note: "只在WIP" }],
  processOrders: [],
}));
assert.equal(kept.stars[0].id, "奔强|WIP|y099|LONE1|");
assert.equal(kept.notes[0].note, "只在WIP");

const three = buildReport([
  {
    id: "t1", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-01", importedAt: "1", rowCount: 1,
    models: [{ key: "y099|A|PA", source: "y099", sc: "A", pn: "PA", pnU: "PA", scU: "A", cm: "cm", po: "", orderedAt: "", steps: ["开料"], rows: 1 }],
  },
  {
    id: "t2", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-02", importedAt: "2", rowCount: 2,
    models: [
      { key: "y099|A|PA", source: "y099", sc: "A", pn: "PA", pnU: "PA", scU: "A", cm: "cm", po: "", orderedAt: "", steps: ["开料"], rows: 1 },
      { key: "y099|C|PC", source: "y099", sc: "C", pn: "PC", pnU: "PC", scU: "C", cm: "cm", po: "", orderedAt: "", steps: ["层压", "开料"], rows: 1 },
    ],
  },
  {
    id: "t3", supplier: "奔强", kind: "wip", subtype: "y099", date: "2026-11-03", importedAt: "3", rowCount: 2,
    models: [
      { key: "y099|A|PA", source: "y099", sc: "A", pn: "PA", pnU: "PA", scU: "A", cm: "cm", po: "", orderedAt: "", steps: ["棕化"], rows: 1 },
      { key: "y099|C|PC", source: "y099", sc: "C", pn: "PC", pnU: "PC", scU: "C", cm: "cm", po: "", orderedAt: "", steps: ["开料", "层压"], rows: 1 },
    ],
  },
], { catalogs: { 奔强: [{ name: "开料", seq: 99 }, { name: "棕化", seq: 1 }] } });
assert.deepEqual(three.benqiang.bySource.y099.dates, ["2026-11-01", "2026-11-02", "2026-11-03"]);
assert.equal(three.benqiang.rows.find((row) => row.sc === "A").type, "有变化");
assert.equal(three.benqiang.rows.find((row) => row.sc === "A").days[2].text, "棕化");
assert.equal(three.benqiang.rows.find((row) => row.sc === "C").type, "无进度");
assert.equal(three.benqiang.rows.find((row) => row.sc === "A").seqLabel, "");
const oldList = readBackup({
  app: "hx-wip-tracker",
  files: [],
  processOrders: [{ supplier: "奔强", items: [{ name: "开料", seq: 2 }] }],
});
assert.equal(oldList.processOrders[0].supplier, "奔强");
assert.equal(oldList.processOrders[0].items[0].seq, 2);

function dayFile(date, subtype, sc, pn, steps, importedAt) {
  const source = String(subtype).toUpperCase() === "Y100" ? "Y100" : "y099";
  return {
    id: `${subtype}|${date}|${importedAt}`,
    supplier: "奔强",
    kind: "wip",
    subtype,
    date,
    importedAt,
    rowCount: 10 + importedAt,
    models: [{
      key: `${subtype}|${sc}|${pn}`,
      source: subtype,
      sc,
      pn,
      pnU: pn,
      scU: sc,
      cm: "CM",
      po: "",
      orderedAt: "",
      steps,
      rows: 1,
    }],
  };
}
const four = buildReport([
  dayFile("2026-11-10", "Y099", "SC-A", "PN-A", ["开料"], "1"),
  dayFile("2026-11-11", "y099", "SC-A", "PN-A", ["开料"], "2"),
  dayFile("2026-11-12", "Y099", "SC-A", "PN-A", ["开料"], "3"),
  dayFile("2026-11-13", "y099", "SC-A", "PN-A", ["棕化"], "4"),
  dayFile("2026-11-10", "y100", "SC-B", "PN-B", ["内层线路"], "5"),
  dayFile("2026-11-11", "Y100", "SC-B", "PN-B", ["内层线路"], "6"),
  dayFile("2026-11-12", "y100", "SC-B", "PN-B", ["内层线路"], "7"),
  dayFile("2026-11-13", "Y100", "SC-B", "PN-B", ["内层线路"], "8"),
  {
    id: "ord-a", supplier: "奔强", kind: "order", subtype: "", date: "2026-11-13", importedAt: "9",
    orders: [{ urgent: "", prodNo: "PN-A", factoryCode: "SC-A", custModel: "CM", status: "已外发", due: "2026-11-20", outQty: "1" }],
  },
  ...["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((date, index) => ({
    id: `jd-${date}`, supplier: "捷德", kind: "wip", subtype: "310", date, importedAt: `j${index}`,
    tickets: [{ po: "JK1", model: "JD", modelKey: "JD", qty: "1", steps: ["开料"], far: 1, near: 1, nproc: 1, display: "开料 1", sig: "a" }],
    batches: [{ po: "JK1", model: "JD", modelKey: "JD", modelKeyU: "JD", qty: "1", display: "开料 1", steps: ["开料"] }],
  })),
]);
assert.deepEqual(four.benqiang.bySource.y099.dates, ["2026-11-11", "2026-11-12", "2026-11-13"]);
assert.deepEqual(four.benqiang.bySource.Y100.dates, ["2026-11-11", "2026-11-12", "2026-11-13"]);
const changed = four.benqiang.rows.find((row) => row.sc === "SC-A");
assert.equal(changed.type, "有变化");
assert.deepEqual(changed.days.map((day) => day.date), ["2026-11-11", "2026-11-12", "2026-11-13"]);
assert.equal(changed.days[0].text, "开料");
assert.equal(changed.days[2].text, "棕化");
assert.equal(four.benqiang.rows.find((row) => row.sc === "SC-B").type, "无进度");
assert.equal(four.benqiang.rows.some((row) => row.days[0].date === "2026-11-10"), false);
assert.deepEqual(four.orderRows.find((row) => row.prodNo === "PN-A").supplierDates, ["2026-11-11", "2026-11-12", "2026-11-13"]);
assert.deepEqual(four.jiede.dates, ["2026-11-11", "2026-11-12", "2026-11-13"]);
const tables = buildCombinedTables([
  dayFile("2026-11-10", "Y099", "SC-A", "PN-A", ["开料"], "1"),
  dayFile("2026-11-11", "y099", "SC-A", "PN-A", ["开料"], "2"),
  dayFile("2026-11-12", "Y099", "SC-A", "PN-A", ["开料"], "3"),
  dayFile("2026-11-13", "y099", "SC-A", "PN-A", ["棕化"], "4"),
  dayFile("2026-11-10", "y100", "SC-B", "PN-B", ["内层线路"], "5"),
  dayFile("2026-11-11", "Y100", "SC-B", "PN-B", ["内层线路"], "6"),
  dayFile("2026-11-12", "y100", "SC-B", "PN-B", ["内层线路"], "7"),
  dayFile("2026-11-13", "Y100", "SC-B", "PN-B", ["内层线路"], "8"),
], "2026-11-13");
assert.deepEqual(tables.windows.y099, ["2026-11-11", "2026-11-12", "2026-11-13"]);
assert.deepEqual(tables.windows.Y100, ["2026-11-11", "2026-11-12", "2026-11-13"]);
assert.equal(tables.progress.find((row) => row.source === "y099").type, "有变化");
assert.equal(tables.progress.find((row) => row.source === "y099").days[2].text, "棕化");
assert.equal(tables.progress.find((row) => row.source === "Y100").type, "无进度");
assert.deepEqual(tables.windows.捷德310, []);

console.log("synthetic ok");
