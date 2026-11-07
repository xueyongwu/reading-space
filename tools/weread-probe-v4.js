/*
 * 微信读书划线探测（只读试跑 · 第四版）
 *
 * 第三版旁观发现：网页自己请求划线用的是 /web/book/bookmarklist?bookId=…&syncKey=…（syncKey 大写 K），返回约 32KB；
 * 我们之前用小写 synckey 或不带参数，只拿到 {}。另有 /web/book/readInfo 可能包含阅读统计。
 * 这一版：按网页的写法请求笔记最多的 3 本书的划线，并看一眼 readInfo 的结构。
 * 安全：只发读取请求，不修改任何内容；不读取 Cookie；诊断报告不含书名和划线内容。
 * 用法：在已登录的 weread.qq.com 任意页面运行（不需要在阅读页，也不需要关断点）。
 */
(async () => {
  'use strict';

  if (!/(^|\.)weread\.qq\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) {
    alert('请先打开 https://weread.qq.com 并登录，再在那个页面运行本脚本。');
    return;
  }

  const MAX_BOOKS = 3;
  const DELAY_MS = 400;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cut = (s, n = 60) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const toDate = (ts) => {
    if (!ts || typeof ts !== 'number') return '';
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return isNaN(d) ? '' : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* ---------- 面板：左下角，可收起 ---------- */
  if (window.__rsNetProbe) window.__rsNetProbe.stop();
  const old = document.getElementById('__rs_probe');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = '__rs_probe';
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    .box{width:min(520px,calc(100vw - 32px));max-height:60vh;overflow:auto;background:#FFFDF8;color:#2A2924;
      border:1px solid #E6DFCF;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
    .box.min{max-height:none;width:auto} .box.min .body{display:none}
    header{position:sticky;top:0;background:#2F5241;color:#fff;padding:8px 12px;display:flex;gap:8px;justify-content:space-between;align-items:center}
    header button{background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;padding:0 4px}
    .body{padding:10px 14px 14px} h3{font-size:13.5px;margin:12px 0 4px;color:#2F5241}
    .st{color:#857F72;font-size:12px} .ok{color:#2F7A4B;font-weight:600} .bad{color:#A6473B;font-weight:600}
    .row{border-bottom:1px solid #EEE7D8;padding:4px 0} code{font-size:11.5px;word-break:break-all}
    .sample{background:#F5F1E8;border-radius:8px;padding:6px 8px;margin:4px 0}
    .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px} .btns button{flex:1;min-width:140px;padding:8px;border-radius:9px;border:1px solid #2F5241;background:#2F5241;color:#fff;cursor:pointer}
    .btns button.ghost{background:#fff;color:#2F5241}
  </style>
  <div class="box" id="box"><header><b>微信读书划线探测 · 第四版（只读）</b><span><button id="min" title="收起/展开">—</button><button id="x" title="关闭">×</button></span></header>
  <div class="body" id="body"><div class="st" id="status">准备中…</div></div></div>`;
  root.getElementById('x').onclick = () => host.remove();
  root.getElementById('min').onclick = () => root.getElementById('box').classList.toggle('min');
  const setStatus = (t) => { const s = root.getElementById('status'); if (s) s.textContent = t; };

  /* ---------- 请求 ---------- */
  async function get(path) {
    const rec = { path: path.replace(/bookId=[^&]+/, 'bookId=…'), ok: false };
    try {
      const res = await fetch(path, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
      rec.http = res.status;
      const text = await res.text();
      rec.size = text.length;
      let json;
      try { json = JSON.parse(text); } catch (e) { rec.error = '不是 JSON'; return [rec, null]; }
      const code = json.errcode ?? json.errCode;
      if (code !== undefined && code !== 0) { rec.error = `errcode ${code} ${json.errmsg || json.errMsg || ''}`.trim(); return [rec, null]; }
      rec.ok = res.ok;
      rec.keys = Object.keys(json);
      return [rec, json];
    } catch (e) {
      rec.error = String((e && e.message) || e);
      return [rec, null];
    } finally {
      await sleep(DELAY_MS);
    }
  }
  // 只描述结构：字段名、数组长度、首项字段
  function shape(j) {
    const out = [];
    const scan = (obj, prefix, depth) => {
      for (const [k, v] of Object.entries(obj || {})) {
        if (Array.isArray(v)) {
          const first = v.find((x) => x && typeof x === 'object');
          out.push(`${prefix}${k}[${v.length}]${first ? '{' + Object.keys(first).slice(0, 14).join(',') + '}' : ''}`);
        } else if (v && typeof v === 'object' && depth < 2) scan(v, prefix + k + '.', depth + 1);
        else if (depth < 2) out.push(`${prefix}${k}:${typeof v}`);
      }
    };
    scan(j, '', 0);
    return out;
  }

  /* ---------- 网页自己用过的参数（从浏览器性能记录里取，只取参数名和 syncKey 之类的值） ---------- */
  const seenParams = {};
  try {
    for (const e of performance.getEntriesByType('resource')) {
      for (const name of ['bookmarklist', 'readInfo']) {
        if (e.name.includes('/web/book/' + name + '?') && !seenParams[name]) {
          const u = new URL(e.name);
          u.searchParams.delete('bookId');
          seenParams[name] = u.searchParams.toString();
        }
      }
    }
  } catch (e) { /* 忽略 */ }

  /* ---------- 1. 找划线最多的书 ---------- */
  setStatus('正在读取笔记本列表…');
  const [nbRec, nb] = await get('/api/user/notebook');
  if (!nb || !Array.isArray(nb.books)) {
    root.getElementById('body').innerHTML = `<p class="bad">读取笔记本列表失败：${esc(nbRec.error || '未知错误')}</p><p>请确认已登录，刷新页面后再运行。</p>`;
    return;
  }
  const targets = nb.books
    .map((b) => ({ bookId: b.bookId, title: (b.book && b.book.title) || '', noteCount: b.noteCount || 0 }))
    .filter((b) => b.noteCount > 0)
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, MAX_BOOKS);

  /* ---------- 2. 按网页的写法取划线 ---------- */
  const variants = [(id) => `/web/book/bookmarklist?bookId=${id}&syncKey=0`];
  if (seenParams.bookmarklist && seenParams.bookmarklist !== 'syncKey=0') variants.push((id) => `/web/book/bookmarklist?bookId=${id}&${seenParams.bookmarklist}`);
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const r = { ...t, tries: [], samples: [] };
    for (let k = 0; k < variants.length; k++) {
      setStatus(`第 ${i + 1}/${targets.length} 本 · 写法 ${k + 1}`);
      const [rec, j] = await get(variants[k](encodeURIComponent(t.bookId)));
      const list = j && Array.isArray(j.updated) ? j.updated : [];
      rec.count = list.length;
      rec.withTime = list.filter((x) => typeof x.createTime === 'number').length;
      rec.fields = list[0] ? Object.keys(list[0]) : [];
      rec.shape = j ? shape(j).slice(0, 12) : [];
      if (list.length) {
        const times = list.map((x) => x.createTime).filter((x) => typeof x === 'number');
        rec.range = times.length ? `${toDate(Math.min(...times))} ~ ${toDate(Math.max(...times))}` : '';
        const ch = new Map((j.chapters || []).map((c) => [c.chapterUid, c.title]));
        rec.chapterTitles = list.filter((x) => ch.has(x.chapterUid)).length;
        r.samples = list.slice(0, 2).map((x) => ({ chapter: ch.get(x.chapterUid) || '', text: x.markText, date: toDate(x.createTime) }));
      }
      r.tries.push(rec);
      if (list.length) break;
    }
    results.push(r);
  }

  /* ---------- 3. readInfo 的结构（看看有没有按天的阅读数据） ---------- */
  let readInfo = null;
  if (targets[0]) {
    setStatus('正在查看 readInfo…');
    const id = encodeURIComponent(targets[0].bookId);
    const path = seenParams.readInfo ? `/web/book/readInfo?bookId=${id}&${seenParams.readInfo}` : `/web/book/readInfo?bookId=${id}`;
    const [rec, j] = await get(path);
    readInfo = { rec, shape: j ? shape(j).slice(0, 40) : [] };
    const text = j ? JSON.stringify(j) : '';
    readInfo.dateLike = (text.match(/"\w*(Time|Date|time|date)\w*"\s*:/g) || []).map((s) => s.replace(/[":\s]/g, '')).filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
  }

  /* ---------- 4. 展示 ---------- */
  const works = results.some((r) => r.tries.some((x) => x.count > 0));
  const timed = results.some((r) => r.tries.some((x) => x.withTime > 0));
  const matchAll = results.length && results.every((r) => r.tries.some((x) => x.count >= r.noteCount * 0.9));
  root.getElementById('body').innerHTML = `
    <h3>结论</h3>
    <div class="row">划线：${works ? '<span class="ok">✓ 能拿到</span>' : '<span class="bad">✗ 仍然拿不到</span>'}　带时间：${timed ? '<span class="ok">✓</span>' : '—'}　条数与登记一致：${works ? (matchAll ? '<span class="ok">✓</span>' : '<span class="bad">有出入</span>') : '—'}</div>
    <div class="st">网页用过的参数：bookmarklist ${esc(seenParams.bookmarklist || '（未发现）')} · readInfo ${esc(seenParams.readInfo || '（未发现）')}</div>
    ${results.map((r) => `
      <h3>${esc(cut(r.title, 24))}　<span class="st">登记划线 ${r.noteCount} 条</span></h3>
      ${r.tries.map((x) => `<div class="row"><code>${esc(x.path)}</code><br>${x.error ? `<span class="bad">${esc(x.error)}</span>` : `${x.count} 条 · 带时间 ${x.withTime}${x.range ? ' · ' + x.range : ''} · ${x.size}B`}</div>`).join('')}
      ${r.samples.map((s) => `<div class="sample">${esc(cut(s.chapter, 20))} · ${s.date}<br>${esc(cut(s.text, 80))}</div>`).join('')}`).join('')}
    ${readInfo ? `<h3>readInfo 结构</h3><div class="row">${readInfo.rec.error ? `<span class="bad">${esc(readInfo.rec.error)}</span>` : `${readInfo.rec.size}B`}<br><span class="st">${esc(readInfo.shape.join(' ; '))}</span></div>` : ''}
    <div class="btns"><button id="c1">复制诊断报告（不含书名和内容）</button><button id="c2" class="ghost">复制含样本的报告</button></div>`;

  function report(withContent) {
    const L = ['【微信读书划线探测 · 第四版】' + (withContent ? '（含样本）' : '（已脱敏）'), `时间：${new Date().toLocaleString()}`, ''];
    L.push(`结论：划线=${works ? 'ok' : 'EMPTY'} 带时间=${timed ? 'ok' : '-'} 条数一致=${works ? (matchAll ? 'ok' : 'diff') : '-'}`);
    L.push(`网页参数：bookmarklist=${seenParams.bookmarklist || '-'} readInfo=${seenParams.readInfo || '-'}`);
    results.forEach((r, i) => {
      L.push('');
      L.push(`#${i + 1}${withContent ? ' ' + cut(r.title, 30) : ''} 登记 note=${r.noteCount}`);
      r.tries.forEach((x) => {
        L.push(`  ${x.ok ? 'OK ' : 'ERR'} ${x.path} http=${x.http ?? '-'} size=${x.size ?? '-'} ${x.error || ''} count=${x.count} withTime=${x.withTime} chapterTitles=${x.chapterTitles ?? '-'}${withContent && x.range ? ' range=' + x.range : ''}`);
        if (x.fields.length) L.push(`     fields: ${x.fields.join(',')}`);
        if (x.shape.length) L.push(`     shape: ${x.shape.join(' ; ')}`);
      });
      if (withContent) r.samples.forEach((s) => L.push(`  [划线] ${s.date} ${cut(s.chapter, 20)} | ${cut(s.text, 60)}`));
    });
    if (readInfo) {
      L.push('');
      L.push(`readInfo: ${readInfo.rec.ok ? 'OK' : 'ERR'} http=${readInfo.rec.http ?? '-'} size=${readInfo.rec.size ?? '-'} ${readInfo.rec.error || ''}`);
      L.push(`  shape: ${readInfo.shape.join(' ; ')}`);
      L.push(`  时间类字段: ${readInfo.dateLike.join(',')}`);
    }
    return L.join('\n');
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    const t = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = t; }, 1500);
  }
  root.getElementById('c1').onclick = (e) => copy(report(false), e.currentTarget);
  root.getElementById('c2').onclick = (e) => copy(report(true), e.currentTarget);
})();
