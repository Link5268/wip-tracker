import { jiedeMatch, dateDiff } from './logic.js';
import { compareBySequence, catalogsFrom } from './processOrder.js';

function key(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').split('(')[0].toUpperCase(); }
function latest(records) { return [...records].sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.importedAt || '').localeCompare(String(b.importedAt || ''))).pop(); }

export function buildExternalReport(records, report, catalogs) {
  const external = latest(records.filter(r => r.kind === 'external-orders'));
  const system = latest(records.filter(r => r.kind === 'system-orders'));
  const byDate = new Map();
  for (const file of records.filter(r => r.kind === 'wip' && r.supplier === '捷德' && r.date)) {
    const previous = byDate.get(file.date);
    if (!previous || String(file.importedAt || '') >= String(previous.importedAt || '')) byDate.set(file.date, file);
  }
  const dates = [...byDate.keys()].sort().slice(-5);
  const catalog = catalogsFrom(catalogs)['捷德'];
  const rows = (external?.orders || []).map(order => {
    let match = '', detail = '', change = '', internal = [], days = [];
    if (order.supplierName.includes('环祥')) {
      const candidates = (system?.orders || []).filter(o => key(o.custModel) && key(o.custModel) === key(order.model));
      const quantity = candidates.filter(o => String(o.orderQty || o.outQty) === String(order.outQty));
      const chosen = quantity.length ? quantity : candidates;
      internal = chosen;
      match = !system ? '缺少环祥订单表' : !chosen.length ? '未匹配环祥订单' : chosen.length > 1 ? '同型号多单，待核对' : quantity.length ? '型号+数量候选' : '型号候选，数量待核';
      detail = chosen.map(o => `${o.prodNo} ${o.status || ''} ${o.supplierName || ''}`).join(' / ');
      const linked = chosen.map(o => (report.orderRows || []).find(r => r.prodNo === o.prodNo && key(r.custModel) === key(o.custModel) && r.outQty === o.outQty)).filter(Boolean);
      if (linked.length === 1 && chosen.length === 1) {
        change = linked[0].type;
        detail += `；${linked[0].wipText || '暂无可用WIP进度'}`;
        days = (linked[0].supplierDates || []).map(date => ({date, text: linked[0].dayCells[date]?.text || '—'}));
      }
    } else if (order.supplierName.includes('捷德')) {
      const matches = dates.map(date => ({date, ...jiedeMatch({custModel: order.model, outQty: order.outQty}, byDate.get(date).batches || [])}));
      const current = matches.at(-1), previous = matches.at(-2);
      match = !current ? '缺少捷德WIP' : current.how === '未匹配' ? '未匹配WIP' : current.how === '数量' ? '型号+数量候选' : current.how === '无在制' ? '型号候选，无在制数' : '型号候选，数量待核';
      detail = current?.text || '';
      days = matches.map(m => ({date:m.date, text:m.text || '未匹配'}));
      if (previous && current) change = compareBySequence(previous.steps, current.steps, previous.present, current.present, catalog);
    } else { match = '未支持的外发供应商'; }
    const dueDays = dateDiff(order.due, report.asOf || '');
    return {...order, match, detail, change, internal, days, dueDays};
  });
  return {external, system, rows};
}
