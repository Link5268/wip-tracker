import { buildReport, compareFocus, dueBucket, MODEL_TYPES, ORDER_TYPES } from "./logic.js";
import { parseWorkbook } from "./parse.js";
import { buildFocusWorkbook, buildStatsWorkbook, workbookBytes } from "./export.js";
import { buildDailyWorkbook, buildDailyZip, dailyStatus } from "./daily.js";
import { listFiles, listStars, putStar, deleteStar, replaceStars, putFile, deleteFile, replaceAll, clearAll, sha256, starId } from "./db.js";

const app = document.querySelector("#app");
const saveState = document.querySelector("#save-state");
const confirmBox = document.querySelector("#confirm");

const state = {
  records: [],
  tab: "import",
  supplier: "全部",
  query: "",
  modelType: "全部",
  dueWithin: 3,
  dateFrom: "",
  dateTo: "",
  stars: new Set(),
  focusSupplier: "全部",
  focusQuery: "",
  log: [],
  busy: false,
};

const STATUS_CLASS = {
  工序推进: "st-go",
  无进度: "st-stop",
  已出WIP: "st-out",
  今日新增: "st-new",
  未在WIP: "st-miss",
  正常推进: "st-go",
  部分推进: "st-go",
  倒退: "st-stop",
  连续3天未动: "st-stop",
  近1天未动: "st-stop",
  已完成或消失: "st-out",
  消失后又出现: "st-new",
  无在制: "st-miss",
  高风险: "st-stop",
  关注: "st-stop",
  正常: "st-go",
  消失: "st-out",
};

init();

async function init() {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("on", item === button));
      render();
    });
  });
  state.records = await listFiles();
  state.stars = new Set((await listStars()).map((star) => star.id));
  render();
}

function render() {
  const focusId = document.activeElement && document.activeElement.id;
  const caret = document.activeElement && document.activeElement.selectionStart;
  const report = buildReport(state.records, { from: state.dateFrom, to: state.dateTo });
  saveState.textContent = state.records.length
    ? `本机已保存 ${state.records.length} 份表，最近对照日 ${report.asOf || "未识别"}`
    : "尚未导入";
  app.innerHTML = {
    import: () => viewImport(report),
    days: () => viewDays(report),
    models: () => viewModels(report),
    urgent: () => viewUrgent(report),
    focus: () => viewFocus(report),
    due: () => viewDue(report),
    backup: () => viewBackup(),
  }[state.tab]();
  bind();
  if (focusId) {
    const next = document.getElementById(focusId);
    if (next) {
      next.focus();
      if (typeof caret === "number" && next.setSelectionRange) {
        try { next.setSelectionRange(caret, caret); } catch { /* date inputs */ }
      }
    }
  }
}

function bind() {
  const drop = document.querySelector("#drop");
  const picker = document.querySelector("#picker");
  if (drop && picker) {
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("over");
      ingest(event.dataTransfer.files);
    });
    picker.addEventListener("change", () => {
      ingest(picker.files);
      picker.value = "";
    });
  }
  document.querySelectorAll("[data-date-for]").forEach((input) => {
    input.addEventListener("change", async () => {
      const record = state.records.find((item) => item.id === input.dataset.dateFor);
      if (!record || !input.value) return;
      record.date = input.value;
      record.dateSource = "manual";
      await putFile(record);
      render();
    });
  });
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteFile(button.dataset.remove);
      state.records = state.records.filter((item) => item.id !== button.dataset.remove);
      render();
    });
  });
  const search = document.querySelector("#q");
  if (search) search.addEventListener("input", () => { state.query = search.value; render(); });
  const supplier = document.querySelector("#supplier");
  if (supplier) supplier.addEventListener("change", () => { state.supplier = supplier.value; render(); });
  const modelType = document.querySelector("#model-type");
  if (modelType) modelType.addEventListener("change", () => { state.modelType = modelType.value; render(); });
  const dueWithin = document.querySelector("#due-within");
  if (dueWithin) dueWithin.addEventListener("change", () => {
    state.dueWithin = Number(dueWithin.value) || 0;
    render();
  });
  const dateFrom = document.querySelector("#date-from");
  const dateTo = document.querySelector("#date-to");
  if (dateFrom) dateFrom.addEventListener("change", () => { state.dateFrom = dateFrom.value; render(); });
  if (dateTo) dateTo.addEventListener("change", () => { state.dateTo = dateTo.value; render(); });
  const exportXlsx = document.querySelector("#export-xlsx");
  if (exportXlsx) exportXlsx.addEventListener("click", () => {
    const current = buildReport(state.records, { from: state.dateFrom, to: state.dateTo });
    downloadBook(buildStatsWorkbook(current, { supplier: state.supplier, withinDays: state.dueWithin }), `货期统计-${current.asOf || "全部"}.xlsx`);
  });
  const exportFocus = document.querySelector("#export-focus");
  if (exportFocus) exportFocus.addEventListener("click", () => {
    const current = buildReport(state.records, { from: state.dateFrom, to: state.dateTo });
    const rows = focusList(current);
    downloadBook(buildFocusWorkbook(rows, current.windowDates), `重点急件-${current.asOf || "全部"}.xlsx`);
  });
  const focusSupplier = document.querySelector("#focus-supplier");
  if (focusSupplier) focusSupplier.addEventListener("change", () => { state.focusSupplier = focusSupplier.value; render(); });
  const focusQuery = document.querySelector("#focus-q");
  if (focusQuery) focusQuery.addEventListener("input", () => { state.focusQuery = focusQuery.value; render(); });
  const dailyDate = document.querySelector("#daily-date");
  if (dailyDate) dailyDate.addEventListener("change", () => { state.dailyDate = dailyDate.value; render(); });
  document.querySelectorAll("[data-daily]").forEach((button) => {
    button.addEventListener("click", () => downloadDaily(button.dataset.daily));
  });
  const dailyAll = document.querySelector("#daily-all");
  if (dailyAll) dailyAll.addEventListener("click", () => downloadDaily("all"));
  document.querySelectorAll("[data-star]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.star;
      const cut = id.indexOf("|");
      if (state.stars.has(id)) {
        state.stars.delete(id);
        await deleteStar(id);
      } else {
        state.stars.add(id);
        await putStar({ id, supplier: id.slice(0, cut), prodNo: id.slice(cut + 1) });
      }
      render();
    });
  });
  const exportBtn = document.querySelector("#export");
  if (exportBtn) exportBtn.addEventListener("click", exportBackup);
  const importBackup = document.querySelector("#import-backup");
  if (importBackup) importBackup.addEventListener("change", () => {
    const file = importBackup.files[0];
    importBackup.value = "";
    importBackupFile(file);
  });
  const clearBtn = document.querySelector("#clear");
  if (clearBtn) clearBtn.addEventListener("click", async () => {
    const ok = await ask("清空本机数据", "这会删除浏览器里保存的 WIP 和订单，不影响已经下载的备份文件。");
    if (!ok) return;
    await clearAll();
    state.records = [];
    state.stars = new Set();
    state.log = [];
    render();
  });
}

async function ingest(fileList) {
  const files = [...fileList];
  if (!files.length || state.busy) return;
  state.busy = true;
  state.log = [{ kind: "info", text: `正在读取 ${files.length} 个文件…` }];
  render();
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseWorkbook(buffer, file.name);
      if (!parsed.records.length) {
        state.log.push({ kind: "bad", text: `${file.name}：没认出是捷德/奔强的 WIP 或伯仁订单表。` });
        continue;
      }
      const hash = await sha256(buffer);
      for (const record of parsed.records) {
        record.id = parsed.records.length > 1 ? `${hash}:${record.supplier}:${record.kind}:${record.subtype}:${record.sheetName}` : hash;
        record.importedAt = new Date().toISOString();
        await putFile(record);
        const label = record.kind === "order"
          ? `${record.supplier}订单 ${record.rowCount} 行`
          : `${record.supplier} WIP ${record.subtype || ""} ${record.rowCount} 行`;
        const dateNote = record.date ? record.date : "日期未识别，请手改";
        state.log.push({ kind: "info", text: `${file.name} → ${label}，日期 ${dateNote}（${sourceLabel(record.dateSource)}）` });
      }
    } catch (error) {
      state.log.push({ kind: "bad", text: `${file.name} 读取失败：${error.message || error}` });
    }
  }
  state.records = await listFiles();
  state.busy = false;
  render();
}

function sourceLabel(source) {
  return { created: "取自文件创建时间", filename: "取自文件名", fallback: "未能识别", manual: "手动修改" }[source] || source;
}

function viewImport(report) {
  const rows = state.records.map((record) => `
    <tr data-supplier="${esc(record.supplier)}" data-subtype="${esc(record.subtype || "")}" data-date="${esc(record.date || "")}" data-kind="${esc(record.kind)}">
      <td>${esc(record.filename)}</td>
      <td>${esc(record.supplier)}</td>
      <td>${record.kind === "order" ? "订单" : `WIP ${esc(record.subtype || "")}`}</td>
      <td>${record.rowCount}</td>
      <td><input data-date-for="${esc(record.id)}" type="date" value="${esc(record.date || "")}" aria-label="修改 ${esc(record.filename)} 的日期"></td>
      <td>${esc(sourceLabel(record.dateSource))}</td>
      <td><button type="button" data-remove="${esc(record.id)}">移除</button></td>
    </tr>`).join("");
  return `<div class="stack">
    <section class="drop" id="drop">
      <h2>把今天的原始表拖到这里</h2>
      <p>捷德 310 WIP、奔强 y099 / Y100、伯仁订单表，.xls 和 .xlsx 都可以。同一天的 y099 和 Y100 会合成一份奔强 WIP。</p>
      <label class="file-btn">选择文件<input id="picker" type="file" multiple accept=".xls,.xlsx,.xlsm,.xlsb,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    </section>
    <section class="card">
      <h2>导入结果</h2>
      <div class="log">${state.log.map((item) => `<div class="${item.kind === "bad" ? "bad" : ""}">${esc(item.text)}</div>`).join("") || `<p class="muted">还没有新的导入。</p>`}</div>
    </section>
    <section class="card">
      <h2>已保存的表 <span class="muted" data-testid="import-count">${state.records.length}</span></h2>
      <p class="help">日期默认用文件创建时间换算成北京时间。若两份表被标成同一天，改右边的日期后再看对比。数据不会上传。</p>
      <div class="table-wrap">${table(["文件", "供应商", "类型", "行数", "归属日期", "日期来源", ""], rows || `<tr><td colspan="7">还没有数据。</td></tr>`)}</div>
    </section>
    ${summaryCards(report)}
    ${dailyPanel(report)}
  </div>`;
}

function viewDays(report) {
  const rows = filteredOrders(report).map((row) => {
    const days = report.windowDates.map((date) => {
      const cell = row.dayCells[date] || { text: "—" };
      return `<td class="steps" title="${esc(cell.detail || "")}">${esc(cell.text || "—")}</td>`;
    }).join("");
    return `<tr class="${STATUS_CLASS[row.type] || ""}" data-urgent="${row.urgentFlag ? "1" : "0"}">
      <td>${starButton(row)}</td>
      <td>${tag(row.type)}</td>
      <td>${row.urgentFlag ? `<b class="urg">${esc(row.urgent)}</b>` : ""}</td>
      <td>${esc(row.supplier)}</td>
      <td>${esc(row.prodNo)}</td>
      <td>${esc(row.factoryCode)}</td>
      <td>${esc(row.custModel)}</td>
      <td>${esc(row.status)}</td>
      <td class="${row.dueDays != null && row.dueDays < 0 ? "late" : ""}">${esc(row.due)}</td>
      <td>${dueText(row.dueDays)}</td>
      <td>${esc(row.how)}</td>
      ${days}
    </tr>`;
  }).join("");
  const head = ["关注", "较上日", "加急", "供应商", "生产编号", "厂编", "客户型号", "订单状态", "外发交期", "距交期", "匹配", ...report.windowDates];
  return `<div class="stack">
    ${filters("按生产编号、厂编或客户型号搜索")}
    ${statsTable(report)}
    <section class="card">
      <h2>最近 ${report.windowDates.length || 0} 个有 WIP 的日期</h2>
      <p class="help">每个订单一行。工序按当天匹配到的型号去重后用「 + 」连接。较上日只和该供应商的上一份 WIP 比：工序集合相同是无进度（顺序不同也算），集合变了是工序推进。☆ 可以把非加急单标成「我关注的」。</p>
      <div class="legend">${ORDER_TYPES.map((type) => tag(type)).join("")}</div>
    </section>
    <div class="table-wrap">${table(head, rows || `<tr><td colspan="${head.length}">没有符合筛选的订单。</td></tr>`)}</div>
  </div>`;
}

function viewModels(report) {
  const modelRows = filteredModels(report).map((row) => `<tr class="${STATUS_CLASS[row.type] || ""}">
      <td>${tag(row.type)}</td>
      <td>${row.urgent ? `<b class="urg">${esc(row.urgent)}</b>` : ""}</td>
      <td>${esc(row.source)}</td>
      <td>${esc(row.sc)}</td>
      <td>${esc(row.pn)}</td>
      <td>${esc(row.cm)}</td>
      <td class="steps">${esc(row.prevText)}</td>
      <td class="steps">${esc(row.currText)}</td>
      <td>${row.prevRows || ""}</td>
      <td>${row.currRows || ""}</td>
      <td>${esc(row.prodNo)}</td>
      <td>${esc(row.due)}</td>
    </tr>`).join("");
  const jdRows = (report.jiede ? report.jiede.rows : []).filter((row) => {
    if (state.supplier === "奔强") return false;
    return hitQuery(row.po, row.model);
  }).map((row) => `<tr class="${STATUS_CLASS[row.status] || ""}">
      <td>${tag(row.risk)}</td>
      <td>${tag(row.status)}</td>
      <td>${esc(row.po)}</td>
      <td>${esc(row.model)}</td>
      <td class="${row.dueDays != null && row.dueDays < 0 ? "late" : ""}">${esc(row.due)} ${dueText(row.dueDays)}</td>
      ${row.days.map((text) => `<td class="steps">${esc(text)}</td>`).join("")}
    </tr>`).join("");
  return `<div class="stack">
    ${summaryCards(report)}
    ${filters("搜索生产型号、客户料号、投产单号")}
    <section class="card">
      <h2>奔强型号明细</h2>
      <p class="help">按「来源 + 生产型号 + 客户料号」汇总。同一型号多行工序去重后用「 + 」连接。无进度用底色标出。</p>
      <div class="table-wrap">${table(["变化", "加急", "来源", "生产型号", "客户料号", "客户型号", "上一日工序", "当日工序", "上行数", "当日行数", "订单生产编号", "外发交期"], modelRows || `<tr><td colspan="12">${report.benqiang ? "没有符合筛选的型号。" : "至少需要两天奔强 WIP。"}</td></tr>`)}</div>
    </section>
    <section class="card">
      <h2>捷德投产单（最近三天）</h2>
      <p class="help">规则与原来的三日对比表一致：用最远工序的顺序号看推进，三天工序数量完全一样才算未动。这里的「未动」比五日视图更严，数量变了也会算部分推进。</p>
      <div class="table-wrap">${table(["风险", "状态", "投产单号", "客户型号", "交期", ...(report.jiede ? report.jiede.dates : ["第1天", "第2天", "第3天"])], jdRows || `<tr><td colspan="8">${report.jiede ? "没有符合筛选的投产单。" : "至少需要三天捷德 WIP。"}</td></tr>`)}</div>
    </section>
  </div>`;
}

function viewUrgent(report) {
  const rows = report.orderRows.filter((row) => row.type === "无进度" && row.urgentFlag && supplierOk(row.supplier) && hitQuery(row.prodNo, row.factoryCode, row.custModel));
  const body = rows.map((row) => `<tr class="st-stop">
    <td>${starButton(row)}</td>
    <td class="urg">${esc(row.urgent)}</td>
    <td>${esc(row.supplier)}</td>
    <td>${esc(row.prodNo)}</td>
    <td>${esc(row.factoryCode)}</td>
    <td>${esc(row.custModel)}</td>
    <td>${esc(row.status)}</td>
    <td class="${row.dueDays != null && row.dueDays < 0 ? "late" : ""}">${esc(row.due)} ${dueText(row.dueDays)}</td>
    <td class="steps">${esc(row.wipText)}</td>
  </tr>`).join("");
  return `<div class="stack">
    ${filters("搜索加急单")}
    <section class="card">
      <h2>加急且无进度 <b data-testid="urgent-list-count">${rows.length}</b></h2>
      <p class="help">加急列是「加急」或以「急」开头，并且较上一份 WIP 工序集合没有变化。奔强订单里这一类是 <span data-testid="bq-order-urgent-stall">${report.orderUrgentStall}</span> 单。</p>
      <div class="table-wrap">${table(["关注", "加急", "供应商", "生产编号", "厂编", "客户型号", "状态", "外发交期", "当前工序"], body || `<tr><td colspan="9">当前没有加急且无进度的订单。</td></tr>`)}</div>
    </section>
  </div>`;
}

function viewDue(report) {
  const rows = report.orderRows.filter((row) => supplierOk(row.supplier) && hitQuery(row.prodNo, row.factoryCode, row.custModel) && dueBucket(row, state.dueWithin));
  rows.sort((a, b) => a.dueDays - b.dueDays);
  const body = rows.map((row) => `<tr>
    <td>${starButton(row)}</td>
    <td class="${row.dueDays < 0 ? "late" : ""}">${dueBucket(row, state.dueWithin)}</td>
    <td>${esc(row.supplier)}</td>
    <td>${row.urgentFlag ? `<b class="urg">${esc(row.urgent)}</b>` : ""}</td>
    <td>${esc(row.prodNo)}</td>
    <td>${esc(row.factoryCode)}</td>
    <td>${esc(row.custModel)}</td>
    <td>${esc(row.status)}</td>
    <td>${tag(row.type)}</td>
    <td class="${row.dueDays < 0 ? "late" : ""}">${esc(row.due)}</td>
    <td>${dueText(row.dueDays)}</td>
  </tr>`).join("");
  return `<div class="stack">
    ${filters("搜索临近或逾期订单")}
    <section class="card">
      <div class="filters">
        <label class="field">临近天数<input id="due-within" type="number" min="0" max="60" value="${state.dueWithin}"></label>
        <p class="help">列出外发交期已逾期，或 ${state.dueWithin} 天内到期、且还没出库的订单。天数相对最近一份 WIP 的日期${report.asOf ? `（${esc(report.asOf)}）` : ""}。</p>
      </div>
      <div class="table-wrap">${table(["关注", "预警", "供应商", "加急", "生产编号", "厂编", "客户型号", "状态", "较上日", "外发交期", "距交期"], body || `<tr><td colspan="11">没有临近或逾期的在跟订单。</td></tr>`)}</div>
    </section>
  </div>`;
}

function viewFocus(report) {
  const rows = focusList(report);
  const body = rows.map((row) => {
    const days = report.windowDates.map((date) => `<td class="steps">${esc((row.dayCells[date] && row.dayCells[date].text) || "—")}</td>`).join("");
    return `<tr class="${STATUS_CLASS[row.type] || ""}" data-type="${esc(row.type)}" data-due="${row.dueDays == null ? "" : row.dueDays}" data-starred="${row.starred ? "1" : "0"}" data-urgent="${row.urgentFlag ? "1" : "0"}">
      <td>${starButton(row)}</td>
      <td>${row.urgentFlag ? `<b class="urg">${esc(row.urgent)}</b>` : (row.starred ? "我关注的" : "")}</td>
      <td>${tag(row.type)}</td>
      <td>${esc(row.supplier)}</td>
      <td>${esc(row.prodNo)}</td>
      <td>${esc(row.factoryCode)}</td>
      <td>${esc(row.custModel)}</td>
      <td>${row.stallDays}</td>
      <td class="${row.dueDays != null && row.dueDays < 0 ? "late" : ""}">${esc(row.due)} ${dueText(row.dueDays)}</td>
      ${days}
    </tr>`;
  }).join("");
  const head = ["关注", "来源", "较上日", "供应商", "生产编号", "厂编", "客户型号", "连续无进度", "外发交期", ...report.windowDates];
  return `<div class="stack">
    <section class="card filters">
      <label class="field">供应商
        <select id="focus-supplier">
          ${["全部", "奔强", "捷德"].map((item) => `<option ${item === state.focusSupplier ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </label>
      <label class="field">搜索
        <input id="focus-q" type="search" placeholder="生产编号 / 厂编 / 客户型号" value="${esc(state.focusQuery)}">
      </label>
      <label class="field">从<input id="date-from" type="date" value="${esc(state.dateFrom)}"></label>
      <label class="field">到<input id="date-to" type="date" value="${esc(state.dateTo)}"></label>
      <button type="button" id="export-focus">导出急件 Excel</button>
      <p class="muted">只列出伯仁订单里标了加急的，以及你打了星的「我关注的」。星只存在这台电脑，并会写进 JSON 备份。</p>
    </section>
    <section class="card">
      <h2>重点急件 <b data-testid="focus-count">${rows.length}</b></h2>
      <p class="help">默认把无进度放在前面，同一组里交期越近越靠前。连续无进度是从最近一天往回数，有几天和前一天工序集合完全一样。</p>
      <div class="table-wrap">${table(head, body || `<tr><td colspan="${head.length}">没有急件或关注的订单。</td></tr>`)}</div>
    </section>
  </div>`;
}

function focusList(report) {
  const query = state.focusQuery.trim().toLowerCase();
  return report.orderRows.filter((row) => {
    const starred = state.stars.has(starId(row.supplier, row.prodNo));
    if (!row.urgentFlag && !starred) return false;
    if (state.focusSupplier !== "全部" && row.supplier !== state.focusSupplier) return false;
    if (!query) return true;
    return [row.prodNo, row.factoryCode, row.custModel].some((part) => String(part || "").toLowerCase().includes(query));
  }).map((row) => ({ ...row, starred: state.stars.has(starId(row.supplier, row.prodNo)) })).sort(compareFocus);
}

function viewBackup() {
  return `<div class="stack">
    <section class="card stack">
      <h2>换电脑时带走数据</h2>
      <p class="help">备份是一个 JSON 文件，里面是已经解析好的 WIP 和订单。把它拷到另一台电脑，在这里导入即可。不要把这个文件提交到公开仓库。</p>
      <div class="row-actions">
        <button type="button" id="export">下载备份</button>
        <label class="file-btn">导入备份<input id="import-backup" type="file" accept="application/json,.json"></label>
        <button type="button" id="clear" class="danger">清空本机数据</button>
      </div>
    </section>
    <section class="card help">
      <h2>每天建议这样用</h2>
      <ol>
        <li>把供应商当天的 WIP，以及伯仁导出的订单表，拖进「导入」。</li>
        <li>核对每份表的日期。同一天的奔强 y099 和 Y100 会自动合并。</li>
        <li>先看「型号对比」顶部的数字，再打开「五日进度」。</li>
        <li>重点看「加急无进度」和「交期预警」。</li>
        <li>换电脑前到「备份」下载 JSON。</li>
      </ol>
    </section>
  </div>`;
}

function summaryCards(report) {
  if (!state.records.length) {
    return `<section class="card"><p class="help">导入捷德、奔强的 WIP 和伯仁订单后，这里会列出奔强两日对比和捷德三日状态。</p></section>`;
  }
  const bq = report.benqiang;
  const cell = (counts, source, type) => {
    if (!counts) return "—";
    return counts[type] ?? 0;
  };
  const src = (name) => (bq ? bq.bySource[name] : null);
  const jd = report.jiede;
  const st = (key) => (jd && jd.statusCounts[key]) || 0;
  const risk = (key) => (jd && jd.riskCounts[key]) || 0;
  const match = report.jdMatch ? report.jdMatch.counts : null;
  return `<section class="card stack" id="summary">
    <h2>奔强型号两日对比</h2>
    <p class="help">${bq ? `上一日 <span data-testid="bq-prev-date">${esc(bq.prev)}</span> → 当日 <span data-testid="bq-curr-date">${esc(bq.curr)}</span>。行数 y099 <span data-testid="bq-rows-y099">${bq.prevRows.y099 || 0}→${bq.currRows.y099 || 0}</span>，Y100 <span data-testid="bq-rows-y100">${bq.prevRows.Y100 || 0}→${bq.currRows.Y100 || 0}</span>。` : "导入至少两天奔强 WIP 后，这里会出 y099 / Y100 的推进和无进度。"}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>变化</th><th>y099</th><th>Y100</th><th>合计</th></tr></thead>
      <tbody>
        ${["工序推进", "无进度", "已出WIP", "今日新增"].map((type) => {
          const id = { 工序推进: "advance", 无进度: "stall", 已出WIP: "out", 今日新增: "new" }[type];
          return `<tr class="${STATUS_CLASS[type] || ""}"><td>${tag(type)}</td>
            <td data-testid="bq-y099-${id}">${cell(src("y099"), "y099", type)}</td>
            <td data-testid="bq-y100-${id}">${cell(src("Y100"), "Y100", type)}</td>
            <td data-testid="bq-all-${id}">${cell(bq && bq.counts, "all", type)}</td></tr>`;
        }).join("")}
        <tr><td>合计</td>
          <td data-testid="bq-y099-total">${src("y099") ? src("y099").total : "—"}</td>
          <td data-testid="bq-y100-total">${src("Y100") ? src("Y100").total : "—"}</td>
          <td data-testid="bq-all-models">${bq ? bq.counts.total : "—"}</td></tr>
      </tbody>
    </table></div>
    <p class="help">缺少客户料号时，按以前各天的「生产型号 → 客户料号」回填，比较用的键不变。本日回填并参与匹配的有 <b data-testid="bq-backfill-rows">${report.backfill.rows}</b> 行、<b data-testid="bq-backfill-models">${report.backfill.models}</b> 个型号<span data-testid="bq-backfill-rules">${backfillRules(report.backfill)}</span>。型号上挂到加急、并且无进度的有 <b data-testid="bq-model-urgent-stall">${bq ? bq.urgentStall : "—"}</b> 个。加急且无进度的奔强订单有 <b data-testid="bq-order-urgent-stall">${report.orderUrgentStall}</b> 单。订单逐单统计（生产编号+厂编，其次生产编号，再次厂编）：
      推进 <b data-testid="bq-order-advance">${report.orderCounts["工序推进"] || 0}</b>，
      无进度 <b data-testid="bq-order-stall">${report.orderCounts["无进度"] || 0}</b>，
      已出 <b data-testid="bq-order-out">${report.orderCounts["已出WIP"] || 0}</b>，
      新增 <b data-testid="bq-order-new">${report.orderCounts["今日新增"] || 0}</b>，
      未在WIP <b data-testid="bq-order-miss">${report.orderCounts["未在WIP"] || 0}</b>，
      订单 <b data-testid="bq-order-total">${report.bqOrderTotal}</b>。
    </p>
    <h2>捷德投产单三日状态</h2>
    <p class="help">${jd ? `三日为 <span data-testid="jd-date-1">${esc(jd.dates[0])}</span>、<span data-testid="jd-date-2">${esc(jd.dates[1])}</span>、<span data-testid="jd-date-3">${esc(jd.dates[2])}</span>，共 <span data-testid="jd-status-total">${jd.total}</span> 个投产单。` : "导入三天捷德 310 WIP 后，这里对照原来的三日进度表。"}</p>
    <div class="grid-4">
      ${stat("jd-status-advance", st("正常推进"), "正常推进", "go")}
      ${stat("jd-status-partial", st("部分推进"), "部分推进", "go")}
      ${stat("jd-status-stall1", st("近1天未动"), "近1天未动", "stop")}
      ${stat("jd-status-stall3", st("连续3天未动"), "连续3天未动", "stop")}
      ${stat("jd-status-back", st("倒退"), "倒退", "stop")}
      ${stat("jd-status-new", st("新增"), "新增")}
      ${stat("jd-status-re", st("消失后又出现"), "消失后又出现")}
      ${stat("jd-status-done", st("已完成或消失"), "已完成或消失")}
      ${stat("jd-status-none", st("无在制"), "无在制")}
      ${stat("jd-risk-high", risk("高风险"), "高风险", "stop")}
      ${stat("jd-risk-watch", risk("关注"), "关注", "stop")}
      ${stat("jd-risk-ok", risk("正常"), "风险里的正常", "go")}
    </div>
    <p class="help">订单对照最近一天捷德 WIP${report.jdMatch ? `（${esc(report.jdMatch.date)}）` : ""}：
      数量匹配 <b data-testid="jd-match-qty">${match ? match["数量"] || 0 : "—"}</b>，
      仅型号 <b data-testid="jd-match-model">${match ? match["型号"] || 0 : "—"}</b>，
      无在制 <b data-testid="jd-match-none">${match ? match["无在制"] || 0 : "—"}</b>，
      未匹配 <b data-testid="jd-match-miss">${match ? match["未匹配"] || 0 : "—"}</b>，
      订单 <b data-testid="jd-match-total">${match ? match.total : "—"}</b>。
      风险计数另有新增 <span data-testid="jd-risk-new">${risk("新增")}</span>、
      消失 <span data-testid="jd-risk-gone">${risk("消失")}</span>、
      无在制 <span data-testid="jd-risk-none">${risk("无在制")}</span>。
    </p>
  </section>`;
}

function backfillRules(backfill) {
  const parts = Object.entries(backfill.byRule || {});
  if (!parts.length) return "";
  return `（${parts.map(([rule, count]) => `${rule} ${count} 行`).join("，")}）`;
}

function stat(testid, value, label, tone) {
  return `<div class="stat ${tone || ""}"><b data-testid="${testid}">${value}</b><span>${esc(label)}</span></div>`;
}

function dailyPanel(report) {
  const date = state.dailyDate || report.asOf || "";
  const status = dailyStatus(state.records, date);
  const buttons = [
    ["benqiangCompare", "奔强两日进度对比", status.benqiangCompare],
    ["benqiangMatch", "奔强订单 WIP 匹配", status.benqiangMatch],
    ["jiedeMatch", "捷德订单 WIP 匹配", status.jiedeMatch],
    ["jiedeTri", "捷德三日进度对比", status.jiedeTri],
  ];
  return `<section class="card stack">
    <h2>生成日报表格</h2>
    <p class="help">按所选日期生成本来手工做的四份工作簿，列、冻结和进度底色与原来的模板一致。文件在本机生成，不会上传。缺数据时会说明缺哪一天，不会中断页面。</p>
    <div class="filters">
      <label class="field">日期<input id="daily-date" type="date" value="${esc(date)}"></label>
      <button type="button" id="daily-all" ${date ? "" : "disabled"}>下载全部</button>
    </div>
    <div class="row-actions">
      ${buttons.map(([kind, label, missing]) => `<button type="button" data-daily="${kind}" ${missing ? "disabled" : ""}>${label}</button>`).join("")}
    </div>
    <div class="log">${buttons.filter((item) => item[2]).map((item) => `<div class="bad">${esc(item[1])}：${esc(item[2])}</div>`).join("") || `<div>四份表都可以生成。</div>`}</div>
  </section>`;
}

function statsTable(report) {
  const rows = report.dailyStats.filter((item) => supplierOk(item.supplier));
  const body = rows.map((item) => `<tr data-stat-supplier="${esc(item.supplier)}" data-stat-date="${esc(item.date)}">
    <td>${esc(item.supplier)}</td>
    <td>${esc(item.date)}</td>
    ${ORDER_TYPES.map((type) => `<td data-count="${type}">${item.counts[type] || 0}</td><td data-urgent-count="${type}">${item.urgent[type] || 0}</td>`).join("")}
  </tr>`).join("");
  const head = ["供应商", "日期", ...ORDER_TYPES.flatMap((type) => [type, `${type}·加急`])];
  return `<section class="card">
    <h2>汇总统计</h2>
    <p class="help">按供应商、按日期统计订单较上一日的变化，并单列其中加急。导出 Excel 用的就是这份数，并跟着上面的供应商和日期范围走。</p>
    <div class="table-wrap">${table(head, body || `<tr><td colspan="${head.length}">这个范围内没有 WIP。</td></tr>`)}</div>
  </section>`;
}

function starButton(row) {
  const id = starId(row.supplier, row.prodNo);
  const on = state.stars.has(id);
  return `<button type="button" class="star" data-star="${esc(id)}" aria-pressed="${on ? "true" : "false"}" aria-label="我关注的">${on ? "★" : "☆"}</button>`;
}

function filters(placeholder) {
  return `<section class="card filters">
    <label class="field">供应商
      <select id="supplier">
        ${["全部", "奔强", "捷德"].map((item) => `<option ${item === state.supplier ? "selected" : ""}>${item}</option>`).join("")}
      </select>
    </label>
    <label class="field">从<input id="date-from" type="date" value="${esc(state.dateFrom)}"></label>
    <label class="field">到<input id="date-to" type="date" value="${esc(state.dateTo)}"></label>
    <label class="field">搜索
      <input id="q" type="search" placeholder="${esc(placeholder)}" value="${esc(state.query)}">
    </label>
    <label class="field">变化类型
      <select id="model-type">
        ${["全部", ...MODEL_TYPES, ...ORDER_TYPES.filter((type) => type === "未在WIP")].map((item) => `<option ${item === state.modelType ? "selected" : ""}>${item}</option>`).join("")}
      </select>
    </label>
    <button type="button" id="export-xlsx">导出 Excel</button>
    <p class="muted">型号对比顶部的两日/三日数字始终按全部日期。导出和这张汇总表跟随供应商与日期范围。</p>
  </section>`;
}

function filteredOrders(report) {
  return report.orderRows.filter((row) => supplierOk(row.supplier) && typeOk(row.type) && hitQuery(row.prodNo, row.factoryCode, row.custModel));
}

function filteredModels(report) {
  if (!report.benqiang || state.supplier === "捷德") return [];
  return report.benqiang.rows.filter((row) => {
    if (state.supplier === "奔强" || state.supplier === "全部") {
      return typeOk(row.type) && hitQuery(row.sc, row.pn, row.cm, row.prodNo);
    }
    return false;
  });
}

function supplierOk(supplier) {
  return state.supplier === "全部" || state.supplier === supplier;
}

function typeOk(type) {
  return state.modelType === "全部" || state.modelType === type;
}

function hitQuery(...parts) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return parts.some((part) => String(part || "").toLowerCase().includes(query));
}

function tag(type) {
  return `<span class="tag ${STATUS_CLASS[type] || ""}">${esc(type)}</span>`;
}

function dueText(days) {
  if (days == null) return "";
  if (days < 0) return `<b class="late">逾期 ${-days} 天</b>`;
  if (days === 0) return `<b class="late">今天到期</b>`;
  return `剩 ${days} 天`;
}

function table(headers, body) {
  return `<table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function downloadDaily(kind) {
  const date = state.dailyDate || buildReport(state.records).asOf;
  if (!date) return;
  const result = kind === "all"
    ? await buildDailyZip(state.records, date)
    : await buildDailyWorkbook(state.records, date, kind);
  if (result.error && !result.buffer) {
    state.log.push({ kind: "bad", text: result.error });
    state.tab = "import";
    render();
    return;
  }
  const mime = kind === "all"
    ? "application/zip"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  downloadBytes(result.buffer, result.filename, mime);
  if (result.errors && result.errors.length) {
    state.log.push({ kind: "info", text: `已下载能生成的表格。未生成：${result.errors.join("；")}` });
    render();
  }
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function downloadBook(book, filename) {
  const bytes = workbookBytes(book);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportBackup() {
  const payload = {
    app: "hx-wip-tracker",
    version: 2,
    exportedAt: new Date().toISOString(),
    files: state.records,
    stars: [...state.stars].map((id) => {
      const cut = id.indexOf("|");
      return { id, supplier: id.slice(0, cut), prodNo: id.slice(cut + 1) };
    }),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `货期跟踪备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || payload.app !== "hx-wip-tracker" || !Array.isArray(payload.files)) {
      throw new Error("不是本工具导出的备份");
    }
    const ok = await ask("导入备份", `备份里有 ${payload.files.length} 份表，将替换这台电脑上现有的货期数据。`);
    if (!ok) return;
    const files = payload.files.filter((item) => item && item.id && item.supplier && item.kind);
    const stars = Array.isArray(payload.stars) ? payload.stars.filter((item) => item && item.supplier && item.prodNo).map((item) => ({
      id: starId(item.supplier, item.prodNo),
      supplier: item.supplier,
      prodNo: item.prodNo,
    })) : [];
    await replaceAll(files);
    await replaceStars(stars);
    state.records = await listFiles();
    state.stars = new Set(stars.map((item) => item.id));
    state.log = [{ kind: "info", text: `已从备份恢复 ${files.length} 份表。` }];
    state.tab = "import";
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("on", item.dataset.tab === "import"));
    render();
  } catch (error) {
    state.log = [{ kind: "bad", text: `备份导入失败：${error.message || error}` }];
    state.tab = "import";
    render();
  }
}

function ask(title, text) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-text").textContent = text;
  confirmBox.showModal();
  return new Promise((resolve) => {
    confirmBox.addEventListener("close", () => resolve(confirmBox.returnValue === "ok"), { once: true });
  });
}
