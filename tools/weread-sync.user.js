// ==UserScript==
// @name         微信读书 → 我的阅读空间
// @namespace    https://xueyongwu.github.io/reading-space/
// @version      1.1.0
// @description  在微信读书阅读页加一个「同步到阅读空间」按钮：读取书架进度、读完时间、累计时长和划线，复制后到手机工作台导入。
// @match        https://weread.qq.com/*
// @grant        none
// @sandbox      raw
// @run-at       document-idle
// @noframes
// @updateURL    https://xueyongwu.github.io/reading-space/tools/weread-sync.user.js
// @downloadURL  https://xueyongwu.github.io/reading-space/tools/weread-sync.user.js
// ==/UserScript==
/*
 * 微信读书 → 我的阅读空间 同步脚本
 *
 * 推荐用法（油猴脚本，装一次以后一键同步）：
 *   1. 电脑浏览器安装 Tampermonkey 扩展；
 *   2. 打开 https://xueyongwu.github.io/reading-space/tools/weread-sync.user.js ，点「安装」；
 *   3. 在微信读书打开任意一本书（阅读页），点左下角「同步到阅读空间」，数据会复制到剪贴板；
 *   4. iPhone 上打开工作台 → 设置 →「从剪贴板导入」（Mac 与 iPhone 需登录同一 Apple ID 并开启「接力」）。
 *
 * 也可以不装扩展：在阅读页打开控制台，粘贴本文件全部内容回车，效果相同。
 *   如果页面卡在「Paused in debugger」，按 Cmd/Ctrl+F8 停用断点，再按 F8 继续。
 *
 * 读取内容：书架（书名/作者/封面/分类/是否读完）、进度百分比、开始/读完时间、累计阅读时长、划线（文字/章节/时间）。
 * 只导入「有进度、已读完或有划线」的书。
 * 安全：只发读取请求，不修改微信读书里的任何内容；不读取 Cookie；数据只在你复制或下载时交给你。
 * 注意：使用的是微信读书网页版的非公开接口，它改版后本脚本可能失效。
 */
(() => {
  'use strict';
  if (window.__rsSyncLoaded && typeof GM_info !== 'undefined') return;
  window.__rsSyncLoaded = true;

  const DELAY_MS = 300;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cut = (s, n = 40) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const pad = (n) => String(n).padStart(2, '0');
  const tsMs = (ts) => (typeof ts === 'number' && ts > 0 ? (ts > 1e12 ? ts : ts * 1000) : 0);
  const toDate = (ts) => { const ms = tsMs(ts); if (!ms) return null; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const toISO = (ts) => { const ms = tsMs(ts); return ms ? new Date(ms).toISOString() : null; };

  const isReader = () => location.pathname.startsWith('/web/reader/');

  /* 主流程：读取数据并显示面板 */
  async function runSync() {
    /* ---------- 面板（左下角，可收起） ---------- */
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
      .box{width:min(520px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#FFFDF8;color:#2A2924;
        border:1px solid #E6DFCF;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
      .box.min{max-height:none;width:auto} .box.min .body{display:none}
      header{position:sticky;top:0;background:#2F5241;color:#fff;padding:8px 12px;display:flex;gap:8px;justify-content:space-between;align-items:center}
      header button{background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;padding:0 4px}
      .body{padding:10px 14px 14px} h3{font-size:13.5px;margin:12px 0 4px;color:#2F5241}
      .st{color:#857F72;font-size:12px} .ok{color:#2F7A4B;font-weight:600} .bad{color:#A6473B;font-weight:600} .warn{color:#A8844E}
      table{width:100%;border-collapse:collapse;font-size:12.5px} td,th{border-bottom:1px solid #EEE7D8;padding:4px;text-align:left}
      .sum{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;margin:6px 0}
      .sum div{background:#F5F1E8;border-radius:8px;padding:6px 2px} .sum b{display:block;font-size:18px;color:#2F5241}
      .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px} .btns button{flex:1;min-width:140px;padding:9px;border-radius:9px;border:1px solid #2F5241;background:#2F5241;color:#fff;cursor:pointer;font-size:13px}
      .btns button.ghost{background:#fff;color:#2F5241}
    </style>
    <div class="box" id="box"><header><b>微信读书 → 我的阅读空间</b><span><button id="min" title="收起/展开">—</button><button id="x" title="关闭">×</button></span></header>
    <div class="body" id="body"><div class="st" id="status">准备中…</div></div></div>`;
    root.getElementById('x').onclick = () => { host.remove(); showLauncher(); };
    root.getElementById('min').onclick = () => root.getElementById('box').classList.toggle('min');
    const body = root.getElementById('body');
    const setStatus = (t) => { const s = root.getElementById('status'); if (s) s.textContent = t; };
    const fail = (html) => { body.innerHTML = `<p class="bad">${html}</p>`; };

    if (!/(^|\.)weread\.qq\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) {
      fail('请在 https://weread.qq.com 的页面上运行本脚本。');
      return;
    }
    if (!isReader()) {
      fail('请先打开任意一本书，进入<b>阅读页</b>（网址里带 /web/reader/）后再运行。<br><span class="st">微信读书只允许在阅读页读取划线。</span>');
      return;
    }

    /* ---------- 请求 ---------- */
    async function get(path) {
      try {
        const res = await fetch(path, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (e) { return { error: `返回的不是 JSON（HTTP ${res.status}）` }; }
        const code = json.errcode ?? json.errCode;
        if (code !== undefined && code !== 0) return { error: `errcode ${code} ${json.errmsg || json.errMsg || ''}`.trim() };
        if (!res.ok) return { error: `HTTP ${res.status}` };
        return { json };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      } finally {
        await sleep(DELAY_MS);
      }
    }

    /* ---------- 1. 书架 ---------- */
    setStatus('正在读取书架…');
    const shelfRes = await get('/web/shelf/sync?synckey=0&teenmode=0&album=1&onlyBookid=0');
    if (!shelfRes.json) {
      fail(`读取书架失败：${esc(shelfRes.error)}<br><span class="st">请确认已登录（右上角扫码），刷新阅读页后再运行。</span>`);
      return;
    }
    const shelfBooks = Array.isArray(shelfRes.json.books) ? shelfRes.json.books : [];
    const shelfProg = new Map((Array.isArray(shelfRes.json.bookProgress) ? shelfRes.json.bookProgress : []).map((p) => [p.bookId, p]));

    /* ---------- 2. 每本书的划线数 ---------- */
    setStatus('正在读取笔记本列表…');
    const nbRes = await get('/api/user/notebook');
    const noteCount = new Map();
    if (nbRes.json && Array.isArray(nbRes.json.books)) for (const b of nbRes.json.books) noteCount.set(b.bookId, b.noteCount || 0);

    /* ---------- 3. 选出要同步的书：有进度、已读完或有划线 ---------- */
    const isFinished = (b) => b.finishReading === 1 || b.finishReading === true;
    const included = shelfBooks.filter((b) => b && b.bookId && b.title && (isFinished(b) || (shelfProg.get(b.bookId) || {}).progress > 0 || noteCount.get(b.bookId) > 0));
    const skipped = shelfBooks.length - included.length;

    const outBooks = [];
    const outHls = [];
    const warnings = [];
    const rows = [];
    for (let i = 0; i < included.length; i++) {
      const b = included[i];
      setStatus(`正在读取第 ${i + 1}/${included.length} 本：${cut(b.title, 16)}`);
      const sp = shelfProg.get(b.bookId) || {};
      const pg = await get(`/web/book/getProgress?bookId=${encodeURIComponent(b.bookId)}`);
      const p = pg.json ? pg.json.book || pg.json : {};
      if (pg.error) warnings.push(`《${cut(b.title, 16)}》进度读取失败：${pg.error}`);

      const progress = typeof p.progress === 'number' ? p.progress : typeof sp.progress === 'number' ? sp.progress : 0;
      const readingSeconds = typeof p.readingTime === 'number' ? p.readingTime : typeof sp.readingTime === 'number' ? sp.readingTime : 0;
      const lastReadMs = Math.max(tsMs(p.updateTime), tsMs(sp.updateTime), tsMs(b.readUpdateTime));
      const catRaw = (Array.isArray(b.categories) && b.categories[0] && b.categories[0].title) || b.category || '';
      outBooks.push({
        wereadId: String(b.bookId),
        title: String(b.title),
        author: String(b.author || ''),
        cover: typeof b.cover === 'string' ? b.cover : '',
        category: String(catRaw).split('-')[0].trim(),
        finished: isFinished(b),
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        startDate: toDate(p.startReadingTime),
        finishDate: isFinished(b) ? toDate(p.finishTime) : null,
        readingSeconds: Math.max(0, Math.round(readingSeconds)),
        lastReadAt: lastReadMs ? new Date(lastReadMs).toISOString() : null,
      });

      /* 划线 */
      const expected = noteCount.get(b.bookId) || 0;
      let got = 0, rule = '';
      if (expected > 0) {
        const bm = await get(`/web/book/bookmarklist?bookId=${encodeURIComponent(b.bookId)}&syncKey=0`);
        if (bm.error) warnings.push(`《${cut(b.title, 16)}》划线读取失败：${bm.error}`);
        const list = bm.json && Array.isArray(bm.json.updated) ? bm.json.updated : [];
        if (bm.json && !list.length) warnings.push(`《${cut(b.title, 16)}》登记了 ${expected} 条划线，但读到 0 条（请确认是在阅读页运行）`);
        const chapters = new Map((bm.json && Array.isArray(bm.json.chapters) ? bm.json.chapters : []).map((c) => [c.chapterUid, c.title]));
        // 接口把划线和书签一起返回：优先选「条数与登记的划线数一致」的 type，否则用 type=1，再不行就取所有有文字的
        const withText = list.filter((x) => typeof x.markText === 'string' && x.markText.trim());
        const byType = new Map();
        for (const x of withText) { const k = x.type; if (!byType.has(k)) byType.set(k, []); byType.get(k).push(x); }
        let items = null;
        for (const [k, arr] of byType) if (arr.length === expected) { items = arr; rule = `type=${k}`; break; }
        if (!items && byType.has(1)) { items = byType.get(1); rule = 'type=1'; }
        if (!items) { items = withText; rule = 'all'; }
        if (list.length && items.length !== expected) warnings.push(`《${cut(b.title, 16)}》登记 ${expected} 条划线，读到 ${items.length} 条（类型分布：${[...byType].map(([k, a]) => `type ${k}=${a.length}`).join('，')}）`);
        for (const x of items) {
          outHls.push({
            wereadId: String(x.bookmarkId || `${b.bookId}_${x.chapterUid}_${x.range}`),
            bookWereadId: String(b.bookId),
            chapter: chapters.get(x.chapterUid) || '',
            text: x.markText.trim(),
            date: toDate(x.createTime),
            createdAt: toISO(x.createTime),
          });
        }
        got = items.length;
      }
      rows.push({ title: b.title, progress: outBooks[outBooks.length - 1].progress, finished: isFinished(b), finishDate: outBooks[outBooks.length - 1].finishDate, expected, got });
    }

    /* ---------- 4. 生成同步文件 ---------- */
    const now = new Date();
    const payload = {
      app: 'reading-space', kind: 'weread-sync', version: 1, exportedAt: now.toISOString(),
      books: outBooks, highlights: outHls,
    };
    const json = JSON.stringify(payload);
    const fileName = `微信读书同步-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;

    const finishedN = outBooks.filter((b) => b.finished).length;
    body.innerHTML = `
      <div class="sum">
        <div><b>${outBooks.length}</b>本书</div><div><b>${finishedN}</b>已读完</div>
        <div><b>${outBooks.length - finishedN}</b>在读</div><div><b>${outHls.length}</b>条划线</div>
      </div>
      <div class="st">书架共 ${shelfBooks.length} 本，跳过 ${skipped} 本没有进度、没读完也没有划线的书。文件约 ${Math.ceil(json.length / 1024)} KB。</div>
      ${warnings.length ? `<h3 class="warn">注意（${warnings.length}）</h3>${warnings.map((w) => `<div class="warn">· ${esc(w)}</div>`).join('')}` : '<div class="ok" style="margin-top:6px">✓ 全部读取成功</div>'}
      <div class="btns"><button id="cp">复制到剪贴板</button><button id="dl" class="ghost">下载文件</button></div>
      <div class="st" id="cp-tip" style="margin-top:6px">复制后，在 iPhone 上打开工作台 → 设置 →「从剪贴板导入」。Mac 和 iPhone 需登录同一个 Apple ID，并开启蓝牙和「接力」。<br>也可以下载文件，用 AirDrop 传到手机，在「设置 → 选择备份文件」里导入。</div>
      <h3>明细</h3>
      <table><tr><th>书名</th><th>进度</th><th>读完</th><th>划线</th></tr>
        ${rows.map((r) => `<tr><td>${esc(cut(r.title, 18))}</td><td>${r.progress}%</td><td>${r.finished ? (r.finishDate || '是') : ''}</td><td>${r.expected ? `${r.got}${r.got !== r.expected ? ` <span class="warn">/ 登记 ${r.expected}</span>` : ''}` : ''}</td></tr>`).join('')}
      </table>`;
    root.getElementById('dl').onclick = () => {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    };
    const copyJSON = async () => {
      try { await navigator.clipboard.writeText(json); return true; } catch (err) { /* 改用旧方法 */ }
      try {
        const ta = document.createElement('textarea'); ta.value = json; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (err) { return false; }
    };
    const cpBtn = root.getElementById('cp');
    const markCopied = () => { cpBtn.textContent = '已复制到剪贴板 ✓'; };
    cpBtn.onclick = async () => { if (await copyJSON()) markCopied(); else cpBtn.textContent = '复制失败，请改用下载'; };
    // 读完后自动复制一次（浏览器不允许时，就等你点按钮）
    if (await copyJSON()) markCopied();
    console.log('[阅读空间] 同步数据已生成', { books: outBooks.length, highlights: outHls.length, warnings });
  }

  /* ---------- 油猴模式：阅读页左下角放一个按钮 ---------- */
  let launcher = null;
  function showLauncher() {
    if (typeof GM_info === 'undefined' || !document.body) return;
    if (!launcher) {
      launcher = document.createElement('div');
      launcher.id = '__rs_launcher';
      launcher.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646;';
      const r = launcher.attachShadow({ mode: 'open' });
      r.innerHTML = `<style>button{display:flex;align-items:center;gap:6px;padding:8px 14px;border:0;border-radius:20px;background:#2F5241;color:#fff;
        font:600 13px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer;opacity:.9}
        button:hover{opacity:1}</style><button title="读取书架进度和划线，复制后到手机工作台导入">⇪ 同步到阅读空间</button>`;
      r.querySelector('button').onclick = () => { launcher.style.display = 'none'; runSync(); };
      document.body.appendChild(launcher);
    }
    const panelOpen = !!document.getElementById('__rs_probe');
    launcher.style.display = isReader() && !panelOpen ? '' : 'none';
  }

  if (typeof GM_info !== 'undefined') {
    // 微信读书是单页应用，切换页面时网址会变，定时检查是否在阅读页
    showLauncher();
    setInterval(showLauncher, 1000);
  } else {
    runSync();
  }
})();
