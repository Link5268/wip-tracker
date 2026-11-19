(function (root) {
  'use strict';
  const sources = ['310', 'b002', 'y099', 'y100'];
  const fields = ['prod', 'model', 'po', 'factory'];
  const asText = value => value == null ? '' : String(value).trim();
  const key = value => asText(value).normalize('NFKC').replace(/[\u200b\ufeff]/g, '').replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ').toUpperCase();
  const same = (a, b) => !!key(a) && key(a) === key(b);
  const groupKey = values => JSON.stringify(values.map(key));
  const stageText = job => !job ? '' : job.stages.join('/') || job.status || '';
  const sortedStages = job => [...job.stages].sort().join('\n') || job.status || '';
  const noFactory = value => /^P\d+$/.test(key(value));
  const b002Model = value => key(value).replace(/[\s_.-]+/g, '');
  const b002OutputModel = value => b002Model(key(value).replace(/[\s_.-]+OUT$/, ''));
  const quantity = value => Number(asText(value).replaceAll(',', '')) || 0;
  const serial = value => {
    if (typeof value === 'number') return value;
    const valueText = asText(value);
    if (/^\d+(?:\.\d+)?$/.test(valueText)) return Number(valueText);
    const date = valueText.replaceAll('/', '-').match(/^(\d{4})-(\d\d?)-(\d\d?)(?:[ T](\d\d?):(\d\d?)(?::(\d\d?))?)?$/);
    if (!date) return 0;
    const [, y, m, d, h = 0, min = 0, sec = 0] = date;
    return (Date.UTC(+y, +m - 1, +d, +h, +min, +sec) - Date.UTC(1899, 11, 30)) / 86400000;
  };
  const asPO = value => /^(等奔强资料|无|N\/A|-)$/.test(key(value)) ? '' : asText(value);
  const getRows = (lib, sheet) => lib.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true, range: 0 });

  function parseOrder(lib, bytes) {
    if (new Uint8Array(bytes)[0] !== 80 || new Uint8Array(bytes)[1] !== 75) throw new Error('订单总表需是标准 .xlsx，请在 WPS 另存为 .xlsx 后选择。');
    const workbook = lib.read(bytes, {type: 'array'});
    const sheet = workbook.Sheets['在线订单'];
    if (!sheet) throw new Error('订单总表中找不到「在线订单」工作表。');
    const records = getRows(lib, sheet);
    if (!records[0] || !same(records[0][1], '生产编号') || !same(records[0][6], '客户型号') || !same(records[0][7], '客户PO') || !same(records[0][22], '供应商厂编') || !/WIP|工序/.test(key(records[0][24]))) {
      throw new Error('在线订单的 B、G、H、W 或 Y 栏与原表结构不一致。');
    }
    return records.flatMap((row, index) => {
      if (!index || !asText(row[1])) return [];
      const prod = asText(row[1]), model = asText(row[6]), po = asPO(row[7]);
      const vendor = asText(row[13]), factory = asText(row[22]);
      const vendorCode = key(vendor).match(/^P\d+/)?.[0] || '';
      const factoryScope = key(factory).match(/^Y(?:099|100)/)?.[0]?.toLowerCase();
      let scope = '';
      if (vendorCode === 'P19' || vendorCode === 'P22' || key(factory) === 'P19') scope = 'P19';
      else if (vendorCode === 'P1' || (!vendorCode && factoryScope)) scope = factoryScope || 'P1';
      return [{ row: index + 1, prod, model, po, vendor, factory, scope, stamp: serial(row[14]), quantity: quantity(row[15]) || quantity(row[8]), old: asText(row[24]) }];
    });
  }

  function parseWip(lib, bytes, name) {
    const book = lib.read(bytes, {type: 'array'});
    const candidates = [];
    for (const sheet of book.SheetNames) {
      const rows = getRows(lib, book.Sheets[sheet]);
      const index = rows.slice(0, 15).findIndex(row => {
        const h = row.map(key);
        return h.includes('客户型号') && (h.includes('工艺名称') && h.includes('生产型号') && h.includes('客户料号') || h.includes('产品编号') && h.includes('开料') && h.includes('投产单号'));
      });
      if (index !== -1) candidates.push({sheet, rows, index});
    }
    if (candidates.length !== 1) throw new Error(`${name} 的 WIP 数据表${candidates.length ? '有多个，请保留一张' : '无法识别，请检查列名'}。`);
    const {sheet, rows, index} = candidates[0];
    const headers = rows[index].map(asText);
    const headerKeys = headers.map(key);
    const col = (...names) => headerKeys.findIndex(item => names.some(n => key(n) === item));
    const list = col('工艺名称') >= 0;
    const has310 = col('客户ID') >= 0;
    let source = has310 ? '310' : 'b002';
    if (list) {
      const factoryCol = col('生产型号');
      const hints = new Set(([name, sheet, ...rows.slice(0,index).flat()].join(' ').match(/y(?:099|100)/gi) || []).map(v=>v.toLowerCase()));
      const codes = new Set(rows.slice(index + 1).flatMap(row => key(row[factoryCol]).match(/^Y(?:099|100)/)?.[0]?.toLowerCase() || []));
      if (codes.size === 1 && (!hints.size || hints.has([...codes][0]))) source = [...codes][0];
      else if (hints.size === 1 && !codes.size) source = [...hints][0];
      else throw new Error(`${name} 无法确定属于 y099 还是 y100，请检查报表和文件名。`);
    }
    const factoryCol = col(list ? '生产型号' : '产品编号');
    const poCol = col('客户PO', '客户P/O.', '客户P/O', '客户PO.');
    const modelCol = col('客户型号');
    const prodCol = col(list ? '客户料号' : '客户物料编码');
    const stampCol = col('下单时间');
    const jobCol = col('投产单号');
    const areaCol = col('客户ID');
    const qtyCol = col('销售合同数量');
    const mainStatusCol = col('状态');
    const statusCols = [mainStatusCol, col('最新交期'), col('EQ状态')].filter(n => n >= 0);
    const excluded = /客户简称|面积|停留|备注|合计|实投|状态|完结|余数|差数|送货|交期|数量|暂停/;
    const limit = col('暂停');
    const stages = list ? [] : headers.slice(col('开料'), limit < 0 ? headers.length : limit)
      .map((label, i) => [label, i + col('开料')]).filter(([label]) => label && !excluded.test(label));
    const groups = new Map();
    let footerStatusCol = -1;
    for (const [offset, row] of rows.slice(index + 1).entries()) {
      if (source === 'b002' && !asText(row[jobCol]) && (!asText(row[factoryCol]) || same(row[factoryCol], '产品编号'))) {
        const heading = row.findIndex(value => same(value, '状态'));
        if (heading >= 0) {
          footerStatusCol = heading;
          continue;
        }
      }
      const factory = asText(row[factoryCol]);
      if (!factory || /^(合计|汇总|总计|小计)|产品编号|生产型号/.test(factory)) continue;
      const inStatusSection = footerStatusCol >= 0;
      const model = asText(row[modelCol]);
      const po = inStatusSection ? '' : asPO(row[poCol]);
      const prod = inStatusSection ? '' : asText(row[prodCol]);
      const stamp = inStatusSection ? 0 : serial(row[stampCol]);
      const job = inStatusSection ? '' : has310 ? row.slice(jobCol, areaCol).map(asText).find(v => /^JKTC/i.test(v)) || asText(row[jobCol]) : asText(row[jobCol]);
      const area = asText(row[areaCol]);
      const id = list ? groupKey([source, factory, po, stamp.toFixed(8)]) : groupKey(job ? [source, area, job, factory] : [source, area, factory, model, po]);
      const rawStages = inStatusSection ? [] : list ? [asText(row[col('工艺名称')])] : stages.filter(([, j]) => Number(row[j]) > 0).map(([label]) => label);
      const explicitStatus = source === 'b002' ? row[inStatusSection ? footerStatusCol : mainStatusCol] : null;
      if (typeof explicitStatus === 'string' && /[A-Z\u3400-\u9fff]/i.test(explicitStatus) && !/^(状态|N\/?A)$/i.test(key(explicitStatus))) {
        rawStages.push(asText(explicitStatus));
      }
      // The b002 footer has its own layout. A status sharing the main table's PO column is never a PO.
      if (inStatusSection && !rawStages.length) continue;
      const status = inStatusSection ? '' : statusCols.map(j => asText(row[j])).find(v => /^(EQ\s*(?:中|确认中|已完成|完成|待确认)|MI\s*(?:制作|中)|待投产|待处理|暂停|外发|待资料|工程确认)$/i.test(v)) || '';
      const record = groups.get(id) || { id, source, job, prod, model, po, factory, stamp, stages: [], status: '', file: name, row: index + offset + 2 };
      for (const stage of rawStages) if (stage && !record.stages.some(label => same(label, stage))) record.stages.push(stage);
      record.status ||= status;
      record.prod ||= prod;
      record.po ||= po;
      record.model ||= model;
      const reportedQty = quantity(row[qtyCol]);
      if (source === 'b002' && !inStatusSection && reportedQty > 0) {
        record.quantities ||= [];
        if (!record.quantities.includes(reportedQty)) record.quantities.push(reportedQty);
      }
      groups.set(id, record);
    }
    return { source, name, jobs: [...groups.values()] };
  }

  function putDay(days, date, reports) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('请选择有效的 WIP 报表日期。');
    const incoming = reports.map(report => report.source);
    if (!incoming.length || incoming.some(source => !sources.includes(source)) || new Set(incoming).size !== incoming.length) {
      throw new Error(`请选择 1–4 份 WIP，每个来源最多一份。已识别 ${incoming.join('、') || '0 份'}。`);
    }
    const saved = days.find(day => day.date === date)?.reports || [];
    const merged = new Map([...saved, ...reports].map(report=>[report.source, report]));
    return [...days.filter(day => day.date !== date), {date, reports:sources.flatMap(source=>merged.has(source) ? [merged.get(source)] : [])}]
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
  }

  function compatible(order, job) {
    return ['310', 'b002'].includes(job.source) ? order.scope === 'P19' : order.scope === 'P1' || order.scope === job.source;
  }

  function resolveJob(job, orders, jobs) {
    const list = job.source.startsWith('y');
    const eligible = orders.filter(order => compatible(order, job));
    const links = eligible.map(order => ({order, prod: same(order.prod, job.prod), model: same(order.model, job.model), po: same(order.po, job.po), factory: !noFactory(order.factory) && same(order.factory, job.factory), conflict: !!(order.po && job.po && !same(order.po, job.po))}));
    const ranked = links.map(link => {
      const {order, prod, model, po, factory, conflict} = link;
      let score = 0;
      if (prod && (po || !order.po && !job.po)) score = 100 + (factory ? 2 : 0) + (model ? 1 : 0);
      else if (factory && po && model) score = 95;
      else if (factory && po) score = 90;
      else if (model && po && (!list || !job.prod)) score = 85;
      else if (list && conflict) {
        const supplierReference = /^PO\d{6}[A-Z]\d{7,}$/.test(key(job.po));
        const near = job.stamp && order.stamp && Math.abs(job.stamp - order.stamp) * 1440 <= 120;
        const sameRevisionBase = !!order.factory && key(order.factory).slice(0,-1) === key(job.factory).slice(0,-1);
        const corroborated = (prod && factory || prod && model || factory && model) && near;
        if (corroborated || supplierReference && (factory && model || prod && model && sameRevisionBase)) score = 76;
        else if (prod && (job.source === 'y100' || factory && model) && !links.some(other => other.order.row !== order.row && other.prod)) score = 70;
      }
      else if (list && prod) score = 70 + (factory ? 2 : 0) + (model ? 1 : 0);
      else if (!conflict && factory && model) score = 68;
      else if (!conflict && factory && !job.prod) score = 67;
      else if (!conflict && prod && model) score = 66;
      else if (!conflict && model && !list) {
        const conflictingJob = jobs.some(other => compatible(order, other) && same(other.model, job.model) && order.po && other.po && !same(other.po, order.po));
        if (!conflictingJob) score = 55;
      }
      return { ...link, score };
    }).filter(link => link.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length && job.source === 'b002') return resolveB002Model(job, links, jobs);
    if (!ranked.length) return {order: null, candidates: links.filter(x => x.prod || x.model || x.factory || x.po).map(x=>x.order.row)};
    const leading = ranked.filter(link => link.score === ranked[0].score);
    // Stronger identifiers can resolve ties before timestamps. A PO mismatch may still be a supplier PO on y100.
    if (leading.length === 1) return {order: leading[0].order, candidates: []};
    if (list && job.stamp) {
      const dated = leading.filter(link => link.order.stamp).map(link => ({...link, minutes: Math.abs(link.order.stamp - job.stamp) * 1440})).sort((a,b)=>a.minutes-b.minutes);
      if (dated.length && dated[0].minutes < 120.001 && (dated.length === 1 || dated[1].minutes - dated[0].minutes > 0.5)) return {order: dated[0].order, candidates: []};
    }
    return {order: null, candidates: leading.map(link => link.order.row)};
  }

  function resolveB002Model(job, links, jobs) {
    const reported = b002Model(job.model);
    const outputModel = b002OutputModel(job.model);
    const normalized = links.filter(({order}) => {
      const value = b002Model(order.model);
      return value.length >= 5 && (value === reported || value === outputModel);
    });
    const eligible = normalized.filter(({order, conflict}) => {
      if (conflict || job.prod && !same(job.prod, order.prod)) return false;
      const sameModel = b002Model(order.model) === reported;
      const matchingQuantity = job.quantities?.length === 1 && job.quantities[0] === order.quantity;
      if (!sameModel && !matchingQuantity) return false;
      if (sameModel && order.quantity && job.quantities?.length && !job.quantities.includes(order.quantity)) return false;
      return !jobs.some(other => other.source === 'b002' && order.po && other.po && !same(order.po, other.po)
        && b002OutputModel(other.model) === outputModel);
    });
    if (eligible.length === 1) return {order: eligible[0].order, candidates: []};
    const candidates = links.filter(x => x.prod || x.model || x.factory || x.po || normalized.includes(x));
    return {order: null, candidates: candidates.map(x=>x.order.row)};
  }

  function snapshot(day, orders) {
    const reports = day?.reports || [];
    const coverage = new Set(reports.map(report=>report.source));
    const jobs = reports.flatMap(report => report.jobs);
    const matched = new Map(), unconfirmed = new Map();
    for (const job of jobs) {
      const resolution = resolveJob(job, orders, jobs);
      if (resolution.order) {
        const row = resolution.order.row;
        if (!matched.has(row)) matched.set(row, []);
        matched.get(row).push(job);
      } else for (const row of resolution.candidates) {
        if (!unconfirmed.has(row)) unconfirmed.set(row, []);
        unconfirmed.get(row).push(job);
      }
    }
    return {coverage, jobs, matched, unconfirmed, byId: new Map(jobs.map(job=>[job.id,job]))};
  }
  function change(previous, latest, hasBoth) {
    if (!hasBoth) return '待两日报表';
    if (!previous.length && !latest.length) return '两日均无匹配';
    if (!previous.length) return '最新出现';
    if (!latest.length) return '最新未报';
    const pairs = new Map(previous.map(job=>[job.id, job]));
    if (pairs.size !== latest.length || latest.some(job=>!pairs.has(job.id))) return '投产单有变化';
    const stages = latest.map(job => [sortedStages(job), sortedStages(pairs.get(job.id))]);
    if (stages.some(([a,b]) => a && b && a !== b)) return '工序有变化';
    if (stages.some(([a,b]) => !a || !b)) return '工序未报';
    return '工序未变';
  }
  const progress = jobs => jobs.map(stageText).filter(Boolean).join('+');
  const identifiers = record => fields.map(field => record[field]);
  const missingReports = (snapshot, expected) => expected.filter(source=>!snapshot.coverage.has(source));
  function reportChange(before, now, recent, missingBefore, missingNow) {
    if (recent && missingBefore.length && missingNow.length) return '近两日报表不齐';
    if (missingNow.length) return '最新日报表未导入';
    if (recent && missingBefore.length) return '前一日报表未导入';
    return change(before, now, recent);
  }
  function compute(orders, days) {
    const snapshots = days.map(day => snapshot(day, orders));
    const latest = snapshots.at(-1) || snapshot(null, orders), previous = snapshots.at(-2) || snapshot(null, orders);
    const recent = snapshots.length >= 2;
    const rows = orders.map(order => {
      const now = latest.matched.get(order.row) || [], before = previous.matched.get(order.row) || [];
      const notes = latest.unconfirmed.get(order.row) || [];
      const latestKnown = [...now,...before,...notes];
      const known = latestKnown.length ? latestKnown : snapshots.at(-3)?.matched.get(order.row) || [];
      const expected = known.length ? [...new Set(known.map(job=>job.source))] : sources.filter(source=>compatible(order,{source}));
      const missingNow = days.length ? missingReports(latest,expected) : [];
      const missingBefore = recent ? missingReports(previous,expected) : [];
      const reason = !days.length ? '' : missingNow.length ? `最新日未导入 ${missingNow.join('、')}` : now.length ? progress(now) ? '' : '已匹配，供应商未报工序' : !order.scope ? '未覆盖该供应商或缺供应商信息' : notes.length ? '有相同字段，订单归属待核' : before.length ? '前日报表有匹配，最新未报' : '最新报表无匹配';
      const aliases = snapshots.flatMap(snap => (snap.matched.get(order.row) || []).flatMap(identifiers));
      return {...order, now, before, notes, aliases, reason, state:reportChange(before,now,recent,missingBefore,missingNow), firstText:progress(before), lastText:progress(now), type:'在线订单'};
    });
    const assigned = new Set([...latest.matched.values(), ...previous.matched.values()].flat().map(job=>job.id));
    const compare = new Map();
    for (const snap of snapshots) for (const job of snap.jobs) compare.set(job.id, job);
    const compared = [...compare.values()].sort((a,b)=>a.source.localeCompare(b.source,'en',{numeric:true}) || a.factory.localeCompare(b.factory) || a.job.localeCompare(b.job)).map(job => {
      const now = latest.byId.get(job.id), before = previous.byId.get(job.id);
      const state = reportChange(before ? [before] : [], now ? [now] : [], recent,missingReports(previous,[job.source]),missingReports(latest,[job.source]));
      const aliases = snapshots.flatMap(snap => { const sameJob = snap.byId.get(job.id); return sameJob ? identifiers(sameJob) : []; });
      const when = snapshots.map(snap => {
        const record = snap.byId.get(job.id);
        if (!snap.coverage.has(job.source)) return '报表未导入';
        return record ? stageText(record) || '未报工序' : '未列入';
      });
      return {...job, aliases, when, now:now ? [now] : [], before:before ? [before] : [], state: state === '两日均无匹配' ? '近两日未列入' : state,
        lastText:stageText(now), firstText:stageText(before), type:'供应商 WIP'};
    });
    return {rows, compared, queryRows:[...rows, ...compared.filter(job => !assigned.has(job.id))], dates:days.map(day=>day.date)};
  }
  function find(records, terms) {
    const wanted = terms.map(key).filter(Boolean);
    if (!wanted.length) return [];
    return records.filter(record => {
      const keys = [...identifiers(record), ...record.aliases].map(key);
      return wanted.some(term => keys.includes(term));
    });
  }
  root.Wip = { sources, fields, key, parseOrder, parseWip, putDay, compute, find, stageText, identifiers };
})(globalThis);
