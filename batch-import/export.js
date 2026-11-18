(function (root) {
  'use strict';
  const x = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pr = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const ct = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const direct = (node, localName) => [...node.children].filter(child => child.localName === localName);
  const first = (node, name) => direct(node, name)[0];
  const atts = (node, attrs) => { for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value)); return node; };
  const make = (parent, name, attrs = {}, content = null, namespace = parent.namespaceURI) => {
    const node = atts(parent.ownerDocument.createElementNS(namespace, name), attrs);
    if (content !== null) node.textContent = content;
    return node;
  };
  const clean = value => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/_x([a-fA-F0-9]{4})_/g, '_x005f_x$1_').slice(0, 32767);
  const letters = i => i < 26 ? String.fromCharCode(65 + i) : letters(Math.floor(i / 26) - 1) + letters(i % 26);
  const reportWidths = [
    [19, 30, 22, 21, 17, 32, 32, 19],
    [12, 18, 21, 30, 22, 22, 29, 29, 29, 18],
    [12, 19, 32, 24, 28, 21, 37, 32],
  ];
  const parser = () => new DOMParser();
  function documentFor(xml, path) {
    const doc = parser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`无法读取订单工作簿中的 ${path}。`);
    return doc;
  }
  function put(zip, name, doc) { zip[name] = fflate.strToU8(new XMLSerializer().serializeToString(doc)); }
  function openXml(zip, name) {
    const file = zip[name];
    if (!file) throw new Error(`工作簿缺少 ${name}。`);
    return documentFor(fflate.strFromU8(file), name);
  }
  function packagePath(target) { return target.startsWith('/') ? target.slice(1) : 'xl/' + target; }

  function cell(row, reference, payload, style, formula = false) {
    const c = make(row, 'c', {r:reference});
    if (style != null) c.setAttribute('s', String(style));
    fillCell(c, payload, formula);
    return c;
  }
  function fillCell(cell, payload, formula = false) {
    for (const name of ['f','v','is']) for (const node of direct(cell, name)) node.remove();
    cell.removeAttribute('t');
    const extension = first(cell,'extLst');
    if (formula) {
      cell.setAttribute('t','str');
      cell.insertBefore(make(cell,'f',{},payload), extension || null);
      cell.insertBefore(make(cell,'v'), extension || null);
    } else if (typeof payload === 'number') {
      cell.insertBefore(make(cell,'v',{},payload), extension || null);
    } else if (payload !== '' && payload != null) {
      cell.setAttribute('t','inlineStr');
      const inline = make(cell,'is');
      const txt = make(cell,'t',{},clean(payload));
      txt.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      inline.append(txt);
      cell.insertBefore(inline, extension || null);
    }
  }
  function updateY(doc, result) {
    const rows = new Map(direct(first(doc.documentElement,'sheetData'), 'row').map(row=>[Number(row.getAttribute('r')),row]));
    for (const record of result.rows) {
      const row = rows.get(record.row);
      if (!row) throw new Error(`订单总表第 ${record.row} 行读取失败。`);
      const ref = 'Y' + record.row;
      const cells = direct(row, 'c');
      const original = cells.find(item=> item.getAttribute('r') === ref);
      if (original) fillCell(original, record.lastText);
      else if (record.lastText) {
        const after = cells.find(item=> /^([A-Z]{2,}|Z)\d+$/.test(item.getAttribute('r')));
        row.insertBefore(cell(row,ref,record.lastText), after || first(row,'extLst') || null);
      }
    }
  }
  function extendStyles(doc) {
    const style = doc.documentElement;
    const fonts = first(style,'fonts'), fills = first(style,'fills'), xfs = first(style,'cellXfs');
    const append = (parent, name, attrs = {}) => { const child = make(parent,name,attrs); parent.appendChild(child); return child; };
    const addIndexed = (parent, name, attrs = {}) => {
      const id = direct(parent,name).length;
      const item = append(parent,name,attrs);
      parent.setAttribute('count',id+1);
      return [id,item];
    };
    const addFont = (rgb, bold) => {
      const [id, f] = addIndexed(fonts,'font');
      if (bold) append(f,'b');
      append(f,'sz',{val:11});
      append(f,'color',{rgb});
      append(f,'name',{val:'等线'});
      return id;
    };
    const addFill = rgb => {
      const [id, f] = addIndexed(fills,'fill');
      const pattern = append(f,'patternFill',{patternType:'solid'});
      append(pattern,'fgColor',{rgb});
      append(pattern,'bgColor',{indexed:64});
      return id;
    };
    const normal = addFont('FF152D3A',false), white = addFont('FFFFFFFF',true), red = addFont('FF991B37',true);
    const navy = addFill('FF164559'), pastel = addFill('FFFFF1C8'), pink = addFill('FFFDE2E8');
    const addStyle = (fontId, fillId = 0, numFmtId = 0, wrap = 0) => {
      const [id, xf] = addIndexed(xfs,'xf',{numFmtId,fontId,fillId,borderId:0,xfId:0,applyNumberFormat:1,applyFont:1,applyFill:1,applyAlignment:1});
      append(xf,'alignment',{vertical:'center',wrapText:wrap});
      return id;
    };
    return {body:addStyle(normal,0,0,1), head:addStyle(white,navy,0,1), input:addStyle(normal,pastel,49), red:addStyle(red,pink,0,1)};
  }
  function report(doc, width, last, header, filter = false) {
    const ws = doc.documentElement;
    const data = first(ws,'sheetData');
    data.replaceChildren();
    first(ws,'dimension')?.setAttribute('ref',`A1:${letters(width - 1)}${last}`);
    const cols = first(ws,'cols');
    if (width >= 21) cols.append(make(cols,'col',{min:11,max:21,width:12,hidden:1,customWidth:1}));
    if (filter) data.after(make(ws,'autoFilter',{ref:`A${header}:${letters(width - 1)}${last}`}));
    return (i, values, style, height) => {
      const row = make(data,'row',{r:i,ht:height,customHeight:1});
      data.append(row);
      for (const [c, value] of values.entries()) {
        if (value == null) continue;
        const entry = typeof value === 'object' ? value : {v:value};
        row.append(cell(row,letters(c)+i,entry.v,entry.style ?? style,entry.formula === true));
      }
      return row;
    };
  }
  const aliasText = row => '\n' + [...new Set([...Wip.identifiers(row),...row.aliases].map(Wip.key).filter(Boolean))].join('\n') + '\n';
  const tooLong = columns => columns.some(value => String(value ?? '').length > 43);
  function writeSearch(doc, result, styles) {
    const records = result.queryRows;
    const last = 5 + Math.max(1,records.length);
    const row = report(doc,21,last,5);
    const [oldDate, newDate] = [result.dates.at(-2),result.dates.at(-1)];
    row(1,['订单检索'],styles.head,25);
    row(2,['生产编号','客户型号','客户PO','供应商厂编'],styles.body,22);
    row(3,['','','','','任填一项或多项，命中任一值即显示。'],styles.input,25);
    const base = ['生产编号','客户型号','客户PO','供应商厂编','来源',oldDate || '前一日报表',newDate || '最新报表','近两日变化'];
    const head = row(5,base,styles.head,26);
    head.append(cell(head,'U5',0));
    const f = v => ({v,formula:true});
    const normalizeInput = ref => `UPPER(TRIM(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${ref}&"",CHAR(160)," "),"　"," "),"－","-"),"–","-")))`;
    Array.from({length:Math.max(1,records.length)}, (_, index) => {
      const i = index + 6;
      const record = records[index];
      const output = base.map((_, j) => f(`IF($U$${last}<ROWS($A$6:A${i}),"",IFERROR(INDEX($${letters(10+j)}$6:$${letters(10+j)}$${last},MATCH(ROWS($A$6:A${i}),$T$6:$T$${last},0))&"",""))`));
      const bank = record ? [...Wip.identifiers(record),record.type,record.firstText,record.lastText,record.state] : [];
      const terms = ['A','B','C','D'].map(c => `AND($${c}$3<>"",ISNUMBER(FIND(CHAR(10)&${normalizeInput(`$${c}$3`)}&CHAR(10),S${i})))`);
      row(i,[...output,null,null,...Array.from({length:8},(_,j)=>bank[j] || ''),record ? aliasText(record) : '',f(`IF(OR(${terms.join(',')}),N(U${i-1})+1,"")`),f(`MAX(N(U${i-1}),N(T${i}))`)],styles.body,34);
    });
  }
  function writeCompare(doc, result, styles) {
    const row = report(doc,10,result.compared.length + 1,1,true);
    const dates = [...result.dates];
    namesForMissingDays(dates);
    row(1,['报表','投产单号','生产编号 / 料号','客户型号','客户PO','供应商厂编',...dates,'近两日变化'],styles.head,26);
    result.compared.forEach((record, i) => {
      const when = [...record.when];
      while (when.length < 3) when.push('');
      const values = [record.source,record.job,record.prod,record.model,record.po,record.factory,...when,record.state];
      row(i+2,values,record.state === '工序未变' ? styles.red : styles.body,tooLong(values)?32:22);
    });
  }
  function namesForMissingDays(dates) { while(dates.length < 3) dates.push('第'+(dates.length+1)+'日报表待导入'); }
  function writeAudit(doc, result, styles) {
    const review = result.rows.filter(record=>record.reason);
    const row = report(doc,8,Math.max(2,review.length+1),1,true);
    row(1,['订单原行','生产编号','客户型号','客户PO','当前结果','原表Y栏','供应商 / 厂编','可复核的 WIP 来源'],styles.head,26);
    if (!review.length) row(2,[null,'无待复核记录'],styles.body,22);
    review.forEach((o,i) => {
      const reference = (o.notes.length ? o.notes : o.before).map(job=>`${job.source} 第 ${job.row} 行 ${job.factory}`).join('\n');
      row(i+2,[o.row,o.prod,o.model,o.po,o.reason,o.old,[o.vendor,o.factory].filter(Boolean).join(' / '),reference],styles.body, reference.length > 32 || o.model.length > 31 ? 33 : 23);
    });
  }

  function reportLayout(index) {
    const frozenRows = index === 0 ? 5 : 1;
    const cols = reportWidths[index].map((width,i) => `<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('');
    const xml = `<worksheet xmlns="${x}"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${frozenRows}" topLeftCell="A${frozenRows+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
    return documentFor(xml,'报表布局');
  }

  function exportBook(bytes, result) {
    const zip = fflate.unzipSync(new Uint8Array(bytes));
    const [doc, relationships, types, styleDoc] = ['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml','xl/styles.xml'].map(path=>openXml(zip,path));
    const workbook = doc.documentElement;
    const sheets = first(workbook,'sheets');
    const rels = relationships.documentElement;
    const oldSheet = direct(sheets,'sheet').find(sheet=>sheet.getAttribute('name') === '在线订单');
    const resolve = id => direct(rels,'Relationship').find(rel=>rel.getAttribute('Id') === id);
    const onlinePath = packagePath(resolve(oldSheet.getAttributeNS(r,'id')).getAttribute('Target'));
    const online = openXml(zip,onlinePath);
    updateY(online,result);
    put(zip,onlinePath,online);
    const styles = extendStyles(styleDoc);
    put(zip,'xl/styles.xml',styleDoc);
    let max = Math.max(...direct(sheets,'sheet').map(sheet=>Number(sheet.getAttribute('sheetId'))),0);
    const names = ['订单检索','WIP对比','匹配复核'];
    const writers = [writeSearch,writeCompare,writeAudit];
    for (const [i,name] of names.entries()) {
      max++;
      let sequence = max;
      while (zip[`xl/worksheets/sheet${sequence}.xml`]) sequence++;
      const filename = `worksheets/sheet${sequence}.xml`;
      let relIndex = 1;
      while (resolve('rId'+relIndex)) relIndex++;
      const id = 'rId'+relIndex;
      const originalLayout = reportLayout(i);
      writers[i](originalLayout,result,styles);
      put(zip,'xl/'+filename,originalLayout);
      const sheet = make(sheets,'sheet',{name,sheetId:max});
      sheet.setAttributeNS(r,'r:id',id);
      sheets.append(sheet);
      rels.append(make(rels,'Relationship',{Id:id,Type:r+'/worksheet',Target:filename},null,pr));
      const typesRoot = types.documentElement;
      typesRoot.append(make(typesRoot,'Override',{PartName:'/xl/'+filename,ContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'},null,ct));
    }
    for (const rel of direct(rels,'Relationship').filter(rel=>rel.getAttribute('Type') === r+'/calcChain')) {
      const path = packagePath(rel.getAttribute('Target'));
      delete zip[path];
      for (const type of direct(types.documentElement,'Override').filter(item=>item.getAttribute('PartName') === '/'+path)) type.remove();
      rel.remove();
    }
    const calc = first(workbook,'calcPr');
    if (calc) { calc.setAttribute('fullCalcOnLoad','1'); calc.setAttribute('calcMode','auto'); }
    put(zip,'xl/workbook.xml',doc);
    put(zip,'xl/_rels/workbook.xml.rels',relationships);
    put(zip,'[Content_Types].xml',types);
    return fflate.zipSync(zip);
  }
  root.WipExport = { exportBook };
})(globalThis);
