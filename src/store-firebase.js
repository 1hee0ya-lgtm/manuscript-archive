// Firebase(로그인 + Firestore) 저장소. 앱은 이 파일의 store 객체만 사용한다.
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, limit, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let uid = null;
const worksCol = () => collection(db, 'users', uid, 'works');
const workDoc = (wid) => doc(db, 'users', uid, 'works', wid);
const chaptersCol = (wid) => collection(db, 'users', uid, 'works', wid, 'chapters');
const chapterDoc = (wid, cid) => doc(db, 'users', uid, 'works', wid, 'chapters', cid);
const versionsCol = (wid, cid) => collection(db, 'users', uid, 'works', wid, 'chapters', cid, 'versions');

function plain(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  if (!d) return null;
  const out = { id: snap.id, ...d };
  for (const k of ['updatedAt', 'createdAt', 'deletedAt']) {
    if (out[k] && typeof out[k].toMillis === 'function') out[k] = out[k].toMillis();
  }
  return out;
}
const meta = (snap) => ({ fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });

export const store = {
  kind: 'firebase',

  onAuth(cb) {
    getRedirectResult(auth).catch(() => {});
    return onAuthStateChanged(auth, (user) => {
      uid = user ? user.uid : null;
      cb(user ? { uid: user.uid, label: user.email || user.displayName || '로그인됨' } : null);
    });
  },
  async signInGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        await signInWithRedirect(auth, provider);
      } else throw e;
    }
  },
  signInEmail: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
  signOut: () => signOut(auth),

  watchWorks(cb, onError) {
    return onSnapshot(worksCol(), { includeMetadataChanges: true },
      (s) => cb(s.docs.map(plain), meta(s)), onError);
  },
  async createWork(data) {
    const ref = doc(worksCol());
    await setDocQuiet(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  },
  updateWork(wid, patch) {
    return updateDoc(workDoc(wid), { ...patch, updatedAt: serverTimestamp() });
  },

  watchChapters(wid, cb, onError) {
    return onSnapshot(chaptersCol(wid), { includeMetadataChanges: true },
      (s) => cb(s.docs.map(plain), meta(s)), onError);
  },
  watchChapter(wid, cid, cb, onError) {
    return onSnapshot(chapterDoc(wid, cid), { includeMetadataChanges: true },
      (s) => cb(s.exists() ? plain(s) : null, meta(s)), onError);
  },
  async createChapter(wid, data) {
    const ref = doc(chaptersCol(wid));
    await setDocQuiet(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    touchWork(wid);
    return ref.id;
  },
  updateChapter(wid, cid, patch) {
    const p = updateDoc(chapterDoc(wid, cid), { ...patch, updatedAt: serverTimestamp() });
    touchWork(wid);
    return p;
  },
  deleteChapterForever(wid, cid) {
    return deleteDoc(chapterDoc(wid, cid));
  },
  async setOrders(wid, items) {
    const batch = writeBatch(db);
    for (const it of items) batch.update(chapterDoc(wid, it.id), { order: it.order });
    await quiet(batch.commit());
  },

  // 여러 회차를 한 번에 추가 (가져오기용). 각 회차에 '가져오기' 버전도 남긴다.
  async addChapters(wid, chapters) {
    let batch = writeBatch(db); let n = 0;
    const commits = [];
    for (const ch of chapters) {
      const ref = doc(chaptersCol(wid));
      batch.set(ref, { ...ch, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(versionsCol(wid, ref.id)), {
        title: ch.title, text: ch.text, reason: 'import', device: ch.device || '', createdAt: serverTimestamp(),
      });
      n += 2;
      if (n >= 400) { commits.push(batch.commit()); batch = writeBatch(db); n = 0; }
    }
    if (n) commits.push(batch.commit());
    touchWork(wid);
    await quiet(Promise.all(commits));
  },

  async listVersions(wid, cid) {
    const s = await getDocs(query(versionsCol(wid, cid), orderBy('createdAt', 'desc')));
    return s.docs.map(plain);
  },
  async latestVersion(wid, cid) {
    const s = await getDocs(query(versionsCol(wid, cid), orderBy('createdAt', 'desc'), limit(1)));
    return s.docs.length ? plain(s.docs[0]) : null;
  },
  async addVersion(wid, cid, v) {
    const ref = doc(versionsCol(wid, cid));
    await setDocQuiet(ref, { ...v, createdAt: serverTimestamp() });
    return ref.id;
  },
  deleteVersion(wid, cid, vid) {
    return deleteDoc(doc(versionsCol(wid, cid), vid));
  },
};

// 오프라인이면 서버 확인을 기다리지 않는다(기기에는 즉시 저장되고, 연결되면 자동 업로드).
function quiet(promise) {
  if (navigator.onLine) return promise;
  promise.catch((e) => console.error(e));
  return Promise.resolve();
}
function setDocQuiet(ref, data) { return quiet(setDoc(ref, data)); }
let touchTimer = null;
function touchWork(wid) {
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => updateDoc(workDoc(wid), { updatedAt: serverTimestamp() }).catch(() => {}), 3000);
}
