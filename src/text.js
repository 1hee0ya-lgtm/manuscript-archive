// 글자 수, 본문 렌더링, 기존 html 해석 등 텍스트 관련 도우미

export function countChars(text) {
  const t = (text || '').replace(/\r\n?/g, '\n');
  const withSpace = [...t.replace(/\n/g, '')].length;
  const noSpace = [...t.replace(/\s/g, '')].length;
  return { withSpace, noSpace };
}

export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SCENE = /^\s*(\*|\*\*\*|\*\s+\*\s+\*)\s*$/;

// 빈 줄 = 문단, 줄바꿈 = 줄, * * * = 장면 구분 (기존 html과 같은 규칙)
export function blocks(text) {
  return (text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((b) => (SCENE.test(b) ? { scene: true } : { lines: b.split('\n') }));
}

export function renderParagraphs(text) {
  return blocks(text).map((b) => (b.scene
    ? '<p class="scene-break">* * *</p>'
    : '<p>' + b.lines.map(escapeHtml).join('<br>') + '</p>')).join('');
}

// ── 기존 '원고 모음' html 해석 ──
function textOf(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
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
