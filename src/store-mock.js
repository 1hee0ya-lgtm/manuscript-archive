// 테스트 전용 모의 저장소. localStorage를 '서버'로 쓰고, 탭 하나를 기기 하나로 취급한다.
const KEY = 'mockdb';
const empty = () => ({ works: {}, chapters: {}, versions: {} });
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || empty(); } catch { return empty(); } };
let queue = [];
let offline = false;
const listeners = new Set();
const rid = () => Math.random().toString(36).slice(2, 12);

function view() { const d = load(); for (const op of queue) op(d); return d; }
function emit(pending) { const d = view(); for (const l of listeners) l(d, { fromCache: offline, pending }); }
function flash() { emit(true); setTimeout(() => emit(queue.length > 0), 250); }
function commit(op) {
  if (offline) { queue.push(op); emit(true); return; }
  const d = load(); op(d); localStorage.setItem(KEY, JSON.stringify(d)); flash();
}
window.addEventListener('storage', (e) => { if (e.key === KEY) emit(queue.length > 0); });
window.__setOffline = (v) => {
  offline = v;
  if (!v && queue.length) { const d = load(); for (const op of queue) op(d); queue = []; localStorage.setItem(KEY, JSON.stringify(d)); }
  flash();
};
function listen(fn) { listeners.add(fn); setTimeout(() => fn(view(), { fromCache: false, pending: queue.length > 0 }), 0); return () => listeners.delete(fn); }
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const clone = (o) => JSON.parse(JSON.stringify(o));

export const store = {
  kind: 'mock',
  onAuth(cb) {
    const u = sessionStorage.getItem('mockUser');
    setTimeout(() => cb(u ? { uid: 'me', label: u } : null), 0);
    this._cb = cb;
    return () => {};
  },
  async signInGoogle() { sessionStorage.setItem('mockUser', 'test@example.com'); this._cb({ uid: 'me', label: 'test@example.com' }); },
  async signInEmail(e) { sessionStorage.setItem('mockUser', e); this._cb({ uid: 'me', label: e }); },
  async signOut() { sessionStorage.removeItem('mockUser'); this._cb(null); },

  watchWorks(cb) { return listen((d, m) => cb(Object.values(d.works).map(clone).sort(byOrder), m)); },
  async createWork(data) {
    const id = rid(); const t = Date.now();
    commit((d) => { d.works[id] = { id, ...data, createdAt: t, updatedAt: t }; d.chapters[id] = d.chapters[id] || {}; });
    return id;
  },
  async updateWork(wid, patch) { const t = Date.now(); commit((d) => Object.assign(d.works[wid], patch, { updatedAt: t })); },

  watchChapters(wid, cb) { return listen((d, m) => cb(Object.values(d.chapters[wid] || {}).map(clone).sort(byOrder), m)); },
  watchChapter(wid, cid, cb) { return listen((d, m) => { const c = (d.chapters[wid] || {})[cid]; cb(c ? clone(c) : null, m); }); },
  async createChapter(wid, data) {
    const id = rid(); const t = Date.now();
    commit((d) => { (d.chapters[wid] ||= {})[id] = { id, ...data, createdAt: t, updatedAt: t }; });
    return id;
  },
  async updateChapter(wid, cid, patch) {
    const t = Date.now();
    commit((d) => { const c = d.chapters[wid][cid]; if (c) Object.assign(c, patch, { updatedAt: t }); d.works[wid].updatedAt = t; });
  },
  async deleteChapterForever(wid, cid) { commit((d) => { delete d.chapters[wid][cid]; delete d.versions[wid + '/' + cid]; }); },
  async setOrders(wid, items) { commit((d) => { for (const it of items) d.chapters[wid][it.id].order = it.order; }); },
  async addChapters(wid, chapters) {
    const t = Date.now();
    const rows = chapters.map((ch) => ({ id: rid(), ch, vid: rid() }));
    commit((d) => {
      for (const { id, ch, vid } of rows) {
        (d.chapters[wid] ||= {})[id] = { id, ...ch, createdAt: t, updatedAt: t };
        d.versions[wid + '/' + id] = { [vid]: { id: vid, title: ch.title, text: ch.text, reason: 'import', createdAt: t } };
      }
    });
  },
  async listVersions(wid, cid) {
    return Object.values(view().versions[wid + '/' + cid] || {}).map(clone).sort((a, b) => b.createdAt - a.createdAt);
  },
  async latestVersion(wid, cid) { return (await this.listVersions(wid, cid))[0] || null; },
  async addVersion(wid, cid, v) {
    const id = rid(); const t = Date.now();
    commit((d) => { (d.versions[wid + '/' + cid] ||= {})[id] = { id, ...v, createdAt: t }; });
    return id;
  },
  async deleteVersion(wid, cid, vid) { commit((d) => { delete (d.versions[wid + '/' + cid] || {})[vid]; }); },
};
