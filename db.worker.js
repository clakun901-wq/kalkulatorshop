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
const VERSI_SKEMA = 2;

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
    if (versi < 2) {
      // Data produk lengkap untuk kalkulator. Baris lama otomatis bermodal 0
      // (kalkulator menandainya "Modal belum diisi").
      db.exec(`
        ALTER TABLE produk ADD COLUMN modal_sen INTEGER NOT NULL DEFAULT 0 CHECK (modal_sen >= 0);
        ALTER TABLE produk ADD COLUMN kemitraan_sen INTEGER NOT NULL DEFAULT 0 CHECK (kemitraan_sen >= 0);
        ALTER TABLE produk ADD COLUMN packing_sen INTEGER NOT NULL DEFAULT 0 CHECK (packing_sen >= 0);
        ALTER TABLE produk ADD COLUMN target_untung_sen INTEGER NOT NULL DEFAULT 0 CHECK (target_untung_sen >= 0);
        ALTER TABLE produk ADD COLUMN isi_paket INTEGER NOT NULL DEFAULT 1 CHECK (isi_paket >= 1);
      `);
    }
    db.exec(`PRAGMA user_version = ${VERSI_SKEMA};`);
  });
}

/* ---------------------------------------------------------------
   Validasi (uang wajib bilangan bulat sen)
---------------------------------------------------------------- */
function bulatTakNegatif(nilai, nama, bawaan = 0) {
  const n = nilai ?? bawaan;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${nama} harus bilangan bulat sen dan tidak negatif.`);
  }
  return n;
}

function cekProduk(p) {
  const sku = typeof p?.sku === 'string' ? p.sku.trim() : '';
  const nama = typeof p?.nama === 'string' ? p.nama.trim() : '';
  if (!sku || sku.length > 40) throw new Error('SKU wajib diisi (maksimal 40 karakter).');
  if (!nama || nama.length > 200) throw new Error('Nama produk wajib diisi (maksimal 200 karakter).');
  const isiPaket = p.isiPaket ?? 1;
  if (!Number.isSafeInteger(isiPaket) || isiPaket < 1) {
    throw new Error('Isi paket harus bilangan bulat minimal 1.');
  }
  const stok = p.stok ?? 0;
  if (!Number.isSafeInteger(stok) || stok < 0) {
    throw new Error('Stok harus bilangan bulat dan tidak negatif.');
  }
  return {
    sku,
    nama,
    hargaSen: bulatTakNegatif(p.hargaSen, 'Harga'),
    stok,
    modalSen: bulatTakNegatif(p.modalSen, 'Modal'),
    kemitraanSen: bulatTakNegatif(p.kemitraanSen, 'Biaya Management Partner'),
    packingSen: bulatTakNegatif(p.packingSen, 'Biaya packing'),
    targetUntungSen: bulatTakNegatif(p.targetUntungSen, 'Target untung'),
    isiPaket,
  };
}

function bindProduk(v, kini) {
  return [
    v.sku, v.nama, v.hargaSen, v.stok, v.modalSen, v.kemitraanSen,
    v.packingSen, v.targetUntungSen, v.isiPaket, kini, kini,
  ];
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
  INSERT INTO produk (
    sku, nama, harga_sen, stok, modal_sen, kemitraan_sen, packing_sen,
    target_untung_sen, isi_paket, dibuat_pada, diubah_pada
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_BARIS = `
  SELECT id, sku, nama, harga_sen AS hargaSen, stok,
         modal_sen AS modalSen, kemitraan_sen AS kemitraanSen,
         packing_sen AS packingSen, target_untung_sen AS targetUntungSen,
         isi_paket AS isiPaket
  FROM produk
`;

const JENIS_DUMMY = [
  'Vacuum sealer', 'Plastik vacuum', 'Botol minum', 'Kotak makan', 'Rak dapur',
  'Pisau dapur', 'Talenan', 'Gelas kopi', 'Termos', 'Wadah kedap udara',
];
const VARIAN_DUMMY = ['portabel', 'mini', 'premium', 'jumbo', 'lipat', 'stainless', 'bening', 'hemat'];
const UKURAN_DUMMY = ['S', 'M', 'L', 'XL', '500 ml', '750 ml', '20x30', '25x35'];

// Data dummy deterministik: nomor yang sama selalu menghasilkan produk yang sama.
function buatDummy(n) {
  return {
    sku: `DUM-${String(n).padStart(4, '0')}`,
    nama: `${JENIS_DUMMY[n % JENIS_DUMMY.length]} ${VARIAN_DUMMY[(n * 3) % VARIAN_DUMMY.length]} ` +
      `${UKURAN_DUMMY[(n * 5) % UKURAN_DUMMY.length]} #${n}`,
    hargaSen: 0,
    stok: (n * 31) % 40,
    modalSen: (5_000 + ((n * 7919) % 245_000)) * 100,
    kemitraanSen: n % 5 === 0 ? 100_000 : 0,
    packingSen: (n % 4) * 50_000,
    targetUntungSen: (1_000 + (n % 50) * 500) * 100,
    isiPaket: n % 7 === 0 ? 2 : 1,
  };
}

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
      db.exec({ sql: SQL_TAMBAH, bind: bindProduk(v, kini) });
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
            st.bind(bindProduk(v, kini)).stepReset();
          }
        });
      });
    } catch (e) {
      throw terjemahkanGalat(e);
    }
    return db.selectObjects(`${SQL_BARIS} ORDER BY id`);
  },

  // Satu halaman produk (+ pencarian nama/SKU) langsung dari SQLite, jadi utas utama
  // tidak pernah memegang ribuan baris sekaligus.
  halaman({ kata = '', batas = 24, offset = 0 } = {}) {
    if (!Number.isSafeInteger(batas) || batas < 1 || batas > 500) throw new Error('batas harus 1-500.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset tidak valid.');
    const teks = String(kata).trim().slice(0, 100);
    let where = '';
    let bind = [];
    if (teks) {
      const pola = `%${teks.replace(/[\\%_]/g, '\\$&')}%`;
      where = "WHERE nama LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\'";
      bind = [pola, pola];
    }
    const total = Number(db.selectValue(`SELECT COUNT(*) FROM produk ${where}`, bind));
    const baris = db.selectObjects(`${SQL_BARIS} ${where} ORDER BY id LIMIT ? OFFSET ?`, [...bind, batas, offset]);
    return { baris, total };
  },

  ringkasan() {
    const r = db.selectObject('SELECT COUNT(*) AS jumlah, COALESCE(SUM(stok), 0) AS totalStok FROM produk');
    return { jumlah: Number(r.jumlah), totalStok: Number(r.totalStok) };
  },

  // Suntik data dummy deterministik (SKU DUM-0001, ...). SKU yang sudah ada dilewati.
  suntikDummy({ jumlah = 1000 } = {}) {
    if (!Number.isSafeInteger(jumlah) || jumlah < 1 || jumlah > 20_000) {
      throw new Error('jumlah dummy harus 1-20.000.');
    }
    const mulai = performance.now();
    const sebelum = Number(db.selectValue('SELECT COUNT(*) FROM produk'));
    const kini = Date.now();
    db.transaction(() => {
      denganStmt(SQL_TAMBAH.replace('INSERT INTO', 'INSERT OR IGNORE INTO'), (st) => {
        for (let n = 1; n <= jumlah; n++) {
          st.bind(bindProduk(buatDummy(n), kini)).stepReset();
        }
      });
    });
    const sesudah = Number(db.selectValue('SELECT COUNT(*) FROM produk'));
    return { ditambah: sesudah - sebelum, total: sesudah, ms: performance.now() - mulai };
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
