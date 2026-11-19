(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const original = {orderName:'', order:null, days:[]};
  let data, orders, result, tab = 'orders', terms = [], pendingFiles = [], busy = false, storage;
  const say = (msg, error = false) => { el('message').textContent = msg; el('message').dataset.kind = error ? 'error' : ''; };
  const allTabs = [...document.querySelectorAll('[data-tab]')];
  const orderChangeKey = row => JSON.stringify([row.scope, ...Wip.identifiers(row).map(Wip.key),row.stamp||'']);

  function openStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('wip-order-desk-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('data');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function readStore() {
    const request = storage.transaction('data').objectStore('data').get('daily');
    return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  }
  function saveStore(value) {
    return new Promise((resolve,reject)=>{
      if (!storage) { reject(new Error('浏览器存储不可用')); return; }
      const tx = storage.transaction('data','readwrite');
      tx.objectStore('data').put(value,'daily');
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }
  async function commit(next, msg, parsed) {
    const current = parsed || orders;
    const computed = Wip.compute(current,next.days);
    let saved = true;
    try { await saveStore(next); } catch { saved = false; }
    data = next;
    orders = current;
    result = computed;
    refresh();
    say(msg + (saved ? '' : ' 浏览器无法保存导入记录，关闭页面前请导出。'), !saved);
  }
  function disableWhileBusy() {
    el('export').disabled = busy || !data?.order || !result?.dates.length;
    el('import').disabled = busy || !el('date').value || !pendingFiles.length || pendingFiles.length > Wip.sources.length;
    for(const id of ['orderFile','wipFiles','date']) el(id).disabled = busy;
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    disableWhileBusy();
    try { await fn(); }
    catch (error) { say(error?.message || '处理失败，请检查所选文件。', true); }
    finally { busy = false; disableWhileBusy(); }
  }
  function refresh() {
    el('orderName').textContent = data.orderName || '尚未选择';
    el('recentDates').replaceChildren(...data.days.map(day=>{
      const saved = new Set(day.reports.map(report=>report.source));
      const missing = Wip.sources.filter(source=>!saved.has(source));
      return make('span',missing.length ? `${day.date} 缺 ${missing.join('、')}` : day.date);
    }));
    el('totals').textContent = `${result.rows.length} 笔在线 · ${result.rows.filter(row=>row.lastText).length} 笔已回填 · ${result.rows.filter(row=>row.reason).length} 笔待复核`;
    render();
  }
  function make(name, content) {
    const node = document.createElement(name);
    node.textContent = content ?? '';
    return node;
  }
  function render() {
    if (!result) return;
    const dates = result.dates;
    const basic = ['生产编号','客户型号','客户 PO','供应商厂编'];
    const latestCols = [dates.at(-2) || '前一日报表', dates.at(-1) || '最新报表','近两日变化'];
    const common = row => [...Wip.identifiers(row),row.firstText,row.lastText,row.state];
    const auditRows = result.rows.filter(row=>row.reason);
    const views = {
      orders: {head:[...basic,...latestCols],rows:result.rows.map(common),text:dates.length ? `Y 栏使用 ${dates.at(-1)} 已导入报表的工序。` : '导入每日 WIP 后可查看在制工序。'},
      search: {head:[...basic,...latestCols,'来源'],rows:terms.some(Boolean) ? Wip.find(result.queryRows,terms).map(row=>[...common(row),row.type]) : [],text:'任填一项或多项，命中任一完整字段值即可检索。'},
      compare: {head:['报表','投产单号',...basic,...dates,'近两日变化'],rows:result.compared.map(row=>[row.source,row.job,...Wip.identifiers(row),...row.when,row.state]),text:'红色表示最近两份报表都列有该投产单，且工序未变。'},
      audit: {head:['订单原行',...basic,'当前结果','可复核的 WIP 来源'],rows:auditRows.map(row=>[row.row,...Wip.identifiers(row),row.reason,(row.notes.length?row.notes:row.before).map(j=>`${j.source} 第 ${j.row} 行 ${j.factory}`).join('\n')]),text:'核对未匹配或缺报表的订单，可按原行号回查订单总表。'}
    };
    const view = views[tab];
    el('searchForm').hidden = tab !== 'search';
    el('summary').textContent = view.text + (tab === 'search' && terms.some(Boolean) ? ` 找到 ${view.rows.length} 条。` : '');
    el('columns').replaceChildren(...view.head.map(name=>{const cell=make('th',name);cell.scope='col';return cell;}));
    const body = el('items');
    if (!view.rows.length) {
      const tr = make('tr');
      const empty = tab==='orders'&&!data.order ? '请选择原始订单总表' : tab==='compare'&&!dates.length ? '请选择同一天的 1–4 份 WIP' : tab==='search'&&!terms.some(Boolean) ? '输入要检索的字段值' : '无记录';
      const td = make('td', empty);
      td.className = 'empty'; td.colSpan = view.head.length; tr.appendChild(td);
      body.replaceChildren(tr);
      return;
    }
    const fragment = document.createDocumentFragment();
    const pos = view.head.indexOf('近两日变化');
    for (const values of view.rows) {
      const row = make('tr');
      if (tab === 'compare' && values.at(-1) === '工序未变') row.className = 'unchanged';
      values.forEach((v,i)=>{ const c=make('td',v);if(/^(投产单号|生产编号|供应商厂编|客户 PO)$/.test(view.head[i]) && String(v).length < 30) c.className='identifier';if(i === pos && v==='工序未变')c.dataset.status='unchanged';row.appendChild(c); });
      fragment.append(row);
    }
    body.replaceChildren(fragment);
  }
  for (const button of allTabs) button.addEventListener('click',()=>{
    tab=button.dataset.tab;
    for(const b of allTabs)b.setAttribute('aria-selected', String(button===b));
    el('tableBox').scrollTop=0;
    render();
    if(tab==='search') el('searchForm').elements.prod.focus();
  });
  el('searchForm').addEventListener('submit',event=>{event.preventDefault();terms=Wip.fields.map(name=>event.target.elements[name].value.trim());render();});
  el('searchForm').addEventListener('reset',()=>{terms=[];render();});
  function acceptOrder(file) {
    if(!file) return;
    return action(async()=>{
      const bytes = await file.arrayBuffer();
      const parsed = Wip.parseOrder(XLSX,bytes);
      const before = new Map(), after = new Map();
      for(const [map,rows] of [[before,orders],[after,parsed]]) {
        for(const row of rows) {
          const identity = orderChangeKey(row);
          map.set(identity, (map.get(identity)||0)+1);
        }
      }
      const difference = (a,b) => [...a].reduce((total,[k,count])=>total+Math.max(0,count-(b.get(k)||0)),0);
      const added = difference(after,before), removed = difference(before,after);
      await commit({...data,orderName:file.name,order:bytes},`订单总表已更新。在线 ${parsed.length} 笔，较上份新增 ${added} 笔、移出 ${removed} 笔。`,parsed);
    });
  }
  el('orderFile').addEventListener('change',async event=>{await acceptOrder(event.target.files[0]);event.target.value='';});
  function selectWip(files) {
    pendingFiles = [...files];
    el('selected').hidden = !pendingFiles.length;
    el('selected').textContent = pendingFiles.length > Wip.sources.length ? `已选 ${pendingFiles.length} 份，每次最多选同一天的 4 份 WIP。` : pendingFiles.map(file=>file.name).join(' · ');
    disableWhileBusy();
  }
  el('wipFiles').addEventListener('change',event=>selectWip(event.target.files));
  el('date').addEventListener('input',disableWhileBusy);
  el('import').addEventListener('click',()=>action(async()=>{
    const date = el('date').value;
    const reports = await Promise.all(pendingFiles.map(async file=>{
      try { return Wip.parseWip(XLSX,await file.arrayBuffer(),file.name); }
      catch(error) { throw new Error(`${file.name} 导入失败。${error.message || ''}`); }
    }));
    const updates = Wip.putDay(data.days,date,reports);
    if(!updates.some(day=>day.date===date)) throw new Error('该日期早于已保留的最近三份报表。');
    const saved = new Set(data.days.find(day=>day.date===date)?.reports.map(report=>report.source));
    const added = reports.filter(report=>!saved.has(report.source)).map(report=>report.source);
    const replaced = reports.filter(report=>saved.has(report.source)).map(report=>report.source);
    const changes = [added.length ? `已导入 ${added.join('、')}` : '', replaced.length ? `已替换 ${replaced.join('、')}` : ''].filter(Boolean);
    await commit({...data,days:updates},`${date} ${changes.join('，')}。`);
    el('wipFiles').value='';selectWip([]);
  }));
  el('export').addEventListener('click',()=>action(async()=>{
    const bytes = WipExport.exportBook(data.order,result);
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    link.href=url; link.download=`WIP_订单_${result.dates.at(-1)}.xlsx`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),6000);
    say('工作簿已生成，请在浏览器下载记录中查看。');
  }));
  function enableDrop(card, handle) {
    card.addEventListener('dragover',event=>{event.preventDefault();if(!busy)card.classList.add('drag');});
    card.addEventListener('dragleave',()=>card.classList.remove('drag'));
    card.addEventListener('drop',event=>{
      event.preventDefault(); card.classList.remove('drag');
      if(!busy)handle([...event.dataTransfer.files]);
    });
  }
  enableDrop(el('orderCard'),files=>files.length===1?acceptOrder(files[0]):say('每次选择一份订单总表。',true));
  enableDrop(el('wipCard'),selectWip);
  async function initialize() {
    busy = true;disableWhileBusy();
    try {
      try { storage=await openStore(); data=(await readStore()) || original; }
      catch { data=original; say('浏览器无法保存导入记录，关闭页面前请导出。',true); }
      orders=data.order ? Wip.parseOrder(XLSX,data.order) : [];
      result=Wip.compute(orders,data.days);
      const now = new Date();
      const day = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      el('date').value=day;
      refresh();
    } catch(error) { say(error.message,true); }
    finally { busy=false;disableWhileBusy(); }
  }
  initialize();
})();
