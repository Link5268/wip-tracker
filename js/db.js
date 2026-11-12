const DB_NAME = "hx-wip-tracker";
const STORE = "files";
const STARS = "stars";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STARS)) db.createObjectStore(STARS, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function starId(supplier, prodNo) {
  return `${supplier}|${prodNo}`;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("事务已中断"));
  });
}

export async function listFiles() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll();
  const rows = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.filename).localeCompare(String(b.filename)));
}

export async function putFile(record) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record);
  await txDone(tx);
  db.close();
}

export async function deleteFile(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}

export async function replaceAll(records) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  for (const record of records) tx.objectStore(STORE).put(record);
  await txDone(tx);
  db.close();
}

export async function listStars() {
  const db = await openDb();
  const request = db.transaction(STARS, "readonly").objectStore(STARS).getAll();
  const rows = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

export async function putStar(star) {
  const db = await openDb();
  const tx = db.transaction(STARS, "readwrite");
  tx.objectStore(STARS).put(star);
  await txDone(tx);
  db.close();
}

export async function deleteStar(id) {
  const db = await openDb();
  const tx = db.transaction(STARS, "readwrite");
  tx.objectStore(STARS).delete(id);
  await txDone(tx);
  db.close();
}

export async function replaceStars(stars) {
  const db = await openDb();
  const tx = db.transaction(STARS, "readwrite");
  tx.objectStore(STARS).clear();
  for (const star of stars) tx.objectStore(STARS).put(star);
  await txDone(tx);
  db.close();
}

export async function clearAll() {
  const db = await openDb();
  const tx = db.transaction([STORE, STARS], "readwrite");
  tx.objectStore(STORE).clear();
  tx.objectStore(STARS).clear();
  await txDone(tx);
  db.close();
}

export async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
