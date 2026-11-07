/*
 * 微信读书数据探测脚本（只读试跑版）
 *
 * 用途：在电脑浏览器里、已登录的 weread.qq.com 页面上运行，检查能从微信读书网页版读到哪些数据：
 *       书架、阅读进度、读完时间、划线（是否带时间）、想法、每日阅读时长。
 * 安全：只发 GET 请求，不修改微信读书里的任何内容；不读取 Cookie；数据只显示在当前页面，不发往任何其他网站。
 * 用法：见仓库 README 或对话说明。把整段代码粘贴到浏览器控制台（Console）回车即可。
 */
(async () => {
  'use strict';

  if (!/(^|\.)weread\.qq\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) {
    alert('请先打开 https://weread.qq.com 并登录，再在那个页面运行本脚本。');
    return;
  }

  const MAX_DETAIL_BOOKS = 5;   // 试跑只抽查最近的 5 本书，避免请求过多
  const DELAY_MS = 400;         // 每个请求之间稍作停顿
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cut = (s, n = 60) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const toDate = (ts) => {
    if (!ts || typeof ts !== 'number') return '';
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const hours = (sec) => (typeof sec === 'number' ? (sec / 3600).toFixed(1) + ' 小时' : '');

  /* ---------- 结果面板（用 Shadow DOM，避免和页面样式互相影响） ---------- */
  const old = document.getElementById('__rs_probe');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = '__rs_probe';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    .box{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#FFFDF8;color:#2A2924;
      border:1px solid #E6DFCF;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
    header{position:sticky;top:0;background:#2F5241;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
    header b{font-size:15px} header button{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer}
    .body{padding:12px 16px 16px}
    h3{font-size:14px;margin:14px 0 6px;color:#2F5241}
    .st{color:#857F72;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:13px} td,th{border-bottom:1px solid #EEE7D8;padding:5px 4px;text-align:left;vertical-align:top}
    .ok{color:#2F7A4B;font-weight:600} .bad{color:#A6473B;font-weight:600} .maybe{color:#A8844E;font-weight:600}
    .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px} .btns button{flex:1;min-width:150px;padding:9px 10px;border-radius:9px;border:1px solid #2F5241;
      background:#2F5241;color:#fff;cursor:pointer;font-size:13px} .btns button.ghost{background:#fff;color:#2F5241}
    .sample{background:#F5F1E8;border-radius:8px;padding:6px 8px;margin:4px 0;font-size:12.5px}
    code{font-size:12px;background:#F0EADC;padding:0 4px;border-radius:4px}
  </style>
  <div class="box"><header><b>微信读书数据探测（只读）</b><button id="x" title="关闭">×</button></header><div class="body" id="body"><div class="st" id="status">准备中…</div></div></div>`;
  root.getElementById('x').onclick = () => host.remove();
  const $status = root.getElementById('status');
  const setStatus = (t) => { $status.textContent = t; };

  /* ---------- 请求封装：记录每个接口的结果 ---------- */
  const calls = [];
  async function get(name, path) {
    const rec = { name, path: path.replace(/bookId=[^&]+/, 'bookId=…'), ok: false };
    calls.push(rec);
    const t0 = performance.now();
    try {
      const res = await fetch(path, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
      rec.http = res.status;
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (e) { rec.error = '返回的不是 JSON'; return null; }
      const code = json.errcode ?? json.errCode;
      if (code !== undefined && code !== 0) { rec.error = `errcode ${code} ${json.errmsg || json.errMsg || ''}`.trim(); return null; }
      if (!res.ok) { rec.error = `HTTP ${res.status}`; return null; }
      rec.ok = true;
      rec.keys = Object.keys(json).slice(0, 12);
      return json;
    } catch (e) {
      rec.error = String((e && e.message) || e);
      return null;
    } finally {
      rec.ms = Math.round(performance.now() - t0);
      await sleep(DELAY_MS);
    }
  }
  async function getFirst(name, paths) {
    for (const p of paths) { const j = await get(name, p); if (j) return j; }
    return null;
  }

  const R = { shelf: null, notebook: null, details: [], readdata: [], bookInfoKeys: [] };

  /* ---------- 1. 书架 ---------- */
  setStatus('正在读取书架…');
  const shelf = await get('书架', '/web/shelf/sync?synckey=0&teenmode=0&album=1&onlyBookid=0');
  if (!shelf) {
    const last = calls[calls.length - 1];
    root.getElementById('body').innerHTML = `<p class="bad">读取书架失败：${esc(last.error || '未知错误')}</p>
      <p>常见原因：没有登录或登录已过期。请在本页面右上角用微信扫码登录，<b>刷新页面</b>后再运行一次脚本。</p>
      <p class="st">如果确认已登录仍然失败，可能是微信读书改了接口，请把这段红字发给我。</p>`;
    return;
  }
  const books = Array.isArray(shelf.books) ? shelf.books : [];
  const progMap = new Map((Array.isArray(shelf.bookProgress) ? shelf.bookProgress : []).map((p) => [p.bookId, p]));
  R.shelf = {
    total: books.length,
    finished: books.filter((b) => b.finishReading === 1 || b.finishReading === true).length,
    withProgress: books.filter((b) => (progMap.get(b.bookId) || {}).progress > 0).length,
    progressListed: progMap.size,
    bookFields: books[0] ? Object.keys(books[0]) : [],
    progressFields: progMap.size ? Object.keys(progMap.values().next().value) : [],
    sample: books.slice(0, 5).map((b) => ({ title: b.title, author: b.author, finished: !!b.finishReading, progress: (progMap.get(b.bookId) || {}).progress, hasCover: !!b.cover, category: b.category || '' })),
  };

  /* ---------- 2. 有笔记的书 ---------- */
  setStatus('正在读取笔记本列表…');
  const nb = await getFirst('有笔记的书', ['/api/user/notebook', '/web/user/notebooks']);
  const nbBooks = nb && Array.isArray(nb.books) ? nb.books : [];
  if (nb) {
    R.notebook = {
      total: nbBooks.length,
      fields: nbBooks[0] ? Object.keys(nbBooks[0]) : [],
      notes: nbBooks.reduce((s, b) => s + (b.noteCount || 0) + (b.reviewCount || 0) + (b.bookmarkCount || 0), 0),
    };
  }

  /* ---------- 3. 抽查最近几本书的详情 ---------- */
  let targets = nbBooks.length
    ? nbBooks.slice().sort((a, b) => (b.sort || 0) - (a.sort || 0)).map((b) => ({ bookId: b.bookId, title: (b.book && b.book.title) || b.title }))
    : books.slice().sort((a, b) => (b.readUpdateTime || 0) - (a.readUpdateTime || 0)).map((b) => ({ bookId: b.bookId, title: b.title }));
  targets = targets.filter((t) => t.bookId).slice(0, MAX_DETAIL_BOOKS);

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    setStatus(`正在抽查第 ${i + 1}/${targets.length} 本：${cut(t.title, 20)}`);
    const d = { title: t.title };

    const pg = await get('阅读进度', `/web/book/getProgress?bookId=${encodeURIComponent(t.bookId)}`);
    if (pg) {
      const p = pg.book || pg;
      d.progress = p.progress;
      d.readingTime = p.readingTime;
      d.start = toDate(p.startReadingTime);
      d.finish = toDate(p.finishTime);
      d.update = toDate(p.updateTime);
      d.progressFields = Object.keys(p);
    }

    const bm = await get('划线', `/web/book/bookmarklist?bookId=${encodeURIComponent(t.bookId)}`);
    if (bm) {
      const list = Array.isArray(bm.updated) ? bm.updated : [];
      const chapters = new Map((Array.isArray(bm.chapters) ? bm.chapters : []).map((c) => [c.chapterUid, c.title]));
      const times = list.map((x) => x.createTime).filter((x) => typeof x === 'number');
      d.highlights = list.length;
      d.hlWithTime = times.length;
      d.hlRange = times.length ? `${toDate(Math.min(...times))} ~ ${toDate(Math.max(...times))}` : '';
      d.hlFields = list[0] ? Object.keys(list[0]) : [];
      d.hlChapters = chapters.size;
      d.hlSamples = list.slice(0, 2).map((x) => ({ chapter: chapters.get(x.chapterUid) || '', text: x.markText, date: toDate(x.createTime) }));
    }

    const rv = await get('想法', `/web/review/list?bookId=${encodeURIComponent(t.bookId)}&listType=11&mine=1&synckey=0`);
    if (rv) {
      const list = (Array.isArray(rv.reviews) ? rv.reviews : []).map((x) => x.review || x);
      const thoughts = list.filter((x) => x.type === 1 || x.type === undefined);
      d.reviews = list.length;
      d.thoughts = thoughts.length;
      d.rvWithTime = list.filter((x) => typeof x.createTime === 'number').length;
      d.rvFields = list[0] ? Object.keys(list[0]) : [];
      d.rvSamples = thoughts.slice(0, 2).map((x) => ({ chapter: x.chapterName || '', quote: x.abstract || '', text: x.content || '', date: toDate(x.createTime) }));
    }

    if (i === 0) {
      const info = await get('书籍信息', `/web/book/info?bookId=${encodeURIComponent(t.bookId)}`);
      if (info) {
        R.bookInfoKeys = Object.keys(info);
        R.bookInfoHas = { isbn: !!info.isbn, category: !!(info.category || (info.categories && info.categories.length)), totalWords: !!info.totalWords, publisher: !!info.publisher, cover: !!info.cover };
      }
    }
    R.details.push(d);
  }

  /* ---------- 4. 每日阅读时长（探测几个可能的接口） ---------- */
  setStatus('正在探测阅读时长数据…');
  for (const p of ['/web/readdata/summary?synckey=0', '/web/readdata/detail?mode=monthly', '/web/readdata/detail?mode=weekly']) {
    const j = await get('阅读时长', p);
    const rec = { path: p, ok: !!j };
    if (j) {
      rec.keys = Object.keys(j).slice(0, 12);
      const rt = j.readTimes || (j.datas && j.datas[0] && j.datas[0].timeMeta && j.datas[0].timeMeta.readTimeList) || null;
      if (rt && typeof rt === 'object') {
        const entries = Array.isArray(rt) ? rt.map((v, i) => [i, v]) : Object.entries(rt);
        rec.days = entries.length;
        const tsKeys = entries.map(([k]) => Number(k)).filter((k) => k > 1e9);
        if (tsKeys.length) rec.range = `${toDate(Math.min(...tsKeys))} ~ ${toDate(Math.max(...tsKeys))}`;
      }
    }
    R.readdata.push(rec);
  }

  /* ---------- 5. 汇总能力 ---------- */
  const anyD = (f) => R.details.some(f);
  const rdOk = R.readdata.some((r) => r.ok && r.days);
  const rdPartial = R.readdata.some((r) => r.ok);
  const caps = [
    ['书架书目（书名/作者）', R.shelf.total > 0 ? 'ok' : 'bad', `${R.shelf.total} 本`],
    ['封面', R.shelf.sample.some((b) => b.hasCover) ? 'ok' : 'bad', ''],
    ['是否读完', R.shelf.bookFields.includes('finishReading') ? 'ok' : 'bad', `已读完 ${R.shelf.finished} 本`],
    ['阅读进度（百分比）', R.shelf.progressListed || anyD((d) => typeof d.progress === 'number') ? 'ok' : 'bad', `有进度 ${R.shelf.withProgress} 本`],
    ['开始 / 读完时间', anyD((d) => d.start || d.finish) ? 'ok' : (R.details.length ? 'bad' : 'maybe'), ''],
    ['累计阅读时长（每本书）', anyD((d) => typeof d.readingTime === 'number') ? 'ok' : (R.details.length ? 'bad' : 'maybe'), ''],
    ['划线', anyD((d) => d.highlights > 0) ? 'ok' : (anyD((d) => d.highlights === 0) ? 'maybe' : 'bad'), ''],
    ['划线带时间', anyD((d) => d.hlWithTime > 0) ? 'ok' : (anyD((d) => d.highlights > 0) ? 'bad' : 'maybe'), ''],
    ['想法', anyD((d) => d.thoughts > 0) ? 'ok' : (anyD((d) => d.reviews !== undefined) ? 'maybe' : 'bad'), ''],
    ['每日阅读时长（可用于日历）', rdOk ? 'ok' : rdPartial ? 'maybe' : 'bad', ''],
  ];
  const mark = { ok: '<span class="ok">✓ 能拿到</span>', bad: '<span class="bad">✗ 拿不到</span>', maybe: '<span class="maybe">? 待确认</span>' };

  /* ---------- 6. 渲染 ---------- */
  const okCalls = calls.filter((c) => c.ok).length;
  root.getElementById('body').innerHTML = `
    <div class="st">共请求 ${calls.length} 次，成功 ${okCalls} 次。以下内容只显示在你的电脑上。</div>
    <h3>能拿到哪些数据</h3>
    <table>${caps.map(([k, v, n]) => `<tr><td>${k}</td><td>${mark[v]}</td><td class="st">${esc(n)}</td></tr>`).join('')}</table>

    <h3>书架（前 5 本）</h3>
    <table><tr><th>书名</th><th>作者</th><th>进度</th><th>读完</th></tr>
      ${R.shelf.sample.map((b) => `<tr><td>${esc(cut(b.title, 20))}</td><td>${esc(cut(b.author, 12))}</td><td>${b.progress ?? ''}${typeof b.progress === 'number' ? '%' : ''}</td><td>${b.finished ? '是' : ''}</td></tr>`).join('')}
    </table>
    ${R.notebook ? `<div class="st">有笔记的书：${R.notebook.total} 本，笔记约 ${R.notebook.notes} 条</div>` : '<div class="bad">笔记本列表读取失败</div>'}

    <h3>抽查最近 ${R.details.length} 本书</h3>
    ${R.details.map((d) => `
      <div style="margin-bottom:10px"><b>${esc(cut(d.title, 24))}</b>
        <div class="st">进度 ${d.progress ?? '—'}% · 阅读时长 ${hours(d.readingTime) || '—'} · 开始 ${d.start || '—'} · 读完 ${d.finish || '—'}</div>
        <div class="st">划线 ${d.highlights ?? '读取失败'} 条（带时间 ${d.hlWithTime ?? 0}）${d.hlRange ? ' · ' + d.hlRange : ''} · 想法 ${d.thoughts ?? '读取失败'} 条</div>
        ${(d.hlSamples || []).map((s) => `<div class="sample">【划线】${s.chapter ? esc(cut(s.chapter, 20)) + ' · ' : ''}${s.date}<br>${esc(cut(s.text, 80))}</div>`).join('')}
        ${(d.rvSamples || []).map((s) => `<div class="sample">【想法】${s.chapter ? esc(cut(s.chapter, 20)) + ' · ' : ''}${s.date}<br>${esc(cut(s.text, 80))}${s.quote ? `<br><span class="st">原文：${esc(cut(s.quote, 60))}</span>` : ''}</div>`).join('')}
      </div>`).join('')}

    <h3>每日阅读时长探测</h3>
    <table>${R.readdata.map((r) => `<tr><td><code>${esc(r.path)}</code></td><td>${r.ok ? (r.days ? `<span class="ok">✓ ${r.days} 条</span>` : '<span class="maybe">有返回，结构待确认</span>') : '<span class="bad">✗</span>'}</td><td class="st">${esc(r.range || '')}</td></tr>`).join('')}</table>

    <div class="btns">
      <button id="c1">复制诊断报告（不含书名和内容）</button>
      <button id="c2" class="ghost">复制含样本的报告</button>
    </div>
    <div class="st" id="cmsg" style="margin-top:6px">把「诊断报告」粘贴给 Claude 即可；如果它说需要看样本，再复制第二个。</div>`;

  /* ---------- 7. 生成报告文本 ---------- */
  function report(withContent) {
    const L = [];
    L.push('【微信读书探测报告】' + (withContent ? '（含样本）' : '（已脱敏）'));
    L.push(`时间：${new Date().toLocaleString()} · 浏览器：${navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/g)?.join(' ') || ''}`);
    L.push('');
    L.push('== 能力 ==');
    caps.forEach(([k, v]) => L.push(`${k}: ${v}`));
    L.push('');
    L.push('== 接口 ==');
    calls.forEach((c) => L.push(`${c.ok ? 'OK ' : 'ERR'} ${c.name} ${c.path} http=${c.http ?? '-'} ${c.ms}ms ${c.error || ''} ${c.keys ? 'keys=' + c.keys.join(',') : ''}`));
    L.push('');
    L.push('== 书架 ==');
    L.push(`总数 ${R.shelf.total} · 读完 ${R.shelf.finished} · 有进度 ${R.shelf.withProgress} · bookProgress 条数 ${R.shelf.progressListed}`);
    L.push('书籍字段：' + R.shelf.bookFields.join(','));
    L.push('进度字段：' + R.shelf.progressFields.join(','));
    if (R.notebook) L.push(`笔记本：${R.notebook.total} 本 · 约 ${R.notebook.notes} 条 · 字段：${R.notebook.fields.join(',')}`);
    if (R.bookInfoKeys.length) L.push('书籍信息字段：' + R.bookInfoKeys.join(',') + ' · ' + JSON.stringify(R.bookInfoHas));
    L.push('');
    L.push('== 抽查 ==');
    R.details.forEach((d, i) => {
      L.push(`#${i + 1}${withContent ? ' ' + cut(d.title, 30) : ''}: 进度=${d.progress ?? '-'} 时长秒=${d.readingTime ?? '-'} 开始=${d.start ? '有' : '无'} 读完=${d.finish ? '有' : '无'} 划线=${d.highlights ?? 'ERR'}(带时间${d.hlWithTime ?? 0}) 想法=${d.thoughts ?? 'ERR'}/${d.reviews ?? 'ERR'}`);
      if (i === 0) {
        L.push('  进度字段：' + (d.progressFields || []).join(','));
        L.push('  划线字段：' + (d.hlFields || []).join(','));
        L.push('  想法字段：' + (d.rvFields || []).join(','));
      }
      if (withContent) {
        L.push(`  开始=${d.start || '-'} 读完=${d.finish || '-'} 划线时间范围=${d.hlRange || '-'}`);
        (d.hlSamples || []).forEach((s) => L.push(`  [划线] ${s.date} ${cut(s.chapter, 20)} | ${cut(s.text, 60)}`));
        (d.rvSamples || []).forEach((s) => L.push(`  [想法] ${s.date} ${cut(s.chapter, 20)} | ${cut(s.text, 60)} | 原文:${cut(s.quote, 40)}`));
      }
    });
    L.push('');
    L.push('== 阅读时长 ==');
    R.readdata.forEach((r) => L.push(`${r.ok ? 'OK ' : 'ERR'} ${r.path} ${r.keys ? 'keys=' + r.keys.join(',') : ''} ${r.days ? 'days=' + r.days : ''} ${withContent && r.range ? r.range : ''}`));
    return L.join('\n');
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const t = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = t; }, 1500);
  }
  root.getElementById('c1').onclick = (e) => copy(report(false), e.currentTarget);
  root.getElementById('c2').onclick = (e) => copy(report(true), e.currentTarget);
  console.log('[阅读空间] 探测完成', R);
})();
