// 원고 속 모바일 유튜브 화면. 이미지와 댓글도 원고의 텍스트 안에 함께 보관한다.
export const YOUTUBE_MARK = '::유튜브 ';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (s, fallback = '') => typeof s === 'string' ? s : fallback;
const imageSrc = (s) => typeof s === 'string' && /^(data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+|https:\/\/[^\s]+)$/.test(s) ? s : '';

function cleanComment(c = {}, reply = false) {
  return {
    author: str(c.author), avatar: imageSrc(c.avatar), time: str(c.time), text: str(c.text), likes: str(c.likes),
    ...(reply ? {} : { replyCount: str(c.replyCount), replies: (Array.isArray(c.replies) ? c.replies : []).map((r) => cleanComment(r, true)) }),
  };
}

export function normalizeYoutube(input = {}) {
  const d = input && typeof input === 'object' ? input : {};
  return {
    version: 1, layout: d.layout === 'watch' ? 'watch' : 'comments',
    ratio: d.ratio === 'portrait' ? 'portrait' : 'landscape', fit: d.fit === 'contain' ? 'contain' : 'cover',
    image: imageSrc(d.image), title: str(d.title), channel: str(d.channel), avatar: imageSrc(d.avatar),
    subscribers: str(d.subscribers), views: str(d.views), published: str(d.published), likes: str(d.likes),
    currentTime: str(d.currentTime), duration: str(d.duration), controls: !!d.controls,
    progress: Math.min(100, Math.max(0, Number(d.progress) || 0)),
    commentCount: str(d.commentCount), sort: d.sort === 'latest' ? 'latest' : 'popular',
    comments: (Array.isArray(d.comments) ? d.comments : []).map((c) => cleanComment(c)),
  };
}

export function defaultYoutube() {
  return normalizeYoutube({
    title: '영상 제목을 입력해 주세요', channel: '채널 이름', subscribers: '구독자 1.2만명',
    views: '조회수 12만회', published: '3개월 전', likes: '1.2천', currentTime: '0:42', duration: '4:18', progress: 16,
    comments: [
      { author: '@첫번째댓글', time: '3일 전', text: '이 장면이 너무 좋아서 계속 돌려 보고 있어요.', likes: '844', replyCount: '3' },
      { author: '@두번째댓글', time: '1일 전', text: '댓글 내용은 자유롭게 바꿀 수 있어요.\n줄바꿈도 그대로 보여요.', likes: '671', replyCount: '3' },
    ],
  });
}

export const serializeYoutube = (data) => YOUTUBE_MARK + JSON.stringify(normalizeYoutube(data));
export function parseYoutube(block) {
  if (!block.startsWith(YOUTUBE_MARK)) return null;
  try {
    const d = JSON.parse(block.slice(YOUTUBE_MARK.length));
    return d && typeof d === 'object' && !Array.isArray(d) && d.version === 1 ? normalizeYoutube(d) : null;
  } catch { return null; }
}

export function youtubeLines(input) {
  const d = normalizeYoutube(input);
  const lines = ['[유튜브 화면]', d.title, [d.channel, d.subscribers].filter(Boolean).join(' · '),
    [d.views, d.published].filter(Boolean).join(' · '),
    [d.currentTime && `재생 ${d.currentTime}${d.duration ? ' / ' + d.duration : ''}`, d.likes && `좋아요 ${d.likes}`].filter(Boolean).join(' · '),
    `댓글${d.commentCount ? ' ' + d.commentCount : ''} (${d.sort === 'latest' ? '최신순' : '인기순'})`];
  for (const c of d.comments) {
    lines.push([c.author, c.time].filter(Boolean).join(' · '), c.text,
      [c.likes && `좋아요 ${c.likes}`, (c.replyCount || c.replies.length) && `답글 ${c.replyCount || c.replies.length}개`].filter(Boolean).join(' · '));
    for (const r of c.replies) lines.push('↳ ' + [r.author, r.time].filter(Boolean).join(' · '), r.text, r.likes ? `좋아요 ${r.likes}` : '');
  }
  return lines.filter(Boolean);
}

const paths = {
  like: '<path d="M7 10v11H3V10h4Zm0 1 5-8c2 0 3 1.5 2.5 3.5L14 10h5a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 2H7"/>',
  dislike: '<path d="M7 14V3H3v11h4Zm0-1 5 8c2 0 3-1.5 2.5-3.5L14 14h5a2 2 0 0 0 2-2l-1.5-7a2 2 0 0 0-2-2H7"/>',
  reply: '<path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6 4V4a1 1 0 0 1 1-1Z"/><path d="M7 8h10M7 12h7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7m-2 0h4"/><circle cx="12" cy="7" r=".5" fill="currentColor"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  share: '<path d="m14 3 8 7-8 7v-4C6 13 3 16 2 20c0-9 4-13 12-13V3Z"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
};
export const youtubeIcon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;

function avatar(src, name, i = 0) {
  const initial = (name || '?').replace(/^@/, '').trim().slice(0, 1) || '?';
  return `<span class="yt-avatar yt-color-${i % 5}">${src ? `<img src="${esc(src)}" alt="${esc(name || '프로필')}" loading="lazy">` : `<span>${esc(initial)}</span>`}</span>`;
}

function commentHtml(c, i, reply = false) {
  const count = c.replyCount || c.replies?.length;
  return `<div class="yt-comment${reply ? ' yt-reply' : count ? ' yt-threaded' : ''}">
    ${avatar(c.avatar, c.author, i)}<div class="yt-comment-body">
      <div class="yt-comment-meta"><span>${esc(c.author || '@작성자')}${c.time ? ' · ' + esc(c.time) : ''}</span><span class="yt-more">${youtubeIcon('more')}</span></div>
      <div class="yt-comment-text">${esc(c.text)}</div>
      <div class="yt-comment-actions"><span>${youtubeIcon('like')}${c.likes ? `<span>${esc(c.likes)}</span>` : ''}</span><span>${youtubeIcon('dislike')}</span><span>${youtubeIcon('reply')}</span></div>
      ${!reply && count ? (c.replies?.length
        ? `<details class="yt-replies"><summary>답글 ${esc(count)}개 ${youtubeIcon('chevron')}</summary><div>${c.replies.map((r, j) => commentHtml(r, j + i + 1, true)).join('')}</div></details>`
        : `<div class="yt-replies yt-replies-count">답글 ${esc(count)}개 ${youtubeIcon('chevron')}</div>`) : ''}
    </div></div>`;
}

// 배경색은 시스템 테마와 무관하게 흰색. data-youtube는 복사/붙여넣기 때 원본을 보존한다.
export function renderYoutube(input) {
  const d = normalizeYoutube(input);
  return `<section class="youtube-screen" data-youtube="${esc(JSON.stringify(d))}" aria-label="유튜브 모바일 화면">
    <div class="yt-video${d.ratio === 'portrait' ? ' yt-video-portrait' : ''}${d.fit === 'contain' ? ' yt-video-contain' : ''}">
      ${d.image ? `<img class="yt-frame" src="${esc(d.image)}" alt="${esc(d.title || '영상 화면')}" loading="lazy">` : `<div class="yt-no-frame">${youtubeIcon('image')}<span>영상 이미지를 추가해 주세요</span></div>`}
      ${d.controls ? `<div class="yt-playback">${youtubeIcon('pause')}<span>${esc(d.currentTime)}${d.duration ? ' / ' + esc(d.duration) : ''}</span><span class="yt-fullscreen">⛶</span></div>` : ''}
      <div class="yt-progress"><span style="width:${d.progress}%"></span></div>
    </div>
    ${d.layout === 'watch' ? `<div class="yt-watch-info">
      <div class="yt-title">${esc(d.title)}</div><div class="yt-video-meta">${esc([d.views, d.published].filter(Boolean).join(' · '))}</div>
      <div class="yt-channel">${avatar(d.avatar, d.channel, 4)}<div><strong>${esc(d.channel)}</strong><span>${esc(d.subscribers)}</span></div><span class="yt-subscribe">구독</span></div>
      <div class="yt-watch-actions"><span>${youtubeIcon('like')}${esc(d.likes)}<i></i>${youtubeIcon('dislike')}</span><span>${youtubeIcon('share')}공유</span></div>
    </div>` : ''}
    <div class="yt-comments-sheet${d.layout === 'watch' ? ' yt-comments-inline' : ''}">
      ${d.layout === 'comments' ? '<div class="yt-sheet-handle"></div>' : ''}
      <div class="yt-sheet-header"><strong>댓글${d.commentCount ? ' ' + esc(d.commentCount) : ''}</strong><span>${youtubeIcon('info')}${d.layout === 'comments' ? youtubeIcon('close') : ''}</span></div>
      <div class="yt-sort"><span class="${d.sort === 'popular' ? 'yt-active' : ''}">인기순</span><span class="${d.sort === 'latest' ? 'yt-active' : ''}">최신순</span></div>
      <div class="yt-comments">${d.comments.map((c, i) => commentHtml(c, i)).join('') || '<div class="yt-no-comments">아직 댓글이 없습니다.</div>'}</div>
    </div>
  </section>`;
}

const field = (name, label, value, type = 'text') => `<label>${esc(label)}<input type="${type}" data-field="${name}" value="${esc(value)}"${type === 'number' ? ' min="0" max="100"' : ''}></label>`;
const select = (name, label, value, options) => `<label>${esc(label)}<select data-field="${name}">${options.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
function imagePicker(key, src, label) {
  return `<div class="yt-image-field"><span>${esc(label)}</span><div class="yt-image-choice">
    <span class="yt-image-thumb">${src ? `<img src="${esc(src)}" alt="${esc(label)}">` : youtubeIcon('image')}</span>
    <label class="button small yt-file-label">사진 선택<input type="file" accept="image/*" data-image="${key}"></label>
    <button type="button" class="small ghost" data-clear-image="${key}"${src ? '' : ' disabled'}>사진 지우기</button>
    </div></div>`;
}

function commentForm(c, i, reply = false, parent = -1) {
  const key = reply ? `reply:${parent}:${i}` : `comment:${i}`;
  return `<section class="yt-comment-form" data-comment="${key}">
    <div class="yt-form-row"><strong>${reply ? '답글' : '댓글'} ${i + 1}</strong><div>
      ${!reply ? `<button type="button" class="small ghost" data-move="${i}:-1"${i ? '' : ' disabled'} aria-label="댓글 ${i + 1} 위로">↑</button><button type="button" class="small ghost" data-move="${i}:1" aria-label="댓글 ${i + 1} 아래로">↓</button>` : ''}
      <button type="button" class="small danger" data-remove="${key}">${reply ? '답글' : '댓글'} 삭제</button></div></div>
    ${imagePicker(key, c.avatar, '프로필 사진')}
    <div class="yt-form-grid">${field('author', '작성자', c.author)}${field('time', '작성 시점', c.time)}</div>
    <label>${reply ? '답글' : '댓글'} 내용<textarea data-field="text" rows="3">${esc(c.text)}</textarea></label>
    <div class="yt-form-grid">${field('likes', '좋아요 수', c.likes)}${reply ? '' : field('replyCount', '표시할 답글 수 (비우면 실제 답글 수)', c.replyCount)}</div>
    ${reply ? '' : `<details class="yt-reply-form"><summary>답글 편집 (${c.replies.length}개)</summary><div>${c.replies.map((r, j) => commentForm(r, j, true, i)).join('')}</div><button type="button" class="small" data-add-reply="${i}">+ 답글 추가</button></details>`}
  </section>`;
}

async function compressedImage(file, isAvatar) {
  if (!file || (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name))) throw new Error('사진 파일을 선택해 주세요.');
  if (file.size > 25 * 1024 * 1024) throw new Error('25MB 이하의 사진을 선택해 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('이 사진 형식을 열 수 없어요. JPG 또는 PNG로 다시 선택해 주세요.')); img.src = url; });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, (isAvatar ? 128 : 1000) / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('사진을 불러오지 못했어요.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data;
    for (const quality of [.86, .72, .55, .38]) {
      data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= (isAvatar ? 20000 : 180000)) return data;
    }
    canvas.width = Math.max(1, Math.round(canvas.width * .65)); canvas.height = Math.max(1, Math.round(canvas.height * .65));
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    data = canvas.toDataURL('image/jpeg', .6);
    if (data.length > (isAvatar ? 20000 : 180000)) throw new Error('사진이 너무 커요. 더 작은 사진을 선택해 주세요.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

// 적용 전까지 원고는 바뀌지 않는다. 취소/ESC는 미리보기의 수정도 버린다.
export function editYoutubeScreen(initial, { validate } = {}) {
  const draft = normalizeYoutube(initial || defaultYoutube());
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap yt-edit-wrap';
  wrap.innerHTML = `<div class="modal yt-edit-modal" role="dialog" aria-modal="true" aria-label="유튜브 화면 편집">
    <form class="yt-edit-form"><div class="yt-editor-header"><h2 tabindex="-1">${initial ? '유튜브 화면 편집' : '유튜브 화면 넣기'}</h2><button type="button" class="icon ghost" data-cancel aria-label="닫기">×</button></div>
    <p class="small muted">사진과 댓글을 바꾸면 미리보기에 바로 반영돼요.</p>
    <div class="yt-editor-grid"><div class="yt-fields">
      <div class="yt-form-grid">${select('layout', '화면 구성', draft.layout, [['comments', '댓글 창 펼침 (참고 사진)'], ['watch', '영상 정보 + 댓글']])}${select('ratio', '영상 비율', draft.ratio, [['landscape', '가로 영상 (16:9)'], ['portrait', '세로 영상 (9:16)']])}</div>
      ${imagePicker('image', draft.image, '영상 이미지')}
      ${select('fit', '사진 맞춤', draft.fit, [['cover', '꽉 채우기'], ['contain', '사진 전체 보이기']])}
      <details class="yt-options"><summary>영상 정보와 재생 표시</summary>
        ${field('title', '영상 제목', draft.title)}${imagePicker('avatar', draft.avatar, '채널 프로필 사진')}
        <div class="yt-form-grid">${field('channel', '채널 이름', draft.channel)}${field('subscribers', '구독자 수', draft.subscribers)}${field('views', '조회수', draft.views)}${field('published', '업로드 시점', draft.published)}${field('likes', '영상 좋아요 수', draft.likes)}${field('progress', '재생 진행률 (%)', draft.progress, 'number')}${field('currentTime', '현재 재생 시점', draft.currentTime)}${field('duration', '전체 영상 길이', draft.duration)}</div>
        <label class="yt-checkbox"><input type="checkbox" data-field="controls"${draft.controls ? ' checked' : ''}> 재생 버튼과 시간 표시</label>
      </details>
      <div class="yt-form-grid">${field('commentCount', '댓글 수 (표시할 숫자)', draft.commentCount)}${select('sort', '선택된 정렬', draft.sort, [['popular', '인기순'], ['latest', '최신순']])}</div>
      <div class="yt-form-row yt-comments-label"><strong>댓글</strong><button type="button" class="small" data-add-comment>+ 댓글 추가</button></div>
      <div class="yt-comment-fields"></div>
    </div><div class="yt-live-preview"><span class="yt-preview-label">미리보기 · 화이트 모드</span><div class="yt-preview-content"></div></div></div>
    <p class="yt-form-error" role="alert" hidden></p><div class="modal-actions yt-editor-footer"><button type="button" data-cancel>취소</button><button type="submit" class="primary" data-apply>${initial ? '적용' : '원고에 넣기'}</button></div>
    </form></div>`;
  const form = wrap.querySelector('form');
  const preview = wrap.querySelector('.yt-preview-content');
  const fields = wrap.querySelector('.yt-comment-fields');
  const err = wrap.querySelector('.yt-form-error');
  const apply = wrap.querySelector('[data-apply]');
  let uploads = 0, closed = false;
  const target = (key) => {
    const [kind, p, r] = key.split(':');
    return kind === 'comment' ? draft.comments[Number(p)] : draft.comments[Number(p)]?.replies[Number(r)];
  };
  const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const updatePreview = () => { preview.innerHTML = renderYoutube(draft); };
  const updateComments = () => { fields.innerHTML = draft.comments.map((c, i) => commentForm(c, i)).join(''); };
  const updateImage = (key, value) => {
    if (key === 'image' || key === 'avatar') draft[key] = value;
    else { const c = target(key); if (!c) return; c.avatar = value; }
    const input = Array.from(wrap.querySelectorAll('[data-image]')).find((el) => el.dataset.image === key);
    if (input) {
      const host = input.closest('.yt-image-field');
      host.querySelector('.yt-image-thumb').innerHTML = value ? `<img src="${esc(value)}" alt="선택한 사진">` : youtubeIcon('image');
      host.querySelector('[data-clear-image]').disabled = !value;
    }
    updatePreview();
  };
  updateComments(); updatePreview();
  return new Promise((resolve) => {
    const close = (result) => {
      if (closed) return;
      closed = true; wrap.remove(); document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(wrap.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea, select, summary')).filter((el) => el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!focusable.length) return;
      if (e.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    wrap.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.dataset.field) return;
      const owner = el.closest('[data-comment]');
      const d = owner ? target(owner.dataset.comment) : draft;
      if (!d) return;
      d[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      showError(''); updatePreview();
    });
    wrap.addEventListener('change', async (e) => {
      const el = e.target;
      if (!el.matches('[data-image]') || !el.files[0]) return;
      const key = el.dataset.image;
      const originalTarget = key.includes(':') ? target(key) : draft;
      uploads++; apply.disabled = true; showError('');
      try {
        const value = await compressedImage(el.files[0], key !== 'image');
        if (closed) return;
        // 업로드 중 댓글이 이동/삭제되어도 다른 댓글의 사진을 덮어쓰지 않는다.
        if (key.includes(':')) {
          let found;
          draft.comments.forEach((c, i) => { if (c === originalTarget) found = `comment:${i}`; c.replies.forEach((r, j) => { if (r === originalTarget) found = `reply:${i}:${j}`; }); });
          if (found) updateImage(found, value);
        } else updateImage(key, value);
      } catch (e) { if (!closed) showError(e.message || '사진을 불러오지 못했어요.'); }
      finally { uploads--; if (!closed) { apply.disabled = uploads > 0; el.value = ''; } }
    });
    wrap.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (e.target === wrap || button?.hasAttribute('data-cancel')) return close(null);
      if (!button) return;
      let key;
      const openReply = Array.from(wrap.querySelectorAll('.yt-reply-form')).filter((d) => d.open).map((d) => target(d.closest('[data-comment]').dataset.comment));
      if ((key = button.dataset.clearImage) != null) return updateImage(key, '');
      if (button.hasAttribute('data-add-comment')) draft.comments.push(cleanComment({ author: '@작성자', time: '방금', text: '' }));
      else if ((key = button.dataset.addReply) != null) {
        const c = draft.comments[Number(key)]; if (!c) return;
        c.replies.push(cleanComment({ author: '@작성자', time: '방금', text: '' }, true));
      } else if ((key = button.dataset.remove) != null) {
        const [kind, p, r] = key.split(':');
        if (kind === 'comment') draft.comments.splice(Number(p), 1); else draft.comments[Number(p)]?.replies.splice(Number(r), 1);
      } else if ((key = button.dataset.move) != null) {
        const [index, by] = key.split(':').map(Number), to = index + by;
        if (to < 0 || to >= draft.comments.length) return;
        [draft.comments[index], draft.comments[to]] = [draft.comments[to], draft.comments[index]];
      } else return;
      updateComments();
      wrap.querySelectorAll('.yt-reply-form').forEach((d) => { const c = target(d.closest('[data-comment]').dataset.comment); d.open = openReply.includes(c) || (button.hasAttribute('data-add-reply') && c === draft.comments[Number(button.dataset.addReply)]); });
      updatePreview();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault(); if (uploads) return;
      const result = normalizeYoutube(draft);
      const problem = validate?.(result);
      if (problem) { showError(problem); err.scrollIntoView({ block: 'nearest' }); return; }
      close(result);
    });
    document.body.append(wrap); document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('h2').focus();
  });
}
