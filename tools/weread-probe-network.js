/*
 * 微信读书请求记录器（只读试跑 · 第三版）
 *
 * 第二版发现：/web/book/bookmarklist 对有 91 条划线的书也只返回 {}，说明网页版改用了别的接口加载划线。
 * 这一版不自己猜接口，而是「旁观」网页自己发出的请求：
 *   1. 列出页面加载以来已经发过的数据请求（只有地址，没有内容；不含图片、脚本等静态文件）；
 *   2. 之后网页再发的请求，记录返回数据的结构：字段名、数组长度、是否包含划线文字（markText）、是否带时间（createTime）。
 * 安全：本脚本自己不发任何请求，只是旁观；不读取 Cookie；报告里地址中的书籍编号等长串会被隐去，不含任何划线内容。
 * 用法：在微信读书网页版的「阅读页」运行，然后打开阅读页里的「笔记」面板。
 */
(() => {
  'use strict';

  if (!/(^|\.)weread\.qq\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) {
    alert('请先在 https://weread.qq.com 打开一本书的阅读页，再运行本脚本。');
    return;
  }
  if (window.__rsNetProbe) { window.__rsNetProbe.stop(); }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 地址脱敏：记录所有 http(s) 请求（排除图片、样式、脚本、字体等静态文件）；
  // 长串路径段（书籍编号等）替换为 …；查询参数只保留参数名
  const STATIC_RE = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|otf|mp3|mp4)$/i;
  function norm(url) {
    let u;
    try { u = new URL(url, location.href); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (STATIC_RE.test(u.pathname)) return null;
    const path = u.pathname.split('/').map((s) => (s.length >= 16 || /^\d{6,}$/.test(s) ? '…' : s)).join('/');
    const params = [...new Set(u.searchParams.keys())].join('&');
    const hostPart = u.host === location.host ? '' : u.host;
    return hostPart + path + (params ? '?' + params : '');
  }

  // 只分析结构，不保留内容
  function analyze(text) {
    const out = { size: text.length, json: false, keys: [], arrays: [], markText: 0, createTime: 0, abstract: 0 };
    out.markText = (text.match(/"markText"/g) || []).length;
    out.createTime = (text.match(/"createTime"/g) || []).length;
    out.abstract = (text.match(/"abstract"/g) || []).length;
    let j;
    try { j = JSON.parse(text); } catch (e) { return out; }
    out.json = true;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      out.keys = Object.keys(j).slice(0, 20);
      const scan = (obj, prefix, depth) => {
        for (const [k, v] of Object.entries(obj)) {
          if (Array.isArray(v)) {
            const first = v.find((x) => x && typeof x === 'object');
            out.arrays.push(`${prefix}${k}[${v.length}]${first ? '{' + Object.keys(first).slice(0, 12).join(',') + '}' : ''}`);
          } else if (v && typeof v === 'object' && depth < 2) {
            scan(v, prefix + k + '.', depth + 1);
          }
        }
      };
      scan(j, '', 0);
    }
    return out;
  }

  const records = new Map(); // key: METHOD path
  const before = [];          // 运行前已发生的请求（只有地址）
  const diag = { resources: 0, fetchXhr: 0, beacon: 0 };
  function record(method, url, status, text) {
    const p = norm(url);
    if (!p) return;
    const key = `${(method || 'GET').toUpperCase()} ${p}`;
    const a = typeof text === 'string' ? analyze(text) : null;
    const old = records.get(key);
    const rec = old || { key, times: 0, status, a };
    rec.times++;
    rec.status = status;
    // 同一地址多次请求时，保留「划线最多 / 内容最大」的那次结构
    if (a && (!rec.a || a.markText > rec.a.markText || (a.markText === rec.a.markText && a.size > rec.a.size))) rec.a = a;
    records.set(key, rec);
    scheduleRender();
  }

  /* ---------- 运行前已经发过的请求（来自浏览器性能记录，只有地址和大小） ---------- */
  try {
    for (const e of performance.getEntriesByType('resource')) {
      diag.resources++;
      if (e.initiatorType === 'beacon') diag.beacon++;
      if (e.initiatorType !== 'fetch' && e.initiatorType !== 'xmlhttprequest') continue;
      diag.fetchXhr++;
      const p = norm(e.name);
      if (p && !before.some((b) => b.p === p)) before.push({ p, size: e.decodedBodySize || e.transferSize || 0 });
    }
  } catch (e) { /* 忽略 */ }

  /* ---------- 旁观之后的请求 ---------- */
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const method = (init && init.method) || (input && input.method) || 'GET';
      if (norm(url)) res.clone().text().then((t) => record(method, url, res.status, t)).catch(() => {});
    } catch (e) { /* 忽略 */ }
    return res;
  };
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;
  XHR.open = function (m, u) { this.__rs = { m, u }; return origOpen.apply(this, arguments); };
  XHR.send = function () {
    const info = this.__rs;
    if (info && norm(info.u)) {
      this.addEventListener('loadend', () => {
        try {
          let t = null;
          if (this.responseType === '' || this.responseType === 'text') t = this.responseText;
          else if (this.responseType === 'json') t = JSON.stringify(this.response);
          record(info.m, info.u, this.status, t);
        } catch (e) { /* 忽略 */ }
      });
    }
    return origSend.apply(this, arguments);
  };
  // 兜底：有些请求可能绕过了上面的拦截，用性能记录补上地址
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.initiatorType !== 'fetch' && e.initiatorType !== 'xmlhttprequest') continue;
        const p = norm(e.name);
        if (!p) continue;
        const known = [...records.keys()].some((k) => k.endsWith(' ' + p));
        if (!known) { records.set('? ' + p, { key: '? ' + p, times: 1, status: '?', a: null, size: e.decodedBodySize || 0 }); scheduleRender(); }
      }
    });
    observer.observe({ type: 'resource', buffered: false });
  } catch (e) { /* 忽略 */ }

  function stop() {
    window.fetch = origFetch;
    XHR.open = origOpen;
    XHR.send = origSend;
    if (observer) observer.disconnect();
    host.remove();
    delete window.__rsNetProbe;
  }
  window.__rsNetProbe = { stop };

  /* ---------- 面板 ---------- */
  const old = document.getElementById('__rs_probe');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = '__rs_probe';
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    .box{width:min(600px,calc(100vw - 32px));max-height:60vh;overflow:auto;background:#FFFDF8;color:#2A2924;
      border:1px solid #E6DFCF;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
    header{position:sticky;top:0;background:#2F5241;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}
    header button{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer}
    .body{padding:10px 14px 14px} h3{font-size:13.5px;margin:12px 0 4px;color:#2F5241}
    .tip{background:#F5F1E8;border-radius:8px;padding:8px 10px} .st{color:#857F72;font-size:12px}
    .hit{background:#E3EBE4;border-radius:8px;padding:6px 8px;margin:4px 0} .row{border-bottom:1px solid #EEE7D8;padding:4px 0}
    code{font-size:11.5px;word-break:break-all} .ok{color:#2F7A4B;font-weight:600}
    .btns{display:flex;gap:8px;margin-top:12px} .btns button{flex:1;padding:8px;border-radius:9px;border:1px solid #2F5241;background:#2F5241;color:#fff;cursor:pointer}
    .btns button.ghost{background:#fff;color:#2F5241}
  </style>
  <div class="box"><header><b>微信读书请求记录器（只读）</b><button id="x" title="关闭并还原">×</button></header>
  <div class="body">
    <div class="tip">现在请在阅读页里<b>打开「笔记」面板</b>（阅读页右侧工具栏的笔记图标），列表加载出来后，再<b>翻一两章</b>。<br>
    出现绿色的「发现划线数据」后，点下面的「复制记录」发给 Claude。<br><span class="st">如果页面整体刷新，面板会消失，需要重新运行脚本。</span></div>
    <div id="out"></div>
    <div class="btns"><button id="c1">复制记录</button><button id="stop" class="ghost">停止并关闭</button></div>
  </div></div>`;
  root.getElementById('x').onclick = stop;
  root.getElementById('stop').onclick = stop;

  let timer = null;
  function scheduleRender() { clearTimeout(timer); timer = setTimeout(render, 200); }
  function render() {
    const list = [...records.values()];
    const hits = list.filter((r) => r.a && r.a.markText > 0).sort((a, b) => b.a.markText - a.a.markText);
    const rest = list.filter((r) => !(r.a && r.a.markText > 0));
    const desc = (r) => r.a
      ? `${r.status} · ${r.a.size}B · ${r.a.json ? 'JSON' : '非 JSON'}${r.a.markText ? ` · <span class="ok">划线 ${r.a.markText} 条</span>` : ''}${r.a.createTime ? ` · createTime ${r.a.createTime}` : ''}${r.a.keys.length ? `<br><span class="st">keys: ${esc(r.a.keys.join(','))}</span>` : ''}${r.a.arrays.length ? `<br><span class="st">arrays: ${esc(r.a.arrays.join(' ; '))}</span>` : ''}`
      : `<span class="st">${r.status === '?' ? '未能读取内容' : '无内容'}</span>`;
    root.getElementById('out').innerHTML = `
      ${hits.length ? `<h3 class="ok">发现划线数据 ✓</h3>${hits.map((r) => `<div class="hit"><code>${esc(r.key)}</code> ×${r.times}<br>${desc(r)}</div>`).join('')}` : '<h3>还没有发现划线数据</h3><div class="st">请打开笔记面板；如果已经打开，试着关掉再打开，或翻到有划线的章节。</div>'}
      <h3>之后发生的其他请求（${rest.length}）</h3>
      ${rest.map((r) => `<div class="row"><code>${esc(r.key)}</code> ×${r.times}<br>${desc(r)}</div>`).join('') || '<div class="st">暂无</div>'}
      <h3>运行脚本前已发生的请求（${before.length}，只有地址）</h3>
      <div class="st">浏览器性能记录：共 ${diag.resources} 条资源，其中 fetch/xhr ${diag.fetchXhr} 条</div>
      ${before.map((b) => `<div class="row"><code>${esc(b.p)}</code> <span class="st">${b.size}B</span></div>`).join('') || '<div class="st">无</div>'}`;
  }
  function report() {
    const L = ['【微信读书请求记录 · 第三版】（已脱敏，只有地址和结构）', `时间：${new Date().toLocaleString()} · 页面：${norm(location.href) || location.pathname.replace(/\/[^/]{16,}/g, '/…')}`, ''];
    const list = [...records.values()].sort((a, b) => ((b.a && b.a.markText) || 0) - ((a.a && a.a.markText) || 0));
    L.push('== 运行后的请求 ==');
    list.forEach((r) => {
      L.push(`${r.key} ×${r.times} status=${r.status}${r.a ? ` size=${r.a.size} json=${r.a.json} markText=${r.a.markText} createTime=${r.a.createTime} abstract=${r.a.abstract}` : ''}`);
      if (r.a && r.a.keys.length) L.push(`   keys: ${r.a.keys.join(',')}`);
      if (r.a && r.a.arrays.length) L.push(`   arrays: ${r.a.arrays.join(' ; ')}`);
    });
    L.push('');
    L.push(`== 运行前已发生的请求 == （性能记录共 ${diag.resources} 条，fetch/xhr ${diag.fetchXhr} 条，beacon ${diag.beacon} 条）`);
    before.forEach((b) => L.push(`${b.p} size=${b.size}`));
    return L.join('\n');
  }
  root.getElementById('c1').onclick = async (e) => {
    const btn = e.currentTarget;
    const text = report();
    try { await navigator.clipboard.writeText(text); }
    catch (err) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.textContent = '复制记录'; }, 1500);
  };
  render();
  console.log('[阅读空间] 请求记录器已启动；关闭面板即还原。');
})();
