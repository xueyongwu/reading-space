/*
 * 微信读书笔记探测脚本（只读试跑 · 第二版）
 *
 * 第一版发现：书架、进度、阅读时长都能拿到；但抽查的书划线 / 想法都是空的，无法判断是「那几本书本来没笔记」还是「接口变了」。
 * 这一版：挑笔记数最多的 3 本书，对比「笔记本列表登记的条数」与「接口实际返回的条数」，并尝试几种参数写法。
 * 安全：只发 GET 请求，不修改任何内容；不读取 Cookie；结果只显示在当前页面。
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

  /* ---------- 面板 ---------- */
  const old = document.getElementById('__rs_probe');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = '__rs_probe';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    .box{width:min(580px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#FFFDF8;color:#2A2924;
      border:1px solid #E6DFCF;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
    header{position:sticky;top:0;background:#2F5241;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
    header button{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer}
    .body{padding:12px 16px 16px} h3{font-size:14px;margin:14px 0 6px;color:#2F5241}
    .st{color:#857F72;font-size:13px} .ok{color:#2F7A4B;font-weight:600} .bad{color:#A6473B;font-weight:600}
    table{width:100%;border-collapse:collapse;font-size:12.5px} td,th{border-bottom:1px solid #EEE7D8;padding:4px;text-align:left;vertical-align:top}
    code{font-size:11.5px;background:#F0EADC;padding:0 3px;border-radius:4px;word-break:break-all}
    .sample{background:#F5F1E8;border-radius:8px;padding:6px 8px;margin:4px 0;font-size:12.5px}
    .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px} .btns button{flex:1;min-width:150px;padding:9px 10px;border-radius:9px;border:1px solid #2F5241;
      background:#2F5241;color:#fff;cursor:pointer;font-size:13px} .btns button.ghost{background:#fff;color:#2F5241}
  </style>
  <div class="box"><header><b>微信读书笔记探测 · 第二版（只读）</b><button id="x">×</button></header><div class="body" id="body"><div class="st" id="status">准备中…</div></div></div>`;
  root.getElementById('x').onclick = () => host.remove();
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

  /* ---------- 1. 找笔记最多的书 ---------- */
  setStatus('正在读取笔记本列表…');
  const [nbRec, nb] = await get('/api/user/notebook');
  if (!nb || !Array.isArray(nb.books)) {
    root.getElementById('body').innerHTML = `<p class="bad">读取笔记本列表失败：${esc(nbRec.error || '未知错误')}</p><p>请确认已登录，刷新页面后再运行。</p>`;
    return;
  }
  const all = nb.books.map((b) => ({
    bookId: b.bookId,
    title: (b.book && b.book.title) || b.title || '',
    noteCount: b.noteCount || 0,
    reviewCount: b.reviewCount || 0,
    bookmarkCount: b.bookmarkCount || 0,
  }));
  const dist = {
    books: all.length,
    withNote: all.filter((b) => b.noteCount > 0).length,
    withReview: all.filter((b) => b.reviewCount > 0).length,
    withBookmark: all.filter((b) => b.bookmarkCount > 0).length,
    noteSum: all.reduce((s, b) => s + b.noteCount, 0),
    reviewSum: all.reduce((s, b) => s + b.reviewCount, 0),
    bookmarkSum: all.reduce((s, b) => s + b.bookmarkCount, 0),
  };
  const targets = all.slice().sort((a, b) => (b.noteCount + b.reviewCount) - (a.noteCount + a.reviewCount)).filter((b) => b.noteCount + b.reviewCount > 0).slice(0, MAX_BOOKS);

  /* ---------- 2. 对每本书尝试几种写法 ---------- */
  const HL_VARIANTS = [
    (id) => `/web/book/bookmarklist?bookId=${id}`,
    (id) => `/web/book/bookmarklist?bookId=${id}&synckey=0`,
    (id) => `/web/book/bookmarklist?bookId=${id}&type=1`,
  ];
  const RV_VARIANTS = [
    (id) => `/web/review/list?bookId=${id}&listType=11&mine=1&synckey=0`,
    (id) => `/web/review/list?bookId=${id}&listType=11&mine=1&synckey=0&listMode=0&count=100`,
    (id) => `/web/review/list?bookId=${id}&listType=4&mine=1&synckey=0`,
  ];
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const id = encodeURIComponent(t.bookId);
    const r = { ...t, hl: [], rv: [], hlSamples: [], rvSamples: [] };
    for (let k = 0; k < HL_VARIANTS.length; k++) {
      setStatus(`第 ${i + 1}/${targets.length} 本 · 划线写法 ${k + 1}`);
      const [rec, j] = await get(HL_VARIANTS[k](id));
      const list = j && Array.isArray(j.updated) ? j.updated : [];
      rec.count = list.length;
      rec.withTime = list.filter((x) => typeof x.createTime === 'number').length;
      rec.fields = list[0] ? Object.keys(list[0]) : [];
      rec.chapters = j && Array.isArray(j.chapters) ? j.chapters.length : 0;
      r.hl.push(rec);
      if (list.length && !r.hlSamples.length) {
        const ch = new Map((j.chapters || []).map((c) => [c.chapterUid, c.title]));
        r.hlSamples = list.slice(0, 2).map((x) => ({ chapter: ch.get(x.chapterUid) || '', text: x.markText, date: toDate(x.createTime) }));
      }
      if (list.length) break; // 找到能用的写法就不再试
    }
    for (let k = 0; k < RV_VARIANTS.length; k++) {
      setStatus(`第 ${i + 1}/${targets.length} 本 · 想法写法 ${k + 1}`);
      const [rec, j] = await get(RV_VARIANTS[k](id));
      const list = j && Array.isArray(j.reviews) ? j.reviews.map((x) => x.review || x) : [];
      rec.count = list.length;
      rec.totalCount = j ? j.totalCount : undefined;
      rec.hasMore = j ? j.hasMore : undefined;
      rec.types = [...new Set(list.map((x) => x.type))].join('/');
      rec.withTime = list.filter((x) => typeof x.createTime === 'number').length;
      rec.fields = list[0] ? Object.keys(list[0]) : [];
      r.rv.push(rec);
      if (list.length && !r.rvSamples.length) {
        r.rvSamples = list.slice(0, 2).map((x) => ({ chapter: x.chapterName || '', quote: x.abstract || '', text: x.content || '', date: toDate(x.createTime), type: x.type }));
      }
      if (list.length) break;
    }
    results.push(r);
  }

  /* ---------- 3. 结论 ---------- */
  const hlWorks = results.some((r) => r.hl.some((h) => h.count > 0));
  const rvWorks = results.some((r) => r.rv.some((h) => h.count > 0));
  const hlTimed = results.some((r) => r.hl.some((h) => h.withTime > 0));
  const expectHl = targets.some((t) => t.noteCount > 0);
  const expectRv = targets.some((t) => t.reviewCount > 0);
  const verdict = (works, expect) => works ? '<span class="ok">✓ 能拿到</span>' : expect ? '<span class="bad">✗ 有笔记但接口返回空，接口可能变了</span>' : '<span class="st">这几本书本来就没有</span>';

  const rowsOf = (list) => list.map((h) => `<tr><td><code>${esc(h.path)}</code></td><td>${h.http ?? '-'}</td><td>${h.error ? `<span class="bad">${esc(h.error)}</span>` : `${h.count} 条${h.totalCount !== undefined ? ` / total ${h.totalCount}` : ''}${h.withTime ? ` · 带时间 ${h.withTime}` : ''}`}</td><td class="st">${h.size ?? ''}B · ${esc((h.keys || []).join(',') || '空对象')}</td></tr>`).join('');

  root.getElementById('body').innerHTML = `
    <h3>结论</h3>
    <table>
      <tr><td>划线</td><td>${verdict(hlWorks, expectHl)}</td></tr>
      <tr><td>划线带时间</td><td>${hlWorks ? (hlTimed ? '<span class="ok">✓ 带时间</span>' : '<span class="bad">✗ 不带时间</span>') : '—'}</td></tr>
      <tr><td>想法</td><td>${verdict(rvWorks, expectRv)}</td></tr>
    </table>
    <h3>笔记本列表登记的数量</h3>
    <div class="st">共 ${dist.books} 本 · 有划线(noteCount) ${dist.withNote} 本共 ${dist.noteSum} 条 · 有想法(reviewCount) ${dist.withReview} 本共 ${dist.reviewSum} 条 · 有书签(bookmarkCount) ${dist.withBookmark} 本共 ${dist.bookmarkSum} 条</div>
    ${results.map((r) => `
      <h3>${esc(cut(r.title, 24))}</h3>
      <div class="st">登记：noteCount ${r.noteCount} · reviewCount ${r.reviewCount} · bookmarkCount ${r.bookmarkCount}</div>
      <table>${rowsOf(r.hl)}${rowsOf(r.rv)}</table>
      ${r.hlSamples.map((s) => `<div class="sample">【划线】${esc(cut(s.chapter, 20))} · ${s.date}<br>${esc(cut(s.text, 80))}</div>`).join('')}
      ${r.rvSamples.map((s) => `<div class="sample">【想法 type=${s.type}】${esc(cut(s.chapter, 20))} · ${s.date}<br>${esc(cut(s.text, 80))}${s.quote ? `<br><span class="st">原文：${esc(cut(s.quote, 60))}</span>` : ''}</div>`).join('')}`).join('')}
    ${targets.length ? '' : '<p class="bad">笔记本列表里没有任何书登记了划线或想法。</p>'}
    <div class="btns"><button id="c1">复制诊断报告（不含书名和内容）</button><button id="c2" class="ghost">复制含样本的报告</button></div>`;

  function report(withContent) {
    const L = ['【微信读书笔记探测 · 第二版】' + (withContent ? '（含样本）' : '（已脱敏）'), `时间：${new Date().toLocaleString()}`, ''];
    L.push(`结论：划线=${hlWorks ? 'ok' : expectHl ? 'EMPTY' : 'none'} 划线带时间=${hlTimed ? 'ok' : '-'} 想法=${rvWorks ? 'ok' : expectRv ? 'EMPTY' : 'none'}`);
    L.push(`笔记本：${dist.books} 本 · noteCount ${dist.withNote}本/${dist.noteSum}条 · reviewCount ${dist.withReview}本/${dist.reviewSum}条 · bookmarkCount ${dist.withBookmark}本/${dist.bookmarkSum}条 · 列表字段 ${nbRec.keys ? nbRec.keys.join(',') : ''}`);
    results.forEach((r, i) => {
      L.push('');
      L.push(`#${i + 1}${withContent ? ' ' + cut(r.title, 30) : ''} 登记 note=${r.noteCount} review=${r.reviewCount} bookmark=${r.bookmarkCount}`);
      [...r.hl, ...r.rv].forEach((h) => L.push(`  ${h.ok ? 'OK ' : 'ERR'} ${h.path} http=${h.http ?? '-'} size=${h.size ?? '-'} ${h.error || ''} count=${h.count}${h.totalCount !== undefined ? ' total=' + h.totalCount : ''}${h.hasMore !== undefined ? ' hasMore=' + h.hasMore : ''} withTime=${h.withTime} keys=${(h.keys || []).join(',') || '{}'}${h.fields && h.fields.length ? ' fields=' + h.fields.join(',') : ''}${h.types ? ' types=' + h.types : ''}`));
      if (withContent) {
        r.hlSamples.forEach((s) => L.push(`  [划线] ${s.date} ${cut(s.chapter, 20)} | ${cut(s.text, 60)}`));
        r.rvSamples.forEach((s) => L.push(`  [想法 type=${s.type}] ${s.date} ${cut(s.chapter, 20)} | ${cut(s.text, 60)} | 原文:${cut(s.quote, 40)}`));
      }
    });
    return L.join('\n');
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    const t = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = t; }, 1500);
  }
  root.getElementById('c1').onclick = (e) => copy(report(false), e.currentTarget);
  root.getElementById('c2').onclick = (e) => copy(report(true), e.currentTarget);
  console.log('[阅读空间] 笔记探测完成', { dist, results });
})();
