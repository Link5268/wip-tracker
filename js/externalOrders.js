import { jiedeMatch, dateDiff, sameStepSet } from './logic.js';
import { compareBySequence, catalogsFrom } from './processOrder.js';

function key(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').split('(')[0].toUpperCase(); }
function latest(records) { return [...records].sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.importedAt || '').localeCompare(String(b.importedAt || ''))).pop(); }

// An absent snapshot is not evidence that production stopped or ended.
export function threeDayStatus(dayCells, dates) {
  const window = (dates || []).slice(-3);
  const cells = window.map(d => dayCells[d]).filter(c => c && c.snapshot);
  if (!cells.length || !cells.some(c => c.present)) return '未匹配';
  if (cells.length < 2 || !cells.at(-1)?.present || !cells.at(-2)?.present) return '历史不足或未匹配';
  if (!sameStepSet(cells.at(-1).steps, cells.at(-2).steps)) return '记录有变化';
  if (cells.length >= 3 && cells.at(-3).present && sameStepSet(cells.at(-2).steps, cells.at(-3).steps)) return '连续3天记录相同';
  return '连续2天记录相同';
}

export function buildExternalReport(records, report, catalogs) {
  const external = latest(records.filter(r => r.kind === 'external-orders'));
  const system = latest(records.filter(r => r.kind === 'system-orders'));
  const byDate = new Map();
  for (const file of records.filter(r => r.kind === 'wip' && r.supplier === '捷德' && r.date && (!report.rangeFrom || r.date >= report.rangeFrom) && (!report.rangeTo || r.date <= report.rangeTo))) {
    const previous = byDate.get(file.date);
    if (!previous || String(file.importedAt || '') >= String(previous.importedAt || '')) byDate.set(file.date, file);
  }
  const dates = [...byDate.keys()].sort().slice(-5);
  const catalog = catalogsFrom(catalogs)['捷德'];
  const rows = (external?.orders || []).map(order => {
    let match = '', detail = '', change = '未在WIP', internal = [], dayCells = {}, supplierDates = [], wipSupplier = '';
    if (order.supplierName.includes('环祥')) {
      const candidates = (system?.orders || []).filter(o => key(o.custModel) && key(o.custModel) === key(order.model));
      const quantity = candidates.filter(o => String(o.orderQty || o.outQty) === String(order.outQty));
      const chosen = quantity.length ? quantity : candidates;
      internal = chosen;
      match = !system ? '缺少环祥订单表' : !chosen.length ? '未匹配环祥订单' : chosen.length > 1 ? '同型号多单，待核对' : quantity.length ? '型号+数量候选' : '型号候选，数量待核';
      detail = chosen.map(o => `${o.prodNo} ${o.status || ''} ${o.supplierName || ''}`).join(' / ');
      const linked = chosen.map(o => (report.orderRows || []).filter(r => r.prodNo === o.prodNo && key(r.custModel) === key(o.custModel) && r.outQty === o.outQty)).flat();
      if (linked.length === 1 && chosen.length === 1) {
        const original = linked[0];
        change = original.type; dayCells = original.dayCells; supplierDates = original.supplierDates; wipSupplier = original.supplier;
        detail += `；${original.wipText || '暂无可用WIP进度'}`;
      } else if (chosen.length) detail += '；未能唯一关联WIP，待核对';
    } else if (order.supplierName.includes('捷德')) {
      supplierDates = dates; wipSupplier = '捷德';
      const matches = dates.map(date => ({date, ...jiedeMatch({custModel: order.model, outQty: order.outQty}, byDate.get(date).batches || [])}));
      for (const m of matches) dayCells[m.date] = {text:m.text || '未匹配', detail:m.text || '', present:m.present, snapshot:true, steps:m.steps || [], seqLabel:'', pos:m.pos || []};
      const current = matches.at(-1), previous = matches.at(-2);
      match = !current ? '缺少捷德WIP' : current.how === '未匹配' ? '未匹配WIP' : current.how === '数量' ? '型号+数量候选' : current.how === '无在制' ? '型号候选，无在制数' : '型号候选，数量待核';
      detail = current?.text || '';
      if (previous && current) change = compareBySequence(previous.steps, current.steps, previous.present, current.present, catalog);
      else if (current?.present) change = '历史不足';
    } else { match = '未支持的外发供应商'; }
    const days = supplierDates.slice(-3).map(date => ({date, text:dayCells[date]?.text || '未匹配'}));
    const dueDays = dateDiff(order.due, report.asOf || '');
    return {...order, match, detail, change, internal, days, dayCells, supplierDates, wipSupplier, dueDays, threeDay:threeDayStatus(dayCells, supplierDates)};
  });
  return {external, system, rows};
}

export function externalOrderRows(records, report, catalogs) {
  return buildExternalReport(records, report, catalogs).rows.map(r => ({
    supplier:r.supplierName, customer:'奔强', orderSource:'奔强外发', batch:r.batch,
    trackId:`奔强外发|${r.supplierName}|${r.model}|${r.batch}`, prodNo:r.model, custModel:r.model,
    factoryCode:'', status:'', due:r.due, dueDays:r.dueDays, orderDate:r.orderDate, outQty:r.outQty,
    orderQty:r.outQty, recovered:r.recovered, shortage:r.shortage, unit:r.unit, urgent:'', urgentFlag:false,
    type:r.change, how:r.match, matchDetail:r.detail, wipText:r.detail, dayCells:r.dayCells,
    supplierDates:r.supplierDates, wipSupplier:r.wipSupplier, threeDay:r.threeDay,
    stallDays:0, seqLabel:'', po:'', wipSc:'', wipPn:'', wipPo:'', wipQty:'', productNo:'',
  }));
}
