// 글자 수, 본문 렌더링, 기존 html 해석 등 텍스트 관련 도우미
import { parseYoutube, serializeYoutube, youtubeLines, renderYoutube } from './youtube.js';

export function countChars(text) {
  const t = stripMarkers(text);
  const withSpace = [...t.replace(/\n/g, '')].length;
  const noSpace = [...t.replace(/\s/g, '')].length;
  return { withSpace, noSpace };
}

export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SCENE = /^\s*(\*|\*\*\*|\*\s+\*\s+\*)\s*$/;
export const isSceneBreak = (t) => SCENE.test(t);
// 말풍선 표시: 문단 첫머리 "<< " = 상대(회색, 왼쪽), ">> " = 나(파랑, 오른쪽)
const BUBBLE = /^(<<|>>) ?/;
export const MARK = { other: '<< ', me: '>> ' };

// 목록·표: 문단 첫 줄에 머리표를 붙여 저장한다
//   ::목록 / ::번호  → 다음 줄부터 한 줄에 한 항목
//   ::표            → 다음 줄부터 한 줄에 한 행, 칸은 " | "로 구분, 첫 행은 제목줄
export const HEAD = { bullet: '::목록', ordered: '::번호', table: '::표' };
const HEAD_RE = /^::(목록|번호|표)\s*$/;
const cellClean = (c) => String(c ?? '').replace(/\|/g, '｜').replace(/\s*\n\s*/g, ' ');

// 빈 줄 = 문단, 줄바꿈 = 줄, * * * = 장면 구분 (기존 html과 같은 규칙)
export function blocks(text) {
  return (text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((b) => {
      const youtube = parseYoutube(b);
      if (youtube) return { youtube, lines: youtubeLines(youtube) };
      const all = b.split('\n');
      const h = all[0].match(HEAD_RE);
      if (h) {
        const rest = all.slice(1);
        if (h[1] === '표') {
          let rows = rest.map((line) => line.split(/ ?\| ?/));
          const cols = Math.max(2, ...rows.map((r) => r.length));
          if (!rows.length) rows = [['', '']];
          rows = rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
          return { table: rows, lines: rows.map((r) => r.filter(Boolean).join(' ')) };
        }
        return { list: h[1] === '번호' ? 'ordered' : 'bullet', items: rest, lines: rest };
      }
      if (SCENE.test(b)) return { scene: true, lines: [b] };
      const m = b.match(BUBBLE);
      if (m) return { bubble: m[1] === '>>' ? 'me' : 'other', lines: b.slice(m[0].length).split('\n') };
      return { lines: all };
    });
}

function blockText(b) {
  if (b.youtube) return serializeYoutube(b.youtube);
  if (b.table) return HEAD.table + '\n' + b.table.map((r) => r.map(cellClean).join(' | ')).join('\n');
  if (b.list) {
    const items = b.items.map((t) => t.replace(/\s*\n\s*/g, ' ')).filter((t) => t.trim());
    return items.length ? HEAD[b.list] + '\n' + items.join('\n') : '';
  }
  return (b.bubble ? MARK[b.bubble] : '') + b.lines.join('\n');
}

export function joinBlocks(list) {
  return list.map(blockText).filter((t) => t.trim()).join('\n\n');
}

// 편집기가 저장하는 모양과 똑같이 맞춘 글 (비교용)
export const normalizeText = (text) => joinBlocks(blocks(text));

// 표시 없이 글만 (글자 수 세기용)
export const stripMarkers = (text) => blocks(text).map((b) => b.lines.join('\n')).join('\n\n');

// txt 내보내기용: 목록은 •/번호, 표는 칸을 | 로
export const plainText = (text) => blocks(text).map((b) => {
  if (b.table) return b.table.map((r) => r.join(' | ')).join('\n');
  if (b.list) return b.items.filter((t) => t.trim()).map((t, i) => (b.list === 'ordered' ? `${i + 1}. ` : '• ') + t).join('\n');
  return b.lines.join('\n');
}).join('\n\n');

export function renderParagraphs(text) {
  return blocks(text).map((b) => {
    if (b.youtube) return renderYoutube(b.youtube);
    if (b.scene) return '<p class="scene-break">* * *</p>';
    if (b.list) {
      const tag = b.list === 'ordered' ? 'ol' : 'ul';
      return `<${tag}>${b.items.filter((t) => t.trim()).map((t) => `<li><p>${escapeHtml(t)}</p></li>`).join('')}</${tag}>`;
    }
    if (b.table) {
      const [head, ...body] = b.table;
      return `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th><p>${escapeHtml(c)}</p></th>`).join('')}</tr></thead>`
        + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td><p>${escapeHtml(c)}</p></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    const inner = b.lines.map(escapeHtml).join('<br>');
    return b.bubble ? `<div class="bubble ${b.bubble}">${inner}</div>` : `<p>${inner}</p>`;
  }).join('');
}

// ── 기존 '원고 모음' html 해석 ──
function textOf(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.matches('section.youtube-screen[data-youtube]')) {
    try { const d = JSON.parse(node.dataset.youtube); if (d.version === 1) return serializeYoutube(d); } catch { /* 원본 텍스트로 가져오기 */ }
  }
  if (node.tagName === 'BR') return '\n';
  return Array.from(node.childNodes, textOf).join('');
}

export function parseLegacyHtml(html) {
  const docu = new DOMParser().parseFromString(html, 'text/html');
  const h1 = docu.querySelector('header h1') || docu.querySelector('h1');
  const sub = docu.querySelector('header p');
  const work = {
    title: (h1 ? h1.textContent : docu.title || '가져온 작품').trim(),
    subtitle: sub ? sub.textContent.trim() : '',
  };
  const chapters = [];
  const appendices = [];
  docu.querySelectorAll('details').forEach((d) => {
    if (d.classList.contains('chapter')) {
      const art = d.querySelector('article.manuscript') || d.querySelector('article');
      if (!art) return;
      const text = Array.from(art.children, textOf).join('\n\n').trim();
      const title = (d.dataset.title || summaryTitle(d)).trim();
      chapters.push({ title, text, num: Number(d.dataset.number) || chapters.length + 1 });
    } else {
      const art = d.querySelector('article');
      if (!art) return;
      const text = Array.from(art.children)
        .filter((n) => !n.classList.contains('back') && !n.classList.contains('back-link'))
        .map(textOf).join('\n\n').trim();
      let title = summaryTitle(d).replace(/^부록\s*[·:]\s*/, '');
      appendices.push({ title, text });
    }
  });
  chapters.sort((a, b) => a.num - b.num);
  return { work, chapters, appendices };
}

function summaryTitle(d) {
  const s = d.querySelector('summary');
  if (!s) return '제목 없음';
  const h = s.querySelector('.chapter-heading');
  return (h ? h.textContent : s.textContent).replace(/^\d+\s*·\s*/, '').trim();
}

export function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60e3) return '방금';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + '분 전';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + '시간 전';
  return dateTime(ms);
}

export function dateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
