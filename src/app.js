import Sortable from 'sortablejs';
import { diffWordsWithSpace } from 'diff';
import { store } from 'store';
import {
  countChars, fmt, escapeHtml as h, renderParagraphs, parseLegacyHtml, relTime, dateTime, normalizeText, plainText,
} from './text.js';
import { createBodyEditor } from './editor.js';
import { exportTxt, exportDocx, exportBackup, parseBackup } from './export.js';
import { YOUTUBE_MARK } from './youtube.js';

// ───────── 기본 상태 ─────────
const $app = document.getElementById('app');
const STATUS = { draft: '초고', revising: '수정 중', done: '검수 완료' };
const REASON = {
  import: '가져오기', 'before-edit': '수정 시작 전', auto: '자동 (10분마다)', leave: '편집 마침',
  manual: '직접 저장', 'before-restore': '복원 전 내용', 'before-sync': '다른 기기 내용으로 바뀌기 전',
  'conflict-mine': '충돌 시 이 기기 내용', 'conflict-other': '충돌 시 다른 기기 내용',
};
const AUTO_VERSION_MS = 10 * 60 * 1000;
const SAVE_DELAY = 1200;
const SAVE_MAX_WAIT = 8000;
const MAX_VERSIONS = 150;

const DEVICE = (() => {
  const k = store.kind === 'mock' ? sessionStorage : localStorage;
  try {
    let id = k.getItem('deviceId');
    if (!id) { id = Math.random().toString(36).slice(2, 10); k.setItem('deviceId', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 10); }
})();

const S = {
  user: null, works: [], worksReady: false, worksUnsub: null,
  wid: null, chapters: [], chaptersReady: false, chaptersUnsub: null, chaptersMeta: {},
  view: null, editor: null, dragging: false,
};

const work = () => S.works.find((w) => w.id === S.wid);
const active = (kind) => S.chapters.filter((c) => !c.deletedAt && c.kind === kind);
const chapterNo = (c) => active('chapter').findIndex((x) => x.id === c.id) + 1;
const label = (c) => (c.kind === 'chapter' ? `${String(chapterNo(c)).padStart(2, '0')}화` : '부록');

// ───────── 공통 UI ─────────
function toast(msg, warn = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (warn ? ' warn' : '');
  el.textContent = msg;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

// 모달: buttons [{label, value, primary, danger}] → 누른 버튼 value로 resolve
function modal({ title, body = '', buttons = [{ label: '확인', value: true, primary: true }], onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${h(title)}">
      <h2>${h(title)}</h2><div class="modal-body">${body}</div>
      <div class="modal-actions">${buttons.map((b, i) => `<button type="button" data-i="${i}" class="${b.primary ? 'primary' : ''}${b.danger ? ' danger' : ''}">${h(b.label)}</button>`).join('')}</div></div>`;
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close(null);
      const r = e.target.closest('[data-resolve]');
      if (r) return close(r.dataset.resolve);
      const b = e.target.closest('.modal-actions button');
      if (b) {
        const btn = buttons[Number(b.dataset.i)];
        close(typeof btn.value === 'function' ? btn.value(wrap) : btn.value);
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    if (onOpen) onOpen(wrap);
    else wrap.querySelector('.modal-actions button.primary, .modal-actions button')?.focus();
  });
}

function confirmBox(title, body, okLabel = '확인', danger = false) {
  return modal({ title, body: `<p>${body}</p>`, buttons: [{ label: '취소', value: false }, { label: okLabel, value: true, primary: !danger, danger }] });
}

function busy(msg) {
  const el = document.createElement('div');
  el.className = 'modal-wrap busy';
  el.innerHTML = `<div class="modal"><p class="busy-msg">${h(msg)}</p><p class="muted small">창을 닫거나 다른 화면으로 가지 말고 기다려 주세요.</p></div>`;
  document.body.append(el);
  return { set: (m) => { el.querySelector('.busy-msg').textContent = m; }, done: () => el.remove() };
}

function showError(what, e) {
  console.error(e);
  const code = (e && (e.code || e.name)) || '';
  const msg = (e && e.message) || String(e);
  let hint = '';
  if (code.includes('permission-denied')) hint = 'Firestore 보안 규칙이나 로그인한 계정을 확인해 주세요.';
  else if (code.includes('unavailable') || code.includes('network')) hint = '인터넷 연결을 확인하고 다시 시도해 주세요.';
  return modal({ title: what + ' 실패', body: `<p>${h(hint || '아래 오류 내용을 캡처해서 알려주세요.')}</p><pre class="err-box">${h(code)}\n${h(msg)}</pre>` });
}

async function addWithProgress(wid, rows) {
  const b = busy(`원고 ${rows.length}개를 저장하는 중… (0/${rows.length})`);
  let last = Date.now();
  const watch = setInterval(() => {
    if (Date.now() - last > 20000) b.set('서버에서 응답이 없어요. 인터넷 연결과 Firebase의 Firestore 데이터베이스가 있는지 확인해 주세요. (계속 기다리는 중)');
  }, 2000);
  try {
    await store.addChapters(wid, rows, (done, total) => { last = Date.now(); b.set(`원고 ${total}개를 저장하는 중… (${done}/${total})`); });
  } finally { clearInterval(watch); b.done(); }
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

function netBadge() {
  return navigator.onLine ? '' : '<span class="pill warn">오프라인</span>';
}

function topbar({ back, backLabel = '', title = '', right = '' }) {
  return `<header class="topbar">
    ${back ? `<a class="back" href="${back}" aria-label="뒤로"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${h(backLabel)}</span></a>` : '<span class="brand">원고 보관함</span>'}
    <div class="topbar-title">${title}</div>
    <div class="topbar-right">${netBadge()}${right}</div></header>`;
}

// ───────── 로그인 ─────────
function renderLogin() {
  S.view = 'login';
  $app.innerHTML = `<main class="login">
    <h1>원고 보관함</h1>
    <p class="muted">PC와 휴대폰 어디서든 같은 원고를 이어서 쓰는 곳</p>
    <button type="button" class="primary big" id="google">Google 계정으로 로그인</button>
    <details class="email-login"><summary>이메일로 로그인</summary>
      <form id="emailForm"><input type="email" name="email" placeholder="이메일" autocomplete="username" required>
      <input type="password" name="pw" placeholder="비밀번호" autocomplete="current-password" required>
      <button type="submit">로그인</button></form></details>
    <p class="err" id="err" role="alert"></p></main>`;
  const err = $app.querySelector('#err');
  const fail = (e) => { console.error(e); err.textContent = loginError(e); };
  $app.querySelector('#google').onclick = () => store.signInGoogle().catch(fail);
  $app.querySelector('#emailForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    store.signInEmail(f.email.value.trim(), f.pw.value).catch(fail);
  };
}
function loginError(e) {
  const c = e && e.code || '';
  if (c.includes('popup-closed') || c.includes('cancelled')) return '로그인 창이 닫혔어요. 다시 시도해 주세요.';
  if (c.includes('unauthorized-domain')) return '이 주소가 Firebase 승인된 도메인에 없어요. Authentication → 설정 → 승인된 도메인에 추가해 주세요.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (c.includes('operation-not-allowed')) return '이 로그인 방식이 Firebase에서 꺼져 있어요.';
  if (c.includes('network')) return '인터넷 연결을 확인해 주세요.';
  return '로그인하지 못했어요. (' + (c || e.message || '알 수 없는 오류') + ')';
}

function permissionError(e) {
  console.error(e);
  if (e && e.code === 'permission-denied') {
    $app.innerHTML = `<main class="login"><h1>접근 권한이 없어요</h1>
      <p class="muted">이 계정(${h(S.user?.label)})으로는 원고를 열 수 없어요. 원고를 저장한 계정으로 다시 로그인해 주세요.</p>
      <button type="button" class="primary" id="out">로그아웃</button></main>`;
    $app.querySelector('#out').onclick = () => store.signOut();
  } else toast('원고를 불러오지 못했어요: ' + (e && (e.code || e.message)), true);
}

// ───────── 라우팅 ─────────
function parseRoute() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'w' && p[1]) {
    if (p[2] === 'c' && p[3]) return { name: p[4] === 'h' ? 'history' : 'editor', wid: p[1], cid: p[3] };
    if (p[2] === 'trash') return { name: 'trash', wid: p[1] };
    return { name: 'work', wid: p[1] };
  }
  return { name: 'home' };
}

async function route() {
  if (!S.user) return;
  const r = parseRoute();
  if (S.editor && !(r.name === 'editor' && r.cid === S.editor.cid)) await closeEditor();
  if (r.wid && r.wid !== S.wid) watchWork(r.wid);
  if (!r.wid && S.wid) { S.chaptersUnsub?.(); S.chaptersUnsub = null; S.wid = null; S.chapters = []; }
  S.route = r;
  window.scrollTo(0, 0);
  if (r.name === 'home') renderHome();
  else if (r.name === 'work') renderWork();
  else if (r.name === 'trash') renderTrash();
  else if (r.name === 'editor') openEditor(r.wid, r.cid);
  else if (r.name === 'history') renderHistory(r.wid, r.cid);
}

function watchWork(wid) {
  S.chaptersUnsub?.();
  S.wid = wid; S.chapters = []; S.chaptersReady = false;
  S.chaptersUnsub = store.watchChapters(wid, (list, meta) => {
    S.chapters = list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    S.chaptersReady = true; S.chaptersMeta = meta;
    if (S.dragging) return;
    if (S.view === 'work') renderWork();
    else if (S.view === 'trash') renderTrash();
    else if (S.view === 'editor') updateEditorNav();
  }, permissionError);
}

// ───────── 홈: 작품 목록 ─────────
function renderHome() {
  S.view = 'home';
  const works = [...S.works].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $app.innerHTML = topbar({ right: `<button type="button" class="ghost small" id="account">${h(S.user.label)}</button>` }) + `
    <main class="page">
      <h1 class="page-title">작품</h1>
      ${!S.worksReady ? '<p class="muted">불러오는 중…</p>' : works.length ? `<ul class="cards">${works.map((w) => `
        <li><a class="card" href="#/w/${w.id}"><strong>${h(w.title || '제목 없음')}</strong>
        ${w.subtitle ? `<span class="muted">${h(w.subtitle)}</span>` : ''}
        <span class="small muted">${relTime(w.updatedAt)} 수정</span></a></li>`).join('')}</ul>`
        : '<div class="empty"><p>아직 작품이 없어요.</p><p class="muted">기존 원고 모음 html을 가져오거나 새 작품을 만들어 보세요.</p></div>'}
      <div class="row-actions">
        <button type="button" class="primary" id="newWork"><span class="plus">+</span>새 작품</button>
        <button type="button" id="importHtml">기존 html 가져오기</button>
        <button type="button" id="importJson">백업 파일 불러오기</button>
      </div>
    </main>`;
  $app.querySelector('#newWork').onclick = newWork;
  $app.querySelector('#importHtml').onclick = () => importHtml(null);
  $app.querySelector('#importJson').onclick = importJson;
  $app.querySelector('#account').onclick = async () => {
    if (await confirmBox('로그아웃', `${h(S.user.label)} 계정에서 로그아웃할까요? 원고는 계정에 그대로 남아 있어요.`, '로그아웃')) store.signOut();
  };
}

async function newWork() {
  const title = await modal({
    title: '새 작품',
    body: '<label>작품 제목<input type="text" id="t" maxlength="100"></label>',
    buttons: [{ label: '취소', value: null }, { label: '만들기', primary: true, value: (w) => w.querySelector('#t').value.trim() }],
    onOpen: (w) => w.querySelector('#t').focus(),
  });
  if (!title) return;
  const id = await store.createWork({ title, subtitle: '', target: null, targetBasis: 'noSpace', order: Date.now() });
  location.hash = '#/w/' + id;
}

// ───────── 가져오기 ─────────
async function importHtml(intoWid) {
  const file = await pickFile('.html,.htm,text/html');
  if (!file) return;
  let parsed;
  try { parsed = parseLegacyHtml(await file.text()); } catch (e) { console.error(e); return toast('html을 읽지 못했어요.', true); }
  const { work: pw, chapters, appendices } = parsed;
  if (!chapters.length && !appendices.length) return toast('이 파일에서 원고를 찾지 못했어요.', true);

  if (intoWid) {
    // 기존 작품에 합치기: 제목이 같은 회차/부록은 건너뛴다
    const have = new Set(S.chapters.filter((c) => !c.deletedAt).map((c) => c.kind + '|' + c.title.trim()));
    const newCh = chapters.filter((c) => !have.has('chapter|' + c.title));
    const newAp = appendices.filter((c) => !have.has('appendix|' + c.title));
    if (!newCh.length && !newAp.length) return modal({ title: '추가할 원고가 없어요', body: '<p>이 파일의 회차와 부록이 모두 이미 들어 있어요. (제목 기준)</p>' });
    const ok = await confirmBox('이 작품에 합치기',
      `새 회차 ${newCh.length}편${newCh.length ? ` (${newCh.map((c) => h(c.title)).slice(0, 5).join(', ')}${newCh.length > 5 ? ' 등' : ''})` : ''}, 새 부록 ${newAp.length}개를 맨 뒤에 추가할까요?<br><span class="muted small">제목이 같은 원고는 건너뛰어요. 기존 원고는 바뀌지 않아요.</span>`, '추가하기');
    if (!ok) return;
    let base = Math.max(0, ...S.chapters.map((c) => c.order ?? 0)) + 10;
    const rows = [...newCh.map((c) => ({ kind: 'chapter', ...c })), ...newAp.map((c) => ({ kind: 'appendix', ...c }))]
      .map((c, i) => ({ kind: c.kind, title: c.title, text: c.text, status: 'draft', order: base + i * 10, device: DEVICE }));
    try { await addWithProgress(intoWid, rows); } catch (e) { return showError('원고 추가', e); }
    toast(`${rows.length}개를 추가했어요.`);
    return;
  }

  const same = S.works.find((w) => (w.title || '').trim() === pw.title);
  const buttons = [{ label: '취소', value: null }];
  if (same) buttons.push({ label: '기존 작품에 합치기', value: 'merge' });
  buttons.push({ label: '새 작품으로 가져오기', value: 'new', primary: true });
  const choice = await modal({
    title: '원고 가져오기',
    body: `<p><strong>${h(pw.title)}</strong></p><p>회차 ${chapters.length}편, 부록 ${appendices.length}개를 찾았어요.</p>
      ${same ? '<p class="muted small">같은 제목의 작품이 이미 있어요. 합치면 새 회차만 추가돼요.</p>' : ''}
      <p class="muted small">모든 회차는 ‘초고’ 상태로 들어가요.</p>`,
    buttons,
  });
  if (!choice) return;
  if (choice === 'merge') {
    location.hash = '#/w/' + same.id;
    await waitChapters();
    return importHtmlParsed(same.id, parsed);
  }
  let wid;
  try { wid = await store.createWork({ title: pw.title, subtitle: pw.subtitle, target: null, targetBasis: 'noSpace', order: Date.now() }); } catch (e) { return showError('작품 만들기', e); }
  const rows = [
    ...chapters.map((c, i) => ({ kind: 'chapter', title: c.title, text: c.text, status: 'draft', order: (i + 1) * 10, device: DEVICE })),
    ...appendices.map((c, i) => ({ kind: 'appendix', title: c.title, text: c.text, status: 'draft', order: 100000 + i * 10, device: DEVICE })),
  ];
  try { await addWithProgress(wid, rows); } catch (e) { location.hash = '#/w/' + wid; return showError('원고 가져오기', e); }
  location.hash = '#/w/' + wid;
  toast(`회차 ${chapters.length}편과 부록 ${appendices.length}개를 가져왔어요.`);
}

async function importHtmlParsed(wid, parsed) {
  const have = new Set(S.chapters.filter((c) => !c.deletedAt).map((c) => c.kind + '|' + c.title.trim()));
  const rows0 = [...parsed.chapters.map((c) => ({ kind: 'chapter', ...c })), ...parsed.appendices.map((c) => ({ kind: 'appendix', ...c }))]
    .filter((c) => !have.has(c.kind + '|' + c.title));
  if (!rows0.length) return toast('새로 추가할 원고가 없어요. (제목 기준)');
  const base = Math.max(0, ...S.chapters.map((c) => c.order ?? 0)) + 10;
  const rows = rows0.map((c, i) => ({ kind: c.kind, title: c.title, text: c.text, status: 'draft', order: base + i * 10, device: DEVICE }));
  try { await addWithProgress(wid, rows); } catch (e) { return showError('원고 추가', e); }
  toast(`${rows.length}개를 추가했어요.`);
}

function waitChapters() {
  return new Promise((res) => { const t = setInterval(() => { if (S.chaptersReady) { clearInterval(t); res(); } }, 50); });
}

async function importJson() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let works;
  try { works = parseBackup(await file.text()); } catch (e) { return toast(e.message || '백업 파일을 읽지 못했어요.', true); }
  const w = works[0];
  const n = w.chapters.filter((c) => !c.deleted).length;
  const ok = await confirmBox('백업 불러오기', `<strong>${h(w.title)}</strong> (원고 ${n}개)를 새 작품으로 불러올까요?<br><span class="muted small">기존 작품은 바뀌지 않아요.</span>`, '불러오기');
  if (!ok) return;
  const wid = await store.createWork({ title: w.title, subtitle: w.subtitle || '', target: w.target ?? null, targetBasis: w.targetBasis || 'noSpace', order: Date.now() });
  await addWithProgress(wid, w.chapters.filter((c) => !c.deleted).map((c, i) => ({
    kind: c.kind === 'appendix' ? 'appendix' : 'chapter', title: c.title || '', text: c.text || '',
    status: STATUS[c.status] ? c.status : 'draft', order: c.order ?? i * 10, device: DEVICE,
  })));
  location.hash = '#/w/' + wid;
  toast('백업을 불러왔어요.');
}

// ───────── 작품: 회차 목록 ─────────
function progressHtml(c, w) {
  const n = countChars(c.text);
  const basis = w?.targetBasis === 'withSpace' ? 'withSpace' : 'noSpace';
  const cur = n[basis];
  const target = Number(w?.target) || 0;
  const pct = target ? Math.min(100, Math.round((cur / target) * 100)) : 0;
  return { n, cur, target, pct, basis };
}

function renderWork() {
  S.view = 'work';
  const w = work();
  if (!w) {
    $app.innerHTML = topbar({ back: '#/', backLabel: '작품' }) + `<main class="page"><p class="muted">${S.worksReady ? '작품을 찾을 수 없어요.' : '불러오는 중…'}</p></main>`;
    return;
  }
  const chs = active('chapter');
  const aps = active('appendix');
  const trash = S.chapters.filter((c) => c.deletedAt).length;
  const total = chs.reduce((a, c) => { const n = countChars(c.text); a.w += n.withSpace; a.n += n.noSpace; return a; }, { w: 0, n: 0 });
  const row = (c, numbered) => {
    const p = progressHtml(c, w);
    return `<li class="ch-row" data-id="${c.id}">
      <span class="handle" aria-label="순서 바꾸기" title="끌어서 순서 바꾸기"><svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg></span>
      <a class="ch-main" href="#/w/${w.id}/c/${c.id}">
        <span class="ch-title">${numbered ? `<span class="no">${String(chapterNo(c)).padStart(2, '0')}</span>` : ''}${h(c.title || '제목 없음')}</span>
        <span class="ch-meta">${fmt(p.n.noSpace)}자${p.target ? `, 목표의 ${p.pct}%` : ''}<span class="sep"></span>${relTime(c.updatedAt)} 수정</span>
        ${p.target ? `<span class="bar"><span style="width:${p.pct}%"></span></span>` : ''}
      </a>
      ${numbered ? `<select class="status s-${c.status || 'draft'}" data-id="${c.id}" aria-label="상태">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${(c.status || 'draft') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>` : ''}
    </li>`;
  };
  $app.innerHTML = topbar({ back: '#/', backLabel: '작품', right: '<button type="button" class="ghost small" id="settings">작품 설정</button>' }) + `
    <main class="page">
      <h1 class="page-title">${h(w.title)}</h1>
      ${w.subtitle ? `<p class="muted subtitle">${h(w.subtitle)}</p>` : ''}
      <p class="stats">회차 <strong>${chs.length}편</strong>, 공백 제외 <strong>${fmt(total.n)}자</strong> (공백 포함 ${fmt(total.w)}자)${w.target ? `<br>회차당 목표 ${fmt(w.target)}자, ${w.targetBasis === 'withSpace' ? '공백 포함' : '공백 제외'} 기준` : ''}</p>
      <div class="row-actions">
        <button type="button" class="primary" id="newCh"><span class="plus">+</span>새 회차</button>
        <button type="button" id="export">내보내기</button>
        <button type="button" id="merge">html 합치기</button>
      </div>
      <h2 class="section">회차</h2>
      ${!S.chaptersReady ? '<p class="muted">불러오는 중…</p>' : chs.length ? `<ul class="ch-list" id="chList">${chs.map((c) => row(c, true)).join('')}</ul>` : '<p class="muted">아직 회차가 없어요.</p>'}
      <h2 class="section">부록 <span class="hint">글자 수 합계와 회차 번호에서 빠져요</span></h2>
      ${aps.length ? `<ul class="ch-list" id="apList">${aps.map((c) => row(c, false)).join('')}</ul>` : '<p class="muted">부록이 없어요.</p>'}
      <div class="row-actions"><button type="button" id="newAp"><span class="plus">+</span>새 부록</button>
      <a class="button ghost" href="#/w/${w.id}/trash">휴지통${trash ? ` (${trash})` : ''}</a></div>
    </main>`;
  $app.querySelector('#newCh').onclick = () => newChapter('chapter');
  $app.querySelector('#newAp').onclick = () => newChapter('appendix');
  $app.querySelector('#export').onclick = exportWorkDialog;
  $app.querySelector('#merge').onclick = () => importHtml(w.id);
  $app.querySelector('#settings').onclick = workSettings;
  $app.querySelectorAll('select.status').forEach((sel) => {
    sel.onchange = () => store.updateChapter(S.wid, sel.dataset.id, { status: sel.value });
  });
  for (const id of ['chList', 'apList']) {
    const el = document.getElementById(id);
    if (!el) continue;
    Sortable.create(el, {
      handle: '.handle', animation: 150, delay: 0, ghostClass: 'drag-ghost',
      onStart: () => { S.dragging = true; },
      onEnd: () => {
        S.dragging = false;
        const ids = Array.from(el.children, (li) => li.dataset.id);
        const base = id === 'apList' ? 100000 : 10;
        const items = ids.map((cid, i) => ({ id: cid, order: base + i * 10 }));
        for (const it of items) { const c = S.chapters.find((x) => x.id === it.id); if (c) c.order = it.order; }
        S.chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        store.setOrders(S.wid, items);
        renderWork();
      },
    });
  }
}

async function newChapter(kind) {
  const list = active(kind);
  const order = (list.length ? Math.max(...list.map((c) => c.order ?? 0)) : (kind === 'appendix' ? 100000 : 0)) + 10;
  const title = kind === 'chapter' ? '새 회차' : '새 부록';
  const id = await store.createChapter(S.wid, { kind, title, text: '', status: 'draft', order, device: DEVICE });
  S.focusTitle = true;
  location.hash = `#/w/${S.wid}/c/${id}`;
}

async function workSettings() {
  const w = work();
  const res = await modal({
    title: '작품 설정',
    body: `<label>작품 제목<input type="text" id="t" value="${h(w.title)}" maxlength="100"></label>
      <label>부제·소개<input type="text" id="s" value="${h(w.subtitle || '')}" maxlength="200"></label>
      <label>회차당 목표 분량 <span class="muted small">(비워두면 표시 안 함)</span>
        <input type="number" id="g" inputmode="numeric" min="0" step="100" value="${w.target || ''}" placeholder="예: 5000"></label>
      <fieldset class="radio"><legend>기준</legend>
        <label><input type="radio" name="b" value="noSpace"${w.targetBasis !== 'withSpace' ? ' checked' : ''}> 공백 제외</label>
        <label><input type="radio" name="b" value="withSpace"${w.targetBasis === 'withSpace' ? ' checked' : ''}> 공백 포함</label></fieldset>`,
    buttons: [{ label: '취소', value: null }, {
      label: '저장', primary: true,
      value: (m) => ({
        title: m.querySelector('#t').value.trim() || w.title,
        subtitle: m.querySelector('#s').value.trim(),
        target: Number(m.querySelector('#g').value) > 0 ? Math.round(Number(m.querySelector('#g').value)) : null,
        targetBasis: m.querySelector('input[name=b]:checked').value,
      }),
    }],
  });
  if (res) { await store.updateWork(w.id, res); toast('저장했어요.'); }
}

async function exportWorkDialog() {
  const w = work();
  const choice = await modal({
    title: '내보내기',
    body: `<fieldset class="radio"><legend>형식</legend>
        <label><input type="radio" name="f" value="docx" checked> 워드(docx)</label>
        <label><input type="radio" name="f" value="txt"> 텍스트(txt)</label></fieldset>
      <fieldset class="radio"><legend>범위</legend>
        <label><input type="radio" name="r" value="ch" checked> 회차 전체</label>
        <label><input type="radio" name="r" value="all"> 회차 + 부록</label></fieldset>
      <p class="muted small">한 회차만 내보내려면 회차를 열고 ‘⋯’ 메뉴를 쓰세요.</p>
      <hr><p class="small">전체 백업(JSON)은 이 작품을 통째로 보관하는 파일이에요. 홈의 ‘백업 파일 불러오기’로 되살릴 수 있어요.</p>`,
    buttons: [
      { label: '닫기', value: null },
      { label: '전체 백업(JSON)', value: 'json' },
      { label: '내려받기', primary: true, value: (m) => ({ f: m.querySelector('input[name=f]:checked').value, r: m.querySelector('input[name=r]:checked').value }) },
    ],
  });
  if (!choice) return;
  if (choice === 'json') return exportBackup(w, S.chapters);
  const items = [...active('chapter'), ...(choice.r === 'all' ? active('appendix') : [])]
    .map((c) => ({ heading: c.kind === 'chapter' ? `${String(chapterNo(c)).padStart(2, '0')} · ${c.title}` : `부록 · ${c.title}`, text: c.text }));
  try {
    if (choice.f === 'txt') exportTxt(w.title, items, w.title);
    else { toast('워드 파일을 만드는 중…'); await exportDocx(w.title, items, w.title); }
  } catch (e) { console.error(e); toast('내보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', true); }
}

// ───────── 휴지통 ─────────
function renderTrash() {
  S.view = 'trash';
  const w = work();
  const items = S.chapters.filter((c) => c.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  $app.innerHTML = topbar({ back: `#/w/${S.wid}`, backLabel: w ? w.title : '작품', title: '휴지통' }) + `
    <main class="page"><h1 class="page-title">휴지통</h1>
    <p class="muted small">지운 원고는 여기 보관돼요. 복원하면 목록 맨 뒤로 돌아가요.</p>
    ${items.length ? `<ul class="ch-list">${items.map((c) => `<li class="ch-row" data-id="${c.id}">
      <div class="ch-main"><span class="ch-title">${c.kind === 'appendix' ? '<span class="no">부록</span>' : ''}${h(c.title || '제목 없음')}</span>
      <span class="ch-meta">${fmt(countChars(c.text).noSpace)}자<span class="sep"></span>${dateTime(c.deletedAt)} 삭제</span></div>
      <button type="button" class="small" data-act="restore">복원</button>
      <button type="button" class="small danger" data-act="purge">영구 삭제</button></li>`).join('')}</ul>` : '<p class="muted">비어 있어요.</p>'}
    </main>`;
  $app.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const id = b.closest('li').dataset.id;
      const c = S.chapters.find((x) => x.id === id);
      if (b.dataset.act === 'restore') {
        const list = active(c.kind);
        const order = (list.length ? Math.max(...list.map((x) => x.order ?? 0)) : (c.kind === 'appendix' ? 100000 : 0)) + 10;
        await store.updateChapter(S.wid, id, { deletedAt: null, order });
        toast('복원했어요.');
      } else if (await confirmBox('영구 삭제', `‘${h(c.title)}’과 버전 기록을 완전히 지울까요? 되돌릴 수 없어요.`, '영구 삭제', true)) {
        const vs = await store.listVersions(S.wid, id).catch(() => []);
        await Promise.all(vs.map((v) => store.deleteVersion(S.wid, id, v.id)));
        await store.deleteChapterForever(S.wid, id);
        toast('완전히 지웠어요.');
      }
    };
  });
}

// ───────── 편집기 ─────────
function openEditor(wid, cid) {
  if (S.editor && S.editor.cid === cid) return;
  S.view = 'editor';
  const E = S.editor = {
    wid, cid, base: null, doc: null, meta: {}, timer: null, firstDirtyAt: 0,
    sessionVersioned: false, lastVersionAt: Date.now(), lastVersionText: null,
    conflict: null, reading: false, savedInSession: false, unsub: null,
  };
  const w = work();
  $app.innerHTML = topbar({
    back: `#/w/${wid}`, backLabel: w ? w.title : '목록', title: '<span id="liveCount" class="live-count"></span>',
    right: '<span class="save-state" id="saveState"></span><button type="button" class="ghost icon" id="menu" aria-label="메뉴">⋯</button>',
  }) + `<main class="editor-page">
      <div id="conflict"></div>
      <div class="ed-head">
        <span class="ch-label" id="chLabel"></span>
        <input type="text" id="title" class="title-input" placeholder="제목" aria-label="제목" maxlength="200">
        <div class="ed-meta"><select id="status" class="status" aria-label="상태">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <span id="counts" class="counts"></span></div>
        <span class="bar" id="bar" hidden><span></span></span>
      </div>
      <div class="ed-tools" id="edTools" role="toolbar" aria-label="서식">
        <button type="button" class="tool" data-bubble="other" title="상대 말풍선 (회색, 왼쪽)"><span class="tool-icon other"></span><span class="l-long">상대 말풍선</span><span class="l-short">상대</span></button>
        <button type="button" class="tool" data-bubble="me" title="내 말풍선 (파랑, 오른쪽)"><span class="tool-icon me"></span><span class="l-long">내 말풍선</span><span class="l-short">나</span></button>
        <span class="tool-sep"></span>
        <button type="button" class="tool" data-list="bullet" title="글머리표 목록"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="4" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="3" cy="12" r="1.5"/><rect x="6.5" y="3.2" width="8" height="1.6" rx=".8"/><rect x="6.5" y="7.2" width="8" height="1.6" rx=".8"/><rect x="6.5" y="11.2" width="8" height="1.6" rx=".8"/></g></svg>목록</button>
        <button type="button" class="tool" data-list="ordered" title="번호 목록"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><text x="0.5" y="6" font-size="5.5" font-family="sans-serif" font-weight="700">1</text><text x="0.5" y="13.5" font-size="5.5" font-family="sans-serif" font-weight="700">2</text><rect x="6.5" y="3.2" width="8" height="1.6" rx=".8"/><rect x="6.5" y="10.7" width="8" height="1.6" rx=".8"/></g></svg>번호</button>
        <button type="button" class="tool" data-table="insert" title="표 넣기"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 6.2h13M6 2.5v11M10.5 2.5v11"/></g></svg>표</button>
        <span class="tool-sep"></span><button type="button" class="tool" data-youtube-insert title="유튜브 모바일 화면 넣기"><svg width="18" height="14" viewBox="0 0 24 18" aria-hidden="true"><rect width="24" height="18" rx="5" fill="#f03"/><path d="m10 5 7 4-7 4Z" fill="white"/></svg>유튜브</button>
      </div>
      <div class="ed-tools table-tools" id="tableTools" hidden role="toolbar" aria-label="표 편집">
        <span class="tt-label">표</span>
        <button type="button" class="tool" data-tcmd="addRow">줄 추가</button>
        <button type="button" class="tool" data-tcmd="delRow">줄 삭제</button>
        <button type="button" class="tool" data-tcmd="addCol">칸 추가</button>
        <button type="button" class="tool" data-tcmd="delCol">칸 삭제</button>
        <button type="button" class="tool danger" data-tcmd="delTable">표 지우기</button>
      </div>
      <div id="body" class="body-input"></div>
      <article id="reader" class="reader" hidden></article>
      <nav class="ed-nav" id="edNav"></nav>
    </main>`;
  const title = $app.querySelector('#title');
  const tools = $app.querySelector('#edTools');
  const tableTools = $app.querySelector('#tableTools');
  const body = createBodyEditor($app.querySelector('#body'), {
    onChange: onEdit,
    onMessage: (message) => toast(message, true),
    onSelection: () => {
      const k = body.currentKind();
      tools.querySelectorAll('[data-bubble]').forEach((b) => b.classList.toggle('on', b.dataset.bubble === k));
      tools.querySelectorAll('[data-list]').forEach((b) => b.classList.toggle('on', b.dataset.list === k));
      tools.querySelector('[data-table]').classList.toggle('on', k === 'table');
      tools.querySelector('[data-youtube-insert]').classList.toggle('on', k === 'youtube');
      tableTools.hidden = k !== 'table' || !!E.reading;
    },
    placeholder: '본문을 입력하세요. Enter로 문단을 나누고, 장면 구분은 * * * 로 입력해요.',
  });
  E.title = title; E.body = body;
  title.disabled = body.disabled = true;
  title.addEventListener('input', onEdit);
  // 버튼을 눌러도 본문 커서가 그대로 있도록 포커스를 뺏지 않는다
  for (const bar of [tools, tableTools]) {
    bar.addEventListener('pointerdown', (e) => { if (e.target.closest('.tool')) e.preventDefault(); });
    bar.addEventListener('mousedown', (e) => { if (e.target.closest('.tool')) e.preventDefault(); });
  }
  tools.addEventListener('click', async (e) => {
    if (E.reading || !E.base) return;
    const b = e.target.closest('[data-bubble]');
    if (b) return body.toggleBubble(b.dataset.bubble);
    const l = e.target.closest('[data-list]');
    if (l) return body.toggleList(l.dataset.list);
    if (e.target.closest('[data-youtube-insert]')) return body.insertYoutube();
    if (e.target.closest('[data-table]')) {
      if (body.currentKind() === 'table') return toast('표 안에는 표를 넣을 수 없어요.');
      const size = await modal({
        title: '표 넣기',
        body: `<p class="muted small">첫 줄은 제목줄(굵게)이 돼요. 줄과 칸은 나중에 더하거나 뺄 수 있어요.</p>
          <div class="size-row"><label>줄 수 (제목줄 포함)<input type="number" id="tr" inputmode="numeric" min="2" max="30" value="3"></label>
          <label>칸 수<input type="number" id="tc" inputmode="numeric" min="2" max="8" value="3"></label></div>`,
        buttons: [{ label: '취소', value: null }, {
          label: '넣기', primary: true,
          value: (m) => ({ r: Number(m.querySelector('#tr').value), c: Number(m.querySelector('#tc').value) }),
        }],
      });
      if (size) body.insertTable(Math.min(30, Math.max(2, size.r || 3)), Math.min(8, Math.max(2, size.c || 3)));
      else body.focus();
    }
  });
  tableTools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tcmd]');
    if (!b) return;
    const r = body.tableCommand(b.dataset.tcmd);
    if (r === 'min-cols') toast('표는 칸이 2개 이상이어야 해요.');
    if (r === 'min-rows') toast('마지막 줄은 지울 수 없어요. 표 지우기를 써 주세요.');
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
  $app.querySelector('#status').onchange = (e) => store.updateChapter(wid, cid, { status: e.target.value });
  $app.querySelector('#menu').onclick = editorMenu;
  E.unsub = store.watchChapter(wid, cid, onDoc, permissionError);
  updateEditorNav();
}

function autoGrow() { /* 편집기가 내용에 맞춰 자동으로 늘어남 */ }

const current = () => ({ title: S.editor.title.value, text: S.editor.body.value });
const isDirty = () => { const E = S.editor; if (!E || !E.base) return false; const c = current(); return c.title !== E.base.title || c.text !== E.base.text; };

function onDoc(d, meta) {
  const E = S.editor;
  if (!E) return;
  E.meta = meta;
  if (!d) {
    if (!meta.fromCache) { $app.querySelector('.editor-page').innerHTML = '<p class="muted page">원고를 찾을 수 없어요. 삭제되었을 수 있어요.</p>'; }
    return;
  }
  E.doc = d;
  $app.querySelector('#status').value = d.status || 'draft';
  $app.querySelector('#status').hidden = d.kind === 'appendix';
  if (!E.base) {
    E.base = { title: d.title || '', text: normalizeText(d.text || '') };
    E.lastVersionText = null;
    setFields(E.base);
    E.title.disabled = E.body.disabled = false;
    if (S.focusTitle) { S.focusTitle = false; E.title.focus(); E.title.select(); }
  } else {
    const remote = { title: d.title || '', text: normalizeText(d.text || '') };
    const differs = remote.title !== E.base.title || remote.text !== E.base.text;
    if (differs && d.device !== DEVICE && !meta.pending) {
      if (!isDirty() && !E.timer) applyRemote(remote, true);
      else showConflict(remote);
    }
  }
  if (d.deletedAt) toast('이 원고는 휴지통에 있어요.', true);
  updateCounts(); updateSaveState(); updateEditorNav();
}

function setFields({ title, text }) {
  const E = S.editor;
  E.title.value = title; E.body.value = text;
  if (E.reading) $app.querySelector('#reader').innerHTML = renderParagraphs(text);
  updateCounts();
}

async function applyRemote(remote, silent) {
  const E = S.editor;
  // 이 기기에서 쓴 내용이 다른 기기 내용으로 바뀌기 전에 기록으로 남김
  if (E.savedInSession) store.addVersion(E.wid, E.cid, { ...E.base, reason: 'before-sync', device: DEVICE });
  E.savedInSession = false;
  E.base = remote;
  setFields(remote);
  if (silent) toast('다른 기기에서 수정한 내용으로 갱신했어요.');
}

function showConflict(remote) {
  const E = S.editor;
  E.conflict = remote;
  clearTimeout(E.timer); E.timer = null;
  const box = $app.querySelector('#conflict');
  box.innerHTML = `<div class="conflict" role="alert"><strong>다른 기기에서 더 최신 버전이 저장되었어요.</strong>
    <p>이 기기에서 쓰던 내용은 아직 저장하지 않았어요. 어느 쪽을 남길지 골라 주세요. 고르지 않은 쪽도 버전 기록에 보관돼요.</p>
    <div class="row-actions"><button type="button" class="primary" id="takeRemote">다른 기기 버전 불러오기</button>
    <button type="button" id="keepMine">이 기기 내용 유지</button></div></div>`;
  box.querySelector('#takeRemote').onclick = async () => {
    await store.addVersion(E.wid, E.cid, { ...current(), reason: 'conflict-mine', device: DEVICE });
    E.conflict = null; box.innerHTML = '';
    E.savedInSession = false;
    E.base = remote; setFields(remote); updateSaveState();
    toast('다른 기기 버전을 불러왔어요. 이 기기 내용은 버전 기록에 있어요.');
  };
  box.querySelector('#keepMine').onclick = async () => {
    await store.addVersion(E.wid, E.cid, { ...remote, reason: 'conflict-other', device: '' });
    E.conflict = null; box.innerHTML = '';
    E.base = remote;
    save();
    toast('이 기기 내용으로 저장했어요. 다른 기기 버전은 버전 기록에 있어요.');
  };
  updateSaveState();
}

function onEdit() {
  const E = S.editor;
  if (!E || !E.base) return;
  updateCounts();
  if (E.conflict) return updateSaveState();
  if (!E.firstDirtyAt) E.firstDirtyAt = Date.now();
  clearTimeout(E.timer);
  const wait = Date.now() - E.firstDirtyAt > SAVE_MAX_WAIT ? 0 : SAVE_DELAY;
  E.timer = setTimeout(save, wait);
  updateSaveState();
}

async function save() {
  const E = S.editor;
  if (!E || !E.base) return;
  clearTimeout(E.timer); E.timer = null; E.firstDirtyAt = 0;
  if (E.conflict) return;
  const cur = current();
  if (cur.title === E.base.title && cur.text === E.base.text) return updateSaveState();
  const before = E.base;
  if (!E.sessionVersioned) {
    // 이번 편집에서 처음 바뀌는 순간, 고치기 전 내용을 남긴다 (직전 기록과 같으면 생략)
    E.sessionVersioned = true;
    try {
      const last = await latestVersion();
      if (!last || last.text !== before.text || last.title !== before.title) {
        store.addVersion(E.wid, E.cid, { ...before, reason: 'before-edit', device: DEVICE });
      }
    } catch (e) { console.error(e); }
    E.lastVersionAt = Date.now();
  }
  E.base = cur;
  E.savedInSession = true;
  store.updateChapter(E.wid, E.cid, { title: cur.title, text: cur.text, device: DEVICE }).catch((e) => { console.error(e); toast('저장 오류: ' + (e.code || e.message), true); });
  if (Date.now() - E.lastVersionAt > AUTO_VERSION_MS) {
    E.lastVersionAt = Date.now();
    E.lastVersionText = cur.text;
    store.addVersion(E.wid, E.cid, { ...cur, reason: 'auto', device: DEVICE });
  }
  updateSaveState();
}

async function latestVersion() {
  return store.latestVersion(S.editor.wid, S.editor.cid);
}

async function closeEditor() {
  const E = S.editor;
  if (!E) return;
  if (isDirty() && !E.conflict) await save();
  if (E.savedInSession && E.lastVersionText !== E.base.text) {
    store.addVersion(E.wid, E.cid, { ...E.base, reason: 'leave', device: DEVICE });
  }
  E.unsub?.();
  E.body.destroy();
  S.editor = null;
}

function updateCounts() {
  const E = S.editor;
  if (!E) return;
  const n = countChars(E.body.value);
  const w = work();
  const basis = w?.targetBasis === 'withSpace' ? 'withSpace' : 'noSpace';
  const target = Number(w?.target) || 0;
  const pct = target ? Math.min(100, Math.round((n[basis] / target) * 100)) : 0;
  const live = document.getElementById('liveCount');
  if (live) live.textContent = fmt(n.noSpace) + '자' + (target ? ` · ${pct}%` : '');
  $app.querySelector('#counts').innerHTML = `공백 제외 <b>${fmt(n.noSpace)}</b><span class="sep"></span>공백 포함 <b>${fmt(n.withSpace)}</b>${target ? `<span class="sep"></span>목표 ${fmt(target)}자의 ${pct}%` : ''}`;
  const bar = $app.querySelector('#bar');
  bar.hidden = !target;
  if (target) bar.firstElementChild.style.width = pct + '%';
}

function updateSaveState() {
  const E = S.editor;
  const el = document.getElementById('saveState');
  if (!E || !el) return;
  let txt; let cls = '';
  if (E.conflict) { txt = '저장 멈춤'; cls = 'warn'; }
  else if (E.timer || isDirty()) txt = '입력 중…';
  else if (E.meta.pending) { txt = navigator.onLine ? '저장 중…' : '기기에 저장됨'; cls = navigator.onLine ? '' : 'warn'; }
  else if (!E.base) txt = '불러오는 중…';
  else { txt = '저장됨 ✓'; cls = 'ok'; }
  el.textContent = txt; el.className = 'save-state ' + cls;
}

function updateEditorNav() {
  const E = S.editor;
  if (!E) return;
  const c = S.chapters.find((x) => x.id === E.cid);
  const nav = document.getElementById('edNav');
  if (!c || !nav) return;
  document.getElementById('chLabel').textContent = c.deletedAt ? '휴지통' : label(c);
  const list = active(c.kind);
  const i = list.findIndex((x) => x.id === c.id);
  const prev = list[i - 1]; const next = list[i + 1];
  nav.innerHTML = `${prev ? `<a href="#/w/${E.wid}/c/${prev.id}">‹ ${h(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a href="#/w/${E.wid}/c/${next.id}" class="next">${h(next.title)} ›</a>` : '<span></span>'}`;
}

async function editorMenu() {
  const E = S.editor;
  if (!E || !E.base) return;
  const c0 = S.chapters.find((x) => x.id === E.cid) || E.doc;
  const v = await modal({
    title: '메뉴',
    body: `<div class="menu-list">
      <button type="button" data-resolve="read">${E.reading ? '편집으로 돌아가기' : '읽기 모드로 보기'}</button>
      <button type="button" data-resolve="history">버전 기록 보기</button>
      <button type="button" data-resolve="snap">지금 상태를 버전으로 저장</button>
      <button type="button" data-resolve="docx">이 원고 워드(docx)로 내려받기</button>
      <button type="button" data-resolve="txt">이 원고 텍스트(txt)로 내려받기</button>
      <button type="button" data-resolve="kind">${c0.kind === 'chapter' ? '부록으로 옮기기' : '회차로 옮기기'}</button>
      <button type="button" data-resolve="trash" class="danger">휴지통으로 옮기기</button></div>`,
    buttons: [{ label: '닫기', value: null }],
  });
  if (!v || S.editor !== E) return;
  const c = S.chapters.find((x) => x.id === E.cid) || E.doc;
  if (v === 'read') {
    E.reading = !E.reading;
    const r = $app.querySelector('#reader');
    r.hidden = !E.reading; E.body.hidden = E.reading; E.title.readOnly = E.reading;
    $app.querySelector('#edTools').hidden = E.reading;
    $app.querySelector('#tableTools').hidden = true;
    if (E.reading) r.innerHTML = renderParagraphs(E.body.value); else autoGrow();
  } else if (v === 'history') {
    location.hash = `#/w/${E.wid}/c/${E.cid}/h`;
  } else if (v === 'snap') {
    if (isDirty()) await save();
    await store.addVersion(E.wid, E.cid, { ...current(), reason: 'manual', device: DEVICE });
    E.lastVersionText = E.body.value; E.lastVersionAt = Date.now();
    toast('지금 상태를 버전으로 저장했어요.');
  } else if (v === 'docx' || v === 'txt') {
    const heading = c.kind === 'chapter' ? `${String(chapterNo(c)).padStart(2, '0')} · ${E.title.value}` : `부록 · ${E.title.value}`;
    const items = [{ heading, text: E.body.value }];
    try {
      if (v === 'txt') exportTxt(heading, items);
      else { toast('워드 파일을 만드는 중…'); await exportDocx(heading, items); }
    } catch (err) { console.error(err); toast('내보내지 못했어요.', true); }
  } else if (v === 'kind') {
    const kind = c.kind === 'chapter' ? 'appendix' : 'chapter';
    const list = active(kind);
    const order = (list.length ? Math.max(...list.map((x) => x.order ?? 0)) : (kind === 'appendix' ? 100000 : 0)) + 10;
    await store.updateChapter(E.wid, E.cid, { kind, order });
    toast(kind === 'appendix' ? '부록 맨 뒤로 옮겼어요.' : '회차 맨 뒤로 옮겼어요.');
  } else if (v === 'trash') {
    if (await confirmBox('휴지통으로 옮기기', `‘${h(E.title.value)}’을 휴지통으로 옮길까요? 휴지통에서 언제든 복원할 수 있어요.`, '옮기기')) {
      if (isDirty()) await save();
      await store.updateChapter(E.wid, E.cid, { deletedAt: Date.now() });
      location.hash = `#/w/${E.wid}`;
    }
  }
}

// ───────── 버전 기록 ─────────
async function renderHistory(wid, cid) {
  S.view = 'history';
  const c = S.chapters.find((x) => x.id === cid);
  $app.innerHTML = topbar({ back: `#/w/${wid}/c/${cid}`, backLabel: c ? c.title : '원고', title: '버전 기록' }) +
    '<main class="page"><h1 class="page-title">버전 기록</h1><p class="muted">불러오는 중…</p></main>';
  let list;
  try { list = await store.listVersions(wid, cid); } catch (e) { return permissionError(e); }
  if (S.view !== 'history') return;
  // 오래된 자동 기록 정리
  if (list.length > MAX_VERSIONS) {
    const extra = list.slice(MAX_VERSIONS).filter((v) => v.reason !== 'import');
    extra.forEach((v) => store.deleteVersion(wid, cid, v.id));
    list = list.filter((v) => !extra.includes(v));
  }
  const cur = S.chapters.find((x) => x.id === cid) || { title: '', text: '' };
  const main = $app.querySelector('main');
  main.innerHTML = `<h1 class="page-title">버전 기록</h1>
    <p class="muted small">고치기 전 내용, 10분마다의 자동 기록, 편집을 마칠 때의 내용이 남아요. 항목을 누르면 지금 원고와 비교할 수 있어요.</p>
    ${list.length ? `<ul class="ver-list">${list.map((v) => {
      const n = countChars(v.text);
      return `<li><button type="button" class="ver" data-id="${v.id}"><span>${dateTime(v.createdAt)}</span>
        <span class="muted small">${REASON[v.reason] || v.reason} · ${fmt(n.noSpace)}자${v.title !== cur.title ? ` · 제목: ${h(v.title)}` : ''}</span></button></li>`;
    }).join('')}</ul>` : '<p class="muted">아직 기록이 없어요. 원고를 고치기 시작하면 고치기 전 내용이 자동으로 남아요.</p>'}`;
  main.querySelectorAll('.ver').forEach((b) => { b.onclick = () => showVersion(wid, cid, list.find((v) => v.id === b.dataset.id)); });
}

async function showVersion(wid, cid, v) {
  const cur = S.chapters.find((x) => x.id === cid) || { title: '', text: '' };
  const hasYoutube = (v.text || '').includes(YOUTUBE_MARK) || (cur.text || '').includes(YOUTUBE_MARK);
  const parts = diffWordsWithSpace(hasYoutube ? plainText(v.text || '') : v.text || '', hasYoutube ? plainText(cur.text || '') : cur.text || '');
  const changed = parts.some((p) => p.added || p.removed);
  const visualOnly = hasYoutube && !changed && v.text !== cur.text;
  const diffHtml = parts.map((p) => {
    let v = p.value;
    if (!p.added && !p.removed && v.length > 360) v = v.slice(0, 120) + '\u0000' + v.slice(-120);
    const t = h(v).replace(/\n/g, '<br>').replace('\u0000', '<span class="gap"> … </span>');
    return p.added ? `<ins>${t}</ins>` : p.removed ? `<del>${t}</del>` : `<span>${t}</span>`;
  }).join('');
  const n = countChars(v.text);
  const res = await modal({
    title: dateTime(v.createdAt),
    body: `<p class="muted small">${REASON[v.reason] || v.reason} · ${fmt(n.noSpace)}자 · 제목: ${h(v.title)}</p>
      <div class="tabs"><button type="button" class="tab on" data-t="diff">지금과 비교</button><button type="button" class="tab" data-t="full">이 버전 전체</button></div>
      <div class="diff" data-p="diff">${changed ? diffHtml : visualOnly ? '<p class="muted">문구는 같고 화면 이미지나 표시 설정이 달라요. ‘이 버전 전체’에서 확인해 주세요.</p>' : '<p class="muted">지금 원고와 내용이 같아요.</p>'}</div>
      <div class="reader" data-p="full" hidden>${renderParagraphs(v.text)}</div>
      <p class="muted small legend"><del>빨간 줄</del> 이 버전에만 있음 · <ins>초록</ins> 지금 원고에만 있음</p>`,
    buttons: [{ label: '닫기', value: null }, { label: '이 버전으로 복원', primary: true, value: 'restore' }],
    onOpen: (m) => m.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => {
        m.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
        m.querySelectorAll('[data-p]').forEach((p) => { p.hidden = p.dataset.p !== t.dataset.t; });
        m.querySelector('.legend').hidden = t.dataset.t !== 'diff';
      };
    }),
  });
  if (res !== 'restore') return;
  if (!await confirmBox('복원', '이 버전으로 되돌릴까요? 지금 내용은 ‘복원 전 내용’으로 버전 기록에 남아요.', '복원')) return;
  await store.addVersion(wid, cid, { title: cur.title, text: cur.text, reason: 'before-restore', device: DEVICE });
  await store.updateChapter(wid, cid, { title: v.title, text: v.text, device: DEVICE });
  toast('복원했어요.');
  location.hash = `#/w/${wid}/c/${cid}`;
}

// ───────── 시작 ─────────
window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('오류: ' + ((e.reason && (e.reason.code || e.reason.message)) || e.reason), true); });
window.addEventListener('online', () => { updateSaveState(); refreshNet(); });
window.addEventListener('offline', () => { updateSaveState(); refreshNet(); });
function refreshNet() {
  const right = document.querySelector('.topbar-right');
  if (!right) return;
  right.querySelector('.pill')?.remove();
  if (!navigator.onLine) right.insertAdjacentHTML('afterbegin', netBadge());
}
// 앱을 벗어나거나 다른 앱으로 전환할 때 바로 저장
const flush = () => { if (S.editor && (S.editor.timer || isDirty())) save(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', (e) => { if (S.editor && isDirty() && !S.editor.conflict) { flush(); } });
setInterval(() => { if (S.view === 'editor') updateSaveState(); }, 5000);

store.onAuth((user) => {
  S.worksUnsub?.(); S.chaptersUnsub?.();
  S.worksUnsub = S.chaptersUnsub = null;
  S.wid = null; S.chapters = []; S.works = []; S.worksReady = false; S.editor = null;
  S.user = user;
  if (!user) return renderLogin();
  S.worksUnsub = store.watchWorks((list) => {
    S.works = list;
    S.worksReady = true;
    if (S.view === 'home') renderHome();
    else if (S.view === 'work') renderWork();
  }, permissionError);
  route();
});

if ('serviceWorker' in navigator && store.kind !== 'mock') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
