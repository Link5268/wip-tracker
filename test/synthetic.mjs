import assert from "node:assert/strict";
import { classifyPresence, sameStepSet, triStatus, triRisk, jiedeMatch, dateDiff, buildReport, compareFocus } from "../js/logic.js";
import { dailyStatus } from "../js/daily.js";
import { matchOrder, indexEntities, normKey, usableKey } from "../js/lenient.js";
import { compareBySequence, defaultCatalog, itemsFromSheetRows, normalizeOp } from "../js/processOrder.js";
import { parseBatch, searchOrders } from "../js/orderSearch.js";
import { buildBackup, readBackup } from "../js/backup.js";

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
assert.equal(continued.benqiang.bySource.Y100["工序推进"], 1);
assert.equal(continued.benqiang.bySource.Y100["今日新增"], 0);
assert.equal(continued.benqiang.bySource.Y100["已出WIP"], 0);
assert.equal(continued.backfill.rows, 2);
assert.equal(continued.backfill.byRule["回填客户料号"], 2);
assert.equal(continued.benqiang.rows[0].pn, "PN1");
assert.equal(continued.dailyStats.some((item) => item.supplier === "奔强" && item.date === "2026-11-12" && item.counts["工序推进"] === 1), true);
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

console.log("synthetic ok");
