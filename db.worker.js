// db.worker.js — mesin penyimpanan Kalsara v6 (Fase 2)
//
// Berjalan di Web Worker karena OPFS sync access handle (dipakai SQLite)
// hanya boleh dipakai di luar utas utama. Worker ini HANYA mengurus database.
// Worker kalkulator/pencarian (worker.js) tetap jadwal Fase 3.
//
// VFS yang dipakai: "opfs-sahpool". Tidak butuh header COOP/COEP,
// tapi hanya satu tab/koneksi yang boleh membuka database pada satu waktu.
//
// Semua uang disimpan sebagai INTEGER "sen" (rupiah x 100): kolom harga_sen.

/* ---------------------------------------------------------------
   Sumber SQLite Wasm (CDN, versi dipatok). Dicoba berurutan.
   Layout paket npm berubah antar versi, jadi ada dua kandidat.
   Mau offline penuh? Taruh sqlite3.mjs + sqlite3.wasm di folder
   ./vendor/ dan tambahkan './vendor/sqlite3.mjs' paling atas daftar.
---------------------------------------------------------------- */
const KANDIDAT_SQLITE = [
  'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.46.1-build3/sqlite-wasm/jswasm/sqlite3.mjs',
  'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.53.0-build1/dist/index.mjs',
];

const NAMA_DB = '/kalsara.sqlite3';
const VERSI_SKEMA = 1;

let sqlite3 = null;
let db = null;
let infoPenyimpanan = null;
let sedangInit = null;

/* ---------------------------------------------------------------
   Muat & buka database
---------------------------------------------------------------- */
async function muatSqlite() {
  const gagal = [];
  for (const url of KANDIDAT_SQLITE) {
    try {
      const modul = await import(url);
      return await modul.default({
        print: () => {},
        printErr: (...a) => console.warn('[sqlite]', ...a),
      });
    } catch (e) {
      gagal.push(`${url} → ${e?.message ?? e}`);
    }
  }
  throw new Error(`SQLite Wasm gagal dimuat. ${gagal.join(' | ')}`);
}

async function bukaDatabase() {
  sqlite3 = await muatSqlite();

  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      name: 'kalsara-pool',
      directory: '/kalsara',
      initialCapacity: 12,
      clearOnInit: false,
    });
    db = new pool.OpfsSAHPoolDb(NAMA_DB);
    infoPenyimpanan = { mode: 'opfs', vfs: 'opfs-sahpool', permanen: true, alasan: null };
  } catch (e) {
    // OPFS gagal (tab lain masih terbuka, browser lama, mode privat, dll).
    // Tetap jalan di memori agar aplikasi bisa dicoba, tapi ditandai tidak permanen.
    db = new sqlite3.oo1.DB(':memory:', 'c');
    infoPenyimpanan = {
      mode: 'memori',
      vfs: 'memory',
      permanen: false,
      alasan: e?.message ?? String(e),
    };
  }

  db.exec('PRAGMA foreign_keys = ON;');
  migrasi();
}

/* ---------------------------------------------------------------
   Skema & migrasi (PRAGMA user_version)
---------------------------------------------------------------- */
function migrasi() {
  const versi = Number(db.selectValue('PRAGMA user_version'));
  if (versi >= VERSI_SKEMA) return;

  db.transaction(() => {
    if (versi < 1) {
      db.exec(`
        CREATE TABLE produk (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          sku         TEXT    NOT NULL COLLATE NOCASE UNIQUE,
          nama        TEXT    NOT NULL,
          harga_sen   INTEGER NOT NULL CHECK (harga_sen >= 0),
          stok        INTEGER NOT NULL DEFAULT 0 CHECK (stok >= 0),
          dibuat_pada INTEGER NOT NULL,
          diubah_pada INTEGER NOT NULL
        );
        CREATE INDEX idx_produk_nama ON produk (nama COLLATE NOCASE);
      `);
    }
    db.exec(`PRAGMA user_version = ${VERSI_SKEMA};`);
  });
}

/* ---------------------------------------------------------------
   Validasi (uang wajib bilangan bulat sen)
---------------------------------------------------------------- */
function cekProduk(p) {
  const sku = typeof p?.sku === 'string' ? p.sku.trim() : '';
  const nama = typeof p?.nama === 'string' ? p.nama.trim() : '';
  if (!sku || sku.length > 40) throw new Error('SKU wajib diisi (maksimal 40 karakter).');
  if (!nama || nama.length > 200) throw new Error('Nama produk wajib diisi (maksimal 200 karakter).');
  if (!Number.isSafeInteger(p.hargaSen) || p.hargaSen < 0) {
    throw new Error('Harga harus bilangan bulat sen (rupiah x 100) dan tidak negatif.');
  }
  const stok = p.stok ?? 0;
  if (!Number.isSafeInteger(stok) || stok < 0) {
    throw new Error('Stok harus bilangan bulat dan tidak negatif.');
  }
  return { sku, nama, hargaSen: p.hargaSen, stok };
}

function terjemahkanGalat(e) {
  if (/UNIQUE/i.test(e?.message ?? '')) return new Error('SKU sudah dipakai produk lain.');
  return e instanceof Error ? e : new Error(String(e));
}

function denganStmt(sql, isi) {
  const st = db.prepare(sql);
  try {
    return isi(st);
  } finally {
    st.finalize();
  }
}

const SQL_TAMBAH = `
  INSERT INTO produk (sku, nama, harga_sen, stok, dibuat_pada, diubah_pada)
  VALUES (?, ?, ?, ?, ?, ?)
`;
const SQL_BARIS = `
  SELECT id, sku, nama, harga_sen AS hargaSen, stok FROM produk
`;

/* ---------------------------------------------------------------
   Operasi yang bisa dipanggil dari utas utama
---------------------------------------------------------------- */
const OPERASI = {
  init() {
    return {
      ...infoPenyimpanan,
      versiSqlite: sqlite3.version.libVersion,
      versiSkema: Number(db.selectValue('PRAGMA user_version')),
      jumlahProduk: Number(db.selectValue('SELECT COUNT(*) FROM produk')),
    };
  },

  daftar() {
    return db.selectObjects(`${SQL_BARIS} ORDER BY id`);
  },

  tambah(p) {
    const v = cekProduk(p);
    const kini = Date.now();
    try {
      db.exec({ sql: SQL_TAMBAH, bind: [v.sku, v.nama, v.hargaSen, v.stok, kini, kini] });
    } catch (e) {
      throw terjemahkanGalat(e);
    }
    const id = Number(db.selectValue('SELECT last_insert_rowid()'));
    return db.selectObject(`${SQL_BARIS} WHERE id = ?`, [id]);
  },

  tambahBanyak(daftar) {
    if (!Array.isArray(daftar)) throw new Error('Data harus berupa daftar produk.');
    const kini = Date.now();
    try {
      db.transaction(() => {
        denganStmt(SQL_TAMBAH, (st) => {
          for (const p of daftar) {
            const v = cekProduk(p);
            st.bind([v.sku, v.nama, v.hargaSen, v.stok, kini, kini]).stepReset();
          }
        });
      });
    } catch (e) {
      throw terjemahkanGalat(e);
    }
    return db.selectObjects(`${SQL_BARIS} ORDER BY id`);
  },

  ubahStok({ id, selisih }) {
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(selisih)) {
      throw new Error('id dan selisih stok harus bilangan bulat.');
    }
    db.exec({
      sql: 'UPDATE produk SET stok = MAX(0, stok + ?), diubah_pada = ? WHERE id = ?',
      bind: [selisih, Date.now(), id],
    });
    const stok = db.selectValue('SELECT stok FROM produk WHERE id = ?', [id]);
    if (stok === undefined) throw new Error('Produk tidak ditemukan.');
    return Number(stok);
  },

  ubahStokMassal(daftar) {
    if (!Array.isArray(daftar)) throw new Error('Data harus berupa daftar {id, stok}.');
    const kini = Date.now();
    db.transaction(() => {
      denganStmt('UPDATE produk SET stok = ?, diubah_pada = ? WHERE id = ?', (st) => {
        for (const { id, stok } of daftar) {
          if (!Number.isSafeInteger(id) || !Number.isSafeInteger(stok) || stok < 0) {
            throw new Error('id dan stok harus bilangan bulat, stok tidak negatif.');
          }
          st.bind([stok, kini, id]).stepReset();
        }
      });
    });
    return daftar.length;
  },

  hapus(id) {
    if (!Number.isSafeInteger(id)) throw new Error('id harus bilangan bulat.');
    db.exec({ sql: 'DELETE FROM produk WHERE id = ?', bind: [id] });
    return true;
  },

  kosongkan() {
    db.transaction(() => {
      db.exec("DELETE FROM produk; DELETE FROM sqlite_sequence WHERE name = 'produk';");
    });
    return true;
  },
};

/* ---------------------------------------------------------------
   Pesan masuk. Pendengar dipasang sinkron di awal supaya pesan
   yang tiba saat SQLite masih dimuat tidak hilang.
---------------------------------------------------------------- */
self.addEventListener('message', async ({ data }) => {
  const { id, op, args } = data ?? {};
  try {
    const fn = OPERASI[op];
    if (!fn) throw new Error(`Operasi tidak dikenal: ${op}`);

    sedangInit ??= bukaDatabase();
    await sedangInit;

    const hasil = await fn(args);
    self.postMessage({ id, ok: true, hasil });
  } catch (e) {
    // Jika pembukaan database gagal, izinkan percobaan ulang pada panggilan berikutnya.
    if (!db) sedangInit = null;
    self.postMessage({ id, ok: false, galat: e?.message ?? String(e) });
  }
});
