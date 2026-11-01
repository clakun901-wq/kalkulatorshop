// db.worker.js — mesin penyimpanan Kalsara v6 (Fase 2; skema v4 sejak Fase 6, v5 sejak Fase 7)
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
const VERSI_SKEMA = 5;

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
    if (versi < 3) {
      // Pengaturan toko (satu baris JSON) dan tarif khusus per produk.
      db.exec(`
        CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL);
        ALTER TABLE produk ADD COLUMN override_json TEXT NOT NULL DEFAULT '{}';
      `);
    }
    if (versi < 4) {
      // Fase 6: supplier per produk dan riwayat perubahan modal.
      db.exec(`
        ALTER TABLE produk ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
        ALTER TABLE produk ADD COLUMN link_supplier TEXT NOT NULL DEFAULT '';
        CREATE TABLE riwayat_modal (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          produk_id    INTEGER NOT NULL REFERENCES produk(id) ON DELETE CASCADE,
          lama_sen     INTEGER NOT NULL CHECK (lama_sen >= 0),
          baru_sen     INTEGER NOT NULL CHECK (baru_sen >= 0),
          dicatat_pada INTEGER NOT NULL
        );
        CREATE INDEX idx_riwayat_produk ON riwayat_modal (produk_id, id);
      `);
    }
    if (versi < 5) {
      // Fase 7: penanda "tampil di Etalase" per produk dan catatan penjualan.
      // Catatan penjualan menyimpan salinan SKU dan nama, jadi tetap utuh walau produknya dihapus
      // (produk_id menjadi NULL). Untung boleh negatif (rugi).
      db.exec(`
        ALTER TABLE produk ADD COLUMN tayang INTEGER NOT NULL DEFAULT 0 CHECK (tayang IN (0, 1));
        CREATE INDEX idx_produk_tayang ON produk (tayang, stok);
        CREATE TABLE penjualan (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          produk_id    INTEGER REFERENCES produk(id) ON DELETE SET NULL,
          sku          TEXT    NOT NULL,
          nama         TEXT    NOT NULL,
          harga_sen    INTEGER NOT NULL CHECK (harga_sen >= 0),
          untung_sen   INTEGER NOT NULL,
          dicatat_pada INTEGER NOT NULL
        );
        CREATE INDEX idx_penjualan_waktu ON penjualan (dicatat_pada);
        CREATE INDEX idx_penjualan_produk ON penjualan (produk_id);
      `);
    }
    db.exec(`PRAGMA user_version = ${VERSI_SKEMA};`);
  });
}

/* ---------------------------------------------------------------
   Fase 8: pembantu laporan
---------------------------------------------------------------- */
const BATAS_EKSPOR = 100_000;

function cekRentang(r) {
  const dari = r?.dari;
  const sampai = r?.sampai;
  if (!Number.isSafeInteger(dari) || dari < 0) throw new Error('Awal periode tidak valid.');
  if (!Number.isSafeInteger(sampai) || sampai < dari) throw new Error('Akhir periode tidak valid.');
  return { dari, sampai };
}

function cekSebelum(sebelum) {
  if (!Number.isSafeInteger(sebelum) || sebelum < 1) throw new Error('Batas tanggal tidak valid.');
  if (sebelum > Date.now()) throw new Error('Batas tanggal tidak boleh di masa depan.');
  return sebelum;
}

function rapikanPenjualan(b) {
  return {
    id: Number(b.id), dicatatPada: Number(b.dicatatPada), sku: b.sku, nama: b.nama,
    hargaSen: Number(b.hargaSen), untungSen: Number(b.untungSen),
  };
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
  const supplier = typeof p.supplier === 'string' ? p.supplier.trim() : '';
  if (supplier.length > 100) throw new Error('Nama supplier maksimal 100 karakter.');
  const linkSupplier = typeof p.linkSupplier === 'string' ? p.linkSupplier.trim() : '';
  if (linkSupplier.length > 500) throw new Error('Link supplier maksimal 500 karakter.');
  if (linkSupplier && !/^https?:\/\/\S+$/i.test(linkSupplier)) {
    throw new Error('Link supplier harus diawali http:// atau https://.');
  }
  return {
    sku,
    nama,
    supplier,
    linkSupplier,
    hargaSen: bulatTakNegatif(p.hargaSen, 'Harga'),
    stok,
    modalSen: bulatTakNegatif(p.modalSen, 'Modal'),
    kemitraanSen: bulatTakNegatif(p.kemitraanSen, 'Biaya Management Partner'),
    packingSen: bulatTakNegatif(p.packingSen, 'Biaya packing'),
    targetUntungSen: bulatTakNegatif(p.targetUntungSen, 'Target untung'),
    isiPaket,
    override: cekOverride(p.override),
  };
}

function bindProduk(v, kini) {
  return [
    v.sku, v.nama, v.hargaSen, v.stok, v.modalSen, v.kemitraanSen,
    v.packingSen, v.targetUntungSen, v.isiPaket, JSON.stringify(v.override ?? {}),
    v.supplier ?? '', v.linkSupplier ?? '', kini, kini,
  ];
}

// Tarif khusus per produk. Hanya kunci yang dikenal kalkulator yang disimpan.
function cekOverride(o) {
  const hasil = {};
  if (o === undefined || o === null) return hasil;
  if (typeof o !== 'object' || Array.isArray(o)) throw new Error('Tarif khusus produk tidak valid.');
  for (const kunci of ['kategoriAdmin', 'kategoriGo']) {
    if (o[kunci] === undefined || o[kunci] === '') continue;
    if (typeof o[kunci] !== 'string' || !/^[A-Za-z]{1,6}$/.test(o[kunci])) {
      throw new Error(`${kunci} tidak valid.`);
    }
    hasil[kunci] = o[kunci];
  }
  if (o.ukuran !== undefined && o.ukuran !== '') {
    if (o.ukuran !== 'b' && o.ukuran !== 'k') throw new Error('ukuran harus b atau k.');
    hasil.ukuran = o.ukuran;
  }
  return hasil;
}

function rapikanBaris(b) {
  if (!b) return b;
  const { overrideJson, ...sisa } = b;
  let override = {};
  try { override = JSON.parse(overrideJson || '{}'); } catch { override = {}; }
  return { ...sisa, override };
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
    target_untung_sen, isi_paket, override_json, supplier, link_supplier, dibuat_pada, diubah_pada
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_BARIS = `
  SELECT id, sku, nama, harga_sen AS hargaSen, stok,
         modal_sen AS modalSen, kemitraan_sen AS kemitraanSen,
         packing_sen AS packingSen, target_untung_sen AS targetUntungSen,
         isi_paket AS isiPaket, override_json AS overrideJson,
         supplier, link_supplier AS linkSupplier, tayang
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
    return db.selectObjects(`${SQL_BARIS} ORDER BY id`).map(rapikanBaris);
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
    return rapikanBaris(db.selectObject(`${SQL_BARIS} WHERE id = ?`, [id]));
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
    return db.selectObjects(`${SQL_BARIS} ORDER BY id`).map(rapikanBaris);
  },

  // Satu halaman produk (+ pencarian nama/SKU) langsung dari SQLite, jadi utas utama
  // tidak pernah memegang ribuan baris sekaligus.
  //   tayang: true      -> hanya produk yang tampil di Etalase
  //   urut: 'etalase'   -> stok paling sedikit lebih dulu, produk dengan stok <= batasMenipis
  //                        ("perlu isi ulang") di depan produk berstok aman.
  halaman({ kata = '', batas = 24, offset = 0, tayang = false, urut = 'id', batasMenipis = 10 } = {}) {
    if (!Number.isSafeInteger(batas) || batas < 1 || batas > 500) throw new Error('batas harus 1-500.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset tidak valid.');
    if (urut !== 'id' && urut !== 'etalase') throw new Error('urutan tidak dikenal.');
    if (!Number.isSafeInteger(batasMenipis) || batasMenipis < 0 || batasMenipis > 999_999_999) {
      throw new Error('batas stok menipis tidak valid.');
    }
    const teks = String(kata).trim().slice(0, 100);
    const syarat = [];
    const bind = [];
    if (teks) {
      const pola = `%${teks.replace(/[\\%_]/g, '\\$&')}%`;
      syarat.push("(nama LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')");
      bind.push(pola, pola);
    }
    if (tayang) syarat.push('tayang = 1');
    const where = syarat.length > 0 ? `WHERE ${syarat.join(' AND ')}` : '';
    const urutSql = urut === 'etalase' ? 'ORDER BY (stok > ?), stok, id' : 'ORDER BY id';
    const bindUrut = urut === 'etalase' ? [batasMenipis] : [];
    // SQLite Wasm menolak daftar bind pada pernyataan tanpa parameter, jadi kirim
    // `undefined` (bukan []) bila tidak ada syarat berparameter.
    const bindCari = bind.length > 0 ? bind : undefined;
    const total = Number(db.selectValue(`SELECT COUNT(*) FROM produk ${where}`, bindCari));
    const baris = db.selectObjects(
      `${SQL_BARIS} ${where} ${urutSql} LIMIT ? OFFSET ?`,
      [...bind, ...bindUrut, batas, offset]
    ).map(rapikanBaris);
    return { baris, total };
  },

  ringkasan() {
    const r = db.selectObject(
      'SELECT COUNT(*) AS jumlah, COALESCE(SUM(stok), 0) AS totalStok, COALESCE(SUM(tayang), 0) AS tayang FROM produk'
    );
    return { jumlah: Number(r.jumlah), totalStok: Number(r.totalStok), tayang: Number(r.tayang) };
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

  ubahProduk(p) {
    const id = p?.id;
    if (!Number.isSafeInteger(id)) throw new Error('id produk harus bilangan bulat.');
    const v = cekProduk(p);
    try {
      db.transaction(() => {
        const lama = db.selectValue('SELECT modal_sen FROM produk WHERE id = ?', [id]);
        if (lama === undefined) throw new Error('Produk tidak ditemukan.');
        const kini = Date.now();
        db.exec({
          sql: `UPDATE produk SET sku = ?, nama = ?, stok = ?, modal_sen = ?, kemitraan_sen = ?,
                  packing_sen = ?, target_untung_sen = ?, isi_paket = ?, override_json = ?,
                  supplier = ?, link_supplier = ?, diubah_pada = ?
                WHERE id = ?`,
          bind: [v.sku, v.nama, v.stok, v.modalSen, v.kemitraanSen, v.packingSen,
            v.targetUntungSen, v.isiPaket, JSON.stringify(v.override),
            v.supplier, v.linkSupplier, kini, id],
        });
        // Modal berubah: catat di riwayat (modal lama 0 = belum pernah diisi, tidak dicatat).
        const modalLama = Number(lama);
        if (modalLama > 0 && modalLama !== v.modalSen) {
          db.exec({
            sql: 'INSERT INTO riwayat_modal (produk_id, lama_sen, baru_sen, dicatat_pada) VALUES (?, ?, ?, ?)',
            bind: [id, modalLama, v.modalSen, kini],
          });
        }
      });
    } catch (e) {
      throw terjemahkanGalat(e);
    }
    return rapikanBaris(db.selectObject(`${SQL_BARIS} WHERE id = ?`, [id]));
  },

  // Ubah target untung saja (tombol +1.000, +5.000, Reset di kartu produk).
  ubahTarget({ id, targetUntungSen }) {
    if (!Number.isSafeInteger(id)) throw new Error('id produk harus bilangan bulat.');
    const target = bulatTakNegatif(targetUntungSen, 'Target untung');
    if (target > 100_000_000_000) throw new Error('Target untung terlalu besar.');
    db.exec({
      sql: 'UPDATE produk SET target_untung_sen = ?, diubah_pada = ? WHERE id = ?',
      bind: [target, Date.now(), id],
    });
    const hasil = db.selectValue('SELECT target_untung_sen FROM produk WHERE id = ?', [id]);
    if (hasil === undefined) throw new Error('Produk tidak ditemukan.');
    return Number(hasil);
  },

  // Riwayat perubahan modal satu produk, terbaru dulu.
  riwayatModal({ id, batas = 20 }) {
    if (!Number.isSafeInteger(id)) throw new Error('id produk harus bilangan bulat.');
    if (!Number.isSafeInteger(batas) || batas < 1 || batas > 200) throw new Error('batas harus 1-200.');
    return db.selectObjects(
      `SELECT lama_sen AS lamaSen, baru_sen AS baruSen, dicatat_pada AS dicatatPada
       FROM riwayat_modal WHERE produk_id = ? ORDER BY id DESC LIMIT ?`,
      [id, batas]
    ).map((r) => ({ lamaSen: Number(r.lamaSen), baruSen: Number(r.baruSen), dicatatPada: Number(r.dicatatPada) }));
  },

  ambilPengaturan() {
    const nilai = db.selectValue('SELECT nilai FROM pengaturan WHERE kunci = ?', ['toko']);
    if (nilai === undefined) return null;
    try { return JSON.parse(nilai); } catch { return null; }
  },

  simpanPengaturan(pengaturan) {
    if (!pengaturan || typeof pengaturan !== 'object' || Array.isArray(pengaturan)) {
      throw new Error('Pengaturan harus berupa objek.');
    }
    const json = JSON.stringify(pengaturan);
    if (json.length > 20_000) throw new Error('Pengaturan terlalu besar.');
    db.exec({
      sql: `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
            ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`,
      bind: ['toko', json],
    });
    return true;
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

  // Fase 7: tampilkan atau lepas produk dari Etalase. Mengembalikan nilai yang tersimpan.
  ubahTayang({ id, tayang }) {
    if (!Number.isSafeInteger(id)) throw new Error('id produk harus bilangan bulat.');
    if (typeof tayang !== 'boolean') throw new Error('tayang harus true atau false.');
    db.exec({
      sql: 'UPDATE produk SET tayang = ?, diubah_pada = ? WHERE id = ?',
      bind: [tayang ? 1 : 0, Date.now(), id],
    });
    const hasil = db.selectValue('SELECT tayang FROM produk WHERE id = ?', [id]);
    if (hasil === undefined) throw new Error('Produk tidak ditemukan.');
    return Number(hasil) === 1;
  },

  // Fase 7: catat 1 penjualan DAN kurangi stok 1 dalam satu transaksi, jadi keduanya
  // selalu berjalan bersama atau tidak sama sekali. Harga dan untung berasal dari kalkulator
  // (sen); di sini hanya divalidasi dan disimpan sebagai salinan saat penjualan terjadi.
  catatPenjualan({ produkId, hargaSen, untungSen }) {
    if (!Number.isSafeInteger(produkId)) throw new Error('id produk harus bilangan bulat.');
    const harga = bulatTakNegatif(hargaSen, 'Harga jual');
    if (!Number.isSafeInteger(untungSen)) throw new Error('Untung harus bilangan bulat sen.');
    return db.transaction(() => {
      const p = db.selectObject('SELECT sku, nama, stok FROM produk WHERE id = ?', [produkId]);
      if (!p) throw new Error('Produk tidak ditemukan.');
      if (Number(p.stok) <= 0) throw new Error('Stok habis, penjualan tidak dicatat.');
      const kini = Date.now();
      db.exec({
        sql: 'UPDATE produk SET stok = stok - 1, diubah_pada = ? WHERE id = ?',
        bind: [kini, produkId],
      });
      db.exec({
        sql: `INSERT INTO penjualan (produk_id, sku, nama, harga_sen, untung_sen, dicatat_pada)
              VALUES (?, ?, ?, ?, ?, ?)`,
        bind: [produkId, p.sku, p.nama, harga, untungSen, kini],
      });
      const id = Number(db.selectValue('SELECT last_insert_rowid()'));
      return { id, produkId, sku: p.sku, nama: p.nama, hargaSen: harga, untungSen, dicatatPada: kini, stok: Number(p.stok) - 1 };
    });
  },

  // Fase 7: batalkan satu catatan penjualan (salah ketuk) dan kembalikan stok 1 bila produknya masih ada.
  // Mengembalikan { stok } (null bila produknya sudah dihapus).
  batalkanPenjualan({ id }) {
    if (!Number.isSafeInteger(id)) throw new Error('id penjualan harus bilangan bulat.');
    return db.transaction(() => {
      const baris = db.selectObject('SELECT produk_id AS produkId FROM penjualan WHERE id = ?', [id]);
      if (!baris) throw new Error('Catatan penjualan tidak ditemukan (mungkin sudah dibatalkan).');
      db.exec({ sql: 'DELETE FROM penjualan WHERE id = ?', bind: [id] });
      if (baris.produkId === null || baris.produkId === undefined) return { stok: null };
      db.exec({
        sql: 'UPDATE produk SET stok = stok + 1, diubah_pada = ? WHERE id = ?',
        bind: [Date.now(), baris.produkId],
      });
      const stok = db.selectValue('SELECT stok FROM produk WHERE id = ?', [baris.produkId]);
      return { stok: stok === undefined ? null : Number(stok) };
    });
  },

  // Fase 7: jumlah dan untung penjualan sejak waktu tertentu (ms), untuk ringkasan di Etalase.
  ringkasanPenjualan({ sejak }) {
    if (!Number.isSafeInteger(sejak) || sejak < 0) throw new Error('waktu mulai tidak valid.');
    const r = db.selectObject(
      'SELECT COUNT(*) AS jumlah, COALESCE(SUM(untung_sen), 0) AS untungSen FROM penjualan WHERE dicatat_pada >= ?',
      [sejak]
    );
    return { jumlah: Number(r.jumlah), untungSen: Number(r.untungSen) };
  },

  // Fase 8 (Laporan): semua operasi hanya MEMBACA tabel penjualan, jadi skema tetap v5.
  // Rentang waktu [dari, sampai) dalam ms.
  laporanRingkas(r) {
    const { dari, sampai } = cekRentang(r);
    const x = db.selectObject(
      `SELECT COUNT(*) AS jumlah, COALESCE(SUM(harga_sen), 0) AS omzetSen, COALESCE(SUM(untung_sen), 0) AS untungSen,
              COALESCE(SUM(untung_sen < 0), 0) AS jumlahRugi
       FROM penjualan WHERE dicatat_pada >= ? AND dicatat_pada < ?`,
      [dari, sampai]
    );
    return { jumlah: Number(x.jumlah), omzetSen: Number(x.omzetSen), untungSen: Number(x.untungSen), jumlahRugi: Number(x.jumlahRugi) };
  },

  // Ringkasan per SKU. urut: 'untung' (untung terbesar) atau 'terjual' (paling laku).
  // stok = stok produk saat ini (null bila produknya sudah dihapus).
  laporanProduk(r) {
    const { dari, sampai } = cekRentang(r);
    const batas = r?.batas ?? 10;
    if (!Number.isSafeInteger(batas) || batas < 1 || batas > 500) throw new Error('batas harus 1-500.');
    const urut = r?.urut ?? 'untung';
    if (urut !== 'untung' && urut !== 'terjual') throw new Error('urutan tidak dikenal.');
    const urutSql = urut === 'untung' ? 'untungSen DESC, terjual DESC, sku' : 'terjual DESC, untungSen DESC, sku';
    return db.selectObjects(
      `SELECT p.sku AS sku, MAX(p.nama) AS nama, COUNT(*) AS terjual, SUM(p.harga_sen) AS omzetSen,
              SUM(p.untung_sen) AS untungSen, MAX(k.stok) AS stok
       FROM penjualan p LEFT JOIN produk k ON k.id = p.produk_id
       WHERE p.dicatat_pada >= ? AND p.dicatat_pada < ?
       GROUP BY p.sku ORDER BY ${urutSql} LIMIT ?`,
      [dari, sampai, batas]
    ).map((b) => ({
      sku: b.sku, nama: b.nama, terjual: Number(b.terjual), omzetSen: Number(b.omzetSen),
      untungSen: Number(b.untungSen), stok: b.stok === null || b.stok === undefined ? null : Number(b.stok),
    }));
  },

  // Daftar penjualan terbaru lebih dulu, per halaman.
  daftarPenjualan(r) {
    const { dari, sampai } = cekRentang(r);
    const batas = r?.batas ?? 25;
    const offset = r?.offset ?? 0;
    if (!Number.isSafeInteger(batas) || batas < 1 || batas > 500) throw new Error('batas harus 1-500.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset tidak valid.');
    const total = Number(db.selectValue(
      'SELECT COUNT(*) FROM penjualan WHERE dicatat_pada >= ? AND dicatat_pada < ?', [dari, sampai]
    ));
    const baris = db.selectObjects(
      `SELECT id, dicatat_pada AS dicatatPada, sku, nama, harga_sen AS hargaSen, untung_sen AS untungSen
       FROM penjualan WHERE dicatat_pada >= ? AND dicatat_pada < ?
       ORDER BY dicatat_pada DESC, id DESC LIMIT ? OFFSET ?`,
      [dari, sampai, batas, offset]
    ).map(rapikanPenjualan);
    return { baris, total };
  },

  // Seluruh penjualan dalam rentang (urut waktu naik) untuk ekspor CSV.
  semuaPenjualan(r) {
    const { dari, sampai } = cekRentang(r);
    const baris = db.selectObjects(
      `SELECT id, dicatat_pada AS dicatatPada, sku, nama, harga_sen AS hargaSen, untung_sen AS untungSen
       FROM penjualan WHERE dicatat_pada >= ? AND dicatat_pada < ?
       ORDER BY dicatat_pada, id LIMIT ?`,
      [dari, sampai, BATAS_EKSPOR + 1]
    );
    if (baris.length > BATAS_EKSPOR) {
      throw new Error(`Lebih dari ${BATAS_EKSPOR.toLocaleString('id-ID')} penjualan. Pilih periode yang lebih pendek.`);
    }
    return baris.map(rapikanPenjualan);
  },

  // Fase 8: laju penjualan per produk untuk perkiraan stok habis. Hanya produk yang MASIH ada
  // (punya stok sekarang). Diurutkan dari yang paling cepat habis (stok / terjual terkecil);
  // pembagian dalam urutan hanya untuk mengurutkan, hari sisa dihitung bilangan bulat di laporan.js.
  lajuPenjualan(r) {
    const { dari, sampai } = cekRentang(r);
    const batas = r?.batas ?? 10;
    if (!Number.isSafeInteger(batas) || batas < 1 || batas > 500) throw new Error('batas harus 1-500.');
    const pertama = db.selectValue(
      'SELECT MIN(dicatat_pada) FROM penjualan WHERE dicatat_pada >= ? AND dicatat_pada < ?', [dari, sampai]
    );
    const produk = db.selectObjects(
      `SELECT k.sku AS sku, k.nama AS nama, k.stok AS stok, COUNT(*) AS terjual
       FROM penjualan p JOIN produk k ON k.id = p.produk_id
       WHERE p.dicatat_pada >= ? AND p.dicatat_pada < ?
       GROUP BY k.id ORDER BY (k.stok * 1.0 / COUNT(*)), k.stok, k.sku LIMIT ?`,
      [dari, sampai, batas]
    ).map((b) => ({ sku: b.sku, nama: b.nama, stok: Number(b.stok), terjual: Number(b.terjual) }));
    return { pertama: pertama === null || pertama === undefined ? null : Number(pertama), produk };
  },

  // Fase 8: hapus catatan penjualan lama. Dua langkah supaya aman: hitung dulu (hitungPenjualanSebelum),
  // lalu hapus dengan menyebut jumlah yang tadi dilihat pengguna; bila jumlahnya sudah berubah, tidak ada
  // yang dihapus. Stok produk TIDAK berubah. `sebelum` (ms) tidak ikut dihapus dan tidak boleh di masa depan.
  hitungPenjualanSebelum(r) {
    const sebelum = cekSebelum(r?.sebelum);
    const x = db.selectObject(
      'SELECT COUNT(*) AS jumlah, COALESCE(SUM(untung_sen), 0) AS untungSen FROM penjualan WHERE dicatat_pada < ?', [sebelum]
    );
    return { jumlah: Number(x.jumlah), untungSen: Number(x.untungSen) };
  },

  hapusPenjualanSebelum(r) {
    const sebelum = cekSebelum(r?.sebelum);
    const jumlah = r?.jumlah;
    if (!Number.isSafeInteger(jumlah) || jumlah < 1) throw new Error('Jumlah catatan yang akan dihapus tidak valid.');
    return db.transaction(() => {
      const ada = Number(db.selectValue('SELECT COUNT(*) FROM penjualan WHERE dicatat_pada < ?', [sebelum]));
      if (ada !== jumlah) throw new Error('Jumlah catatan sudah berubah sejak Anda melihatnya. Ulangi dari awal.');
      db.exec({ sql: 'DELETE FROM penjualan WHERE dicatat_pada < ?', bind: [sebelum] });
      return { dihapus: ada };
    });
  },

  hapus(id) {
    if (!Number.isSafeInteger(id)) throw new Error('id harus bilangan bulat.');
    db.exec({ sql: 'DELETE FROM produk WHERE id = ?', bind: [id] });
    return true;
  },

  kosongkan() {
    db.transaction(() => {
      db.exec("DELETE FROM penjualan; DELETE FROM produk; DELETE FROM sqlite_sequence WHERE name IN ('produk', 'penjualan');");
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
