import assert from "node:assert/strict";
import { classifyPresence, sameStepSet, triStatus, triRisk, jiedeMatch, dateDiff, buildReport, compareFocus } from "../js/logic.js";

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

console.log("synthetic ok");
