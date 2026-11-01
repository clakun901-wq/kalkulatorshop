// uji-db-fase7.mjs — uji database Fase 7 (bukan bagian aplikasi). Jalan di Node 22+:
//   node uji-db-fase7.mjs
//
// Memuat db.worker.js ASLI (tanpa diubah selain alamat SQLite) di atas node:sqlite lewat tiruan
// API oo1 milik SQLite Wasm. Tiruan ini sengaja KETAT, meniru perilaku SQLite Wasm asli:
//   - daftar bind kosong ([]) ditolak (kirim undefined bila tidak ada parameter);
//   - transaction() mengembalikan hasil callback dan membatalkan semua perubahan bila callback gagal.
// Catatan: ini bukan pengganti uji di HP. Migrasi pada SQLite Wasm + OPFS asli tetap harus dicoba di HP.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const folder = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'kalsara-uji-'));

/* ---------------- Tiruan oo1 yang ketat ---------------- */
function cekBind(bind) {
  if (bind === undefined) return [];
  if (!Array.isArray(bind)) throw new Error('bind harus berupa array atau undefined');
  if (bind.length === 0) throw new Error('SQLite Wasm menolak daftar bind kosong ([]): kirim undefined');
  for (const v of bind) {
    if (v === undefined) throw new Error('nilai bind undefined tidak diizinkan');
  }
  return bind;
}

class TiruanDB {
  constructor() {
    this.mentah = new DatabaseSync(':memory:');
    globalThis.__DB_MENTAH = this.mentah; // untuk uji yang perlu menyentuh database langsung
    globalThis.__AWAL?.(this.mentah);
    this.sedangTransaksi = false;
  }
  exec(arg) {
    if (typeof arg === 'string') { this.mentah.exec(arg); return this; }
    const bind = cekBind(arg.bind);
    this.mentah.prepare(arg.sql).run(...bind);
    return this;
  }
  selectObjects(sql, bind) {
    return this.mentah.prepare(sql).all(...cekBind(bind)).map((b) => ({ ...b }));
  }
  selectObject(sql, bind) {
    const r = this.mentah.prepare(sql).get(...cekBind(bind));
    return r === undefined ? undefined : { ...r };
  }
  selectValue(sql, bind) {
    const r = this.mentah.prepare(sql).get(...cekBind(bind));
    return r === undefined ? undefined : Object.values(r)[0];
  }
  prepare(sql) {
    const st = this.mentah.prepare(sql);
    let terikat = [];
    const api = {
      bind(daftar) { terikat = cekBind(daftar); return api; },
      stepReset() { st.run(...terikat); return api; },
      finalize() {},
    };
    return api;
  }
  transaction(fn) {
    this.mentah.exec('BEGIN');
    try {
      const hasil = fn();
      this.mentah.exec('COMMIT');
      return hasil;
    } catch (e) {
      this.mentah.exec('ROLLBACK');
      throw e;
    }
  }
}

writeFileSync(join(tmp, 'tiruan-sqlite.mjs'), `
  const kelas = ${TiruanDB.toString()};
  ${cekBind.toString()}
  import { DatabaseSync } from 'node:sqlite';
  export default async function () {
    return {
      version: { libVersion: 'node:sqlite (uji)' },
      oo1: { DB: kelas },
      installOpfsSAHPoolVfs: async () => { throw new Error('OPFS tidak ada di Node (uji memakai memori)'); },
    };
  }
`);

/* ---------------- Memuat db.worker.js asli ---------------- */
let nomorModul = 0;
async function muatWorker(awal) {
  let kode = readFileSync(join(folder, 'db.worker.js'), 'utf8');
  const sebelum = kode;
  kode = kode.replace(/const KANDIDAT_SQLITE = \[[\s\S]*?\];/, `const KANDIDAT_SQLITE = [${JSON.stringify(pathToFileURL(join(tmp, 'tiruan-sqlite.mjs')).href)}];`);
  if (kode === sebelum) throw new Error('KANDIDAT_SQLITE tidak ditemukan di db.worker.js');
  const berkas = join(tmp, `db.worker.${++nomorModul}.mjs`);
  writeFileSync(berkas, kode);

  globalThis.__AWAL = awal;
  const menunggu = new Map();
  let pengendali = null;
  globalThis.self = {
    addEventListener: (jenis, fn) => { if (jenis === 'message') pengendali = fn; },
    postMessage: (m) => {
      const j = menunggu.get(m.id);
      if (!j) return;
      menunggu.delete(m.id);
      if (m.ok) j.resolve(m.hasil); else j.reject(new Error(m.galat));
    },
  };
  await import(pathToFileURL(berkas).href);
  let n = 0;
  return {
    panggil: (op, args) => new Promise((resolve, reject) => {
      const id = ++n;
      menunggu.set(id, { resolve, reject });
      pengendali({ data: { id, op, args } });
    }),
    mentah: () => globalThis.__DB_MENTAH,
  };
}

/* ---------------- Kerangka uji ---------------- */
const hasil = [];
async function uji(nama, fn) {
  try { await fn(); hasil.push({ nama, ok: true }); } catch (e) { hasil.push({ nama, ok: false, galat: e.message }); }
}
const sama = (a, b, pesan = '') => { if (a !== b) throw new Error(`${pesan} diharapkan ${JSON.stringify(b)}, dapat ${JSON.stringify(a)}`); };
const benar = (k, pesan) => { if (!k) throw new Error(pesan); };
async function gagalDengan(janji, pola, pesan) {
  try { await janji; } catch (e) { benar(pola.test(e.message), `${pesan}: galat tidak sesuai (${e.message})`); return; }
  throw new Error(`${pesan}: seharusnya gagal`);
}
const produk = (u = {}) => ({ sku: 'A1', nama: 'Produk A', modalSen: 1_000_000, targetUntungSen: 100_000, stok: 5, ...u });
const sku = (n) => `SKU-${String(n).padStart(3, '0')}`;

/* ---------------- Uji ---------------- */
await uji('skema baru dibuat langsung di v5 (kolom tayang, tabel penjualan)', async () => {
  const w = await muatWorker();
  const info = await w.panggil('init');
  sama(info.versiSkema, 5, 'versi skema');
  sama(info.jumlahProduk, 0, 'jumlah produk');
  const tabel = w.mentah().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['produk', 'penjualan', 'riwayat_modal', 'pengaturan']) benar(tabel.includes(t), `tabel ${t} ada`);
  const kolom = w.mentah().prepare('PRAGMA table_info(produk)').all().map((r) => r.name);
  benar(kolom.includes('tayang'), 'kolom tayang ada');
});

await uji('migrasi v4 -> v5: data lama utuh, tayang bawaan 0, riwayat modal utuh', async () => {
  const w = await muatWorker((m) => {
    m.exec(`
      CREATE TABLE produk (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL COLLATE NOCASE UNIQUE, nama TEXT NOT NULL,
        harga_sen INTEGER NOT NULL CHECK (harga_sen >= 0), stok INTEGER NOT NULL DEFAULT 0 CHECK (stok >= 0),
        dibuat_pada INTEGER NOT NULL, diubah_pada INTEGER NOT NULL,
        modal_sen INTEGER NOT NULL DEFAULT 0 CHECK (modal_sen >= 0),
        kemitraan_sen INTEGER NOT NULL DEFAULT 0 CHECK (kemitraan_sen >= 0),
        packing_sen INTEGER NOT NULL DEFAULT 0 CHECK (packing_sen >= 0),
        target_untung_sen INTEGER NOT NULL DEFAULT 0 CHECK (target_untung_sen >= 0),
        isi_paket INTEGER NOT NULL DEFAULT 1 CHECK (isi_paket >= 1),
        override_json TEXT NOT NULL DEFAULT '{}',
        supplier TEXT NOT NULL DEFAULT '', link_supplier TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_produk_nama ON produk (nama COLLATE NOCASE);
      CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL);
      CREATE TABLE riwayat_modal (
        id INTEGER PRIMARY KEY AUTOINCREMENT, produk_id INTEGER NOT NULL REFERENCES produk(id) ON DELETE CASCADE,
        lama_sen INTEGER NOT NULL CHECK (lama_sen >= 0), baru_sen INTEGER NOT NULL CHECK (baru_sen >= 0),
        dicatat_pada INTEGER NOT NULL
      );
      INSERT INTO produk (sku, nama, harga_sen, stok, dibuat_pada, diubah_pada, modal_sen, target_untung_sen, supplier)
        VALUES ('LAMA-1', 'Produk lama', 0, 7, 1, 1, 2500000, 150000, 'Toko X');
      INSERT INTO riwayat_modal (produk_id, lama_sen, baru_sen, dicatat_pada) VALUES (1, 2000000, 2500000, 5);
      INSERT INTO pengaturan (kunci, nilai) VALUES ('toko', '{"tipeToko":"mall"}');
      PRAGMA user_version = 4;
    `);
  });
  const info = await w.panggil('init');
  sama(info.versiSkema, 5, 'versi skema');
  sama(info.jumlahProduk, 1, 'produk lama tetap ada');
  const { baris } = await w.panggil('halaman', {});
  sama(baris[0].sku, 'LAMA-1', 'sku'); sama(baris[0].stok, 7, 'stok'); sama(baris[0].modalSen, 2_500_000, 'modal');
  sama(baris[0].supplier, 'Toko X', 'supplier'); sama(Number(baris[0].tayang), 0, 'tayang bawaan 0');
  const riwayat = await w.panggil('riwayatModal', { id: 1 });
  sama(riwayat.length, 1, 'riwayat modal utuh'); sama(riwayat[0].baruSen, 2_500_000, 'riwayat baru');
  sama((await w.panggil('ambilPengaturan')).tipeToko, 'mall', 'pengaturan utuh');
  // Fitur baru langsung bisa dipakai pada data hasil migrasi.
  sama(await w.panggil('ubahTayang', { id: 1, tayang: true }), true, 'ubahTayang setelah migrasi');
  const c = await w.panggil('catatPenjualan', { produkId: 1, hargaSen: 3_000_000, untungSen: 400_000 });
  sama(c.stok, 6, 'stok sesudah jual');
});

await uji('ubahTayang: menyimpan, menolak bukan boolean dan produk tak dikenal', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk());
  sama(Number(p.tayang), 0, 'bawaan belum tayang');
  sama(await w.panggil('ubahTayang', { id: p.id, tayang: true }), true, 'jadi tayang');
  sama((await w.panggil('ringkasan')).tayang, 1, 'ringkasan menghitung tayang');
  sama(await w.panggil('ubahTayang', { id: p.id, tayang: false }), false, 'lepas');
  await gagalDengan(w.panggil('ubahTayang', { id: p.id, tayang: 'ya' }), /true atau false/, 'bukan boolean');
  await gagalDengan(w.panggil('ubahTayang', { id: 999, tayang: true }), /tidak ditemukan/, 'id tak dikenal');
});

await uji('ubah produk lewat dialog tidak mereset status tayang', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk());
  await w.panggil('ubahTayang', { id: p.id, tayang: true });
  const ubah = await w.panggil('ubahProduk', { id: p.id, ...produk({ nama: 'Nama baru', stok: 9 }) });
  sama(ubah.nama, 'Nama baru', 'nama berubah'); sama(Number(ubah.tayang), 1, 'tayang tetap 1');
});

await uji('halaman: filter tayang, pencarian digabung, karakter khusus aman', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const a = await w.panggil('tambah', produk({ sku: 'K-1', nama: 'Kaos polos' }));
  const b = await w.panggil('tambah', produk({ sku: 'K-2', nama: 'Kaos 100% katun' }));
  await w.panggil('tambah', produk({ sku: 'T-1', nama: 'Tas' }));
  await w.panggil('ubahTayang', { id: a.id, tayang: true });
  await w.panggil('ubahTayang', { id: b.id, tayang: true });
  sama((await w.panggil('halaman', { tayang: true })).total, 2, 'hanya tayang');
  sama((await w.panggil('halaman', {})).total, 3, 'tanpa filter');
  sama((await w.panggil('halaman', { tayang: true, kata: 'polos' })).total, 1, 'tayang + cari');
  sama((await w.panggil('halaman', { tayang: true, kata: 'Tas' })).total, 0, 'produk tak tayang tidak ikut');
  const persen = await w.panggil('halaman', { tayang: true, kata: '100%' });
  sama(persen.total, 1, '% dicari apa adanya'); sama(persen.baris[0].sku, 'K-2', 'hasil %');
  sama((await w.panggil('halaman', { tayang: true, kata: '%' })).total, 1, '% bukan wildcard');
  await gagalDengan(w.panggil('halaman', { urut: 'acak' }), /urutan/, 'urutan tak dikenal');
});

await uji('urutan Etalase: perlu isi ulang di depan, stok paling sedikit dulu, lalu stok aman', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const stok = [50, 3, 12, 0, 10, 11, 3];
  for (const [i, s] of stok.entries()) {
    const p = await w.panggil('tambah', produk({ sku: sku(i), nama: `P${i}`, stok: s }));
    await w.panggil('ubahTayang', { id: p.id, tayang: true });
  }
  const { baris } = await w.panggil('halaman', { tayang: true, urut: 'etalase', batasMenipis: 10 });
  sama(baris.map((x) => x.stok).join(','), '0,3,3,10,11,12,50', 'urutan stok');
  sama(baris[1].sku, sku(1), 'stok sama: id lebih kecil dulu'); sama(baris[2].sku, sku(6), 'stok sama kedua');
  // Halaman kedua (paginasi) tetap konsisten dengan urutan yang sama.
  const hal2 = await w.panggil('halaman', { tayang: true, urut: 'etalase', batasMenipis: 10, batas: 3, offset: 3 });
  sama(hal2.baris.map((x) => x.stok).join(','), '10,11,12', 'halaman kedua'); sama(hal2.total, 7, 'total');
});

await uji('catatPenjualan: stok turun 1 dan catatan tersimpan lengkap (rugi boleh negatif)', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 3 }));
  const c = await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 8_990_000, untungSen: 123_456 });
  sama(c.stok, 2, 'stok'); sama(c.hargaSen, 8_990_000, 'harga'); sama(c.untungSen, 123_456, 'untung');
  sama(c.sku, 'A1', 'salinan sku'); sama(c.nama, 'Produk A', 'salinan nama'); benar(c.id > 0, 'id');
  const rugi = await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 5_000_000, untungSen: -250_000 });
  sama(rugi.untungSen, -250_000, 'untung negatif tersimpan');
  const baris = w.mentah().prepare('SELECT harga_sen, untung_sen, produk_id FROM penjualan ORDER BY id').all();
  sama(baris.length, 2, 'jumlah catatan'); sama(baris[1].untung_sen, -250_000, 'tersimpan di database');
  sama((await w.panggil('halaman', {})).baris[0].stok, 1, 'stok di database');
});

await uji('catatPenjualan: stok 0, produk tak ada, dan angka tidak sah ditolak tanpa mengubah apa pun', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 0 }));
  await gagalDengan(w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 1 }), /Stok habis/, 'stok 0');
  await gagalDengan(w.panggil('catatPenjualan', { produkId: 999, hargaSen: 100, untungSen: 1 }), /tidak ditemukan/, 'produk tak ada');
  const q = await w.panggil('tambah', produk({ sku: 'B2', stok: 4 }));
  await gagalDengan(w.panggil('catatPenjualan', { produkId: q.id, hargaSen: 99.5, untungSen: 1 }), /bilangan bulat/, 'harga pecahan');
  await gagalDengan(w.panggil('catatPenjualan', { produkId: q.id, hargaSen: -1, untungSen: 1 }), /tidak negatif/, 'harga negatif');
  await gagalDengan(w.panggil('catatPenjualan', { produkId: q.id, hargaSen: 100, untungSen: 1.5 }), /bilangan bulat/, 'untung pecahan');
  await gagalDengan(w.panggil('catatPenjualan', { produkId: q.id, hargaSen: 100, untungSen: NaN }), /bilangan bulat/, 'untung NaN');
  sama(w.mentah().prepare('SELECT COUNT(*) AS n FROM penjualan').get().n, 0, 'tidak ada catatan');
  sama(w.mentah().prepare('SELECT stok FROM produk WHERE id = ?').get(q.id).stok, 4, 'stok tidak berubah');
});

await uji('catatPenjualan atomik: bila catatan gagal ditulis, stok ikut dibatalkan', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 5 }));
  w.mentah().exec("CREATE TRIGGER gagal_uji BEFORE INSERT ON penjualan BEGIN SELECT RAISE(ABORT, 'gagal buatan'); END");
  await gagalDengan(w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 1 }), /gagal buatan/, 'insert gagal');
  sama(w.mentah().prepare('SELECT stok FROM produk WHERE id = ?').get(p.id).stok, 5, 'stok kembali utuh');
  w.mentah().exec('DROP TRIGGER gagal_uji');
  sama((await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 1 })).stok, 4, 'normal lagi setelah itu');
});

await uji('ketukan beruntun: stok 3, lima permintaan -> tepat 3 penjualan, stok tidak pernah negatif', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 3 }));
  const semua = await Promise.allSettled(
    Array.from({ length: 5 }, () => w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 10 }))
  );
  sama(semua.filter((x) => x.status === 'fulfilled').length, 3, 'berhasil');
  sama(semua.filter((x) => x.status === 'rejected').length, 2, 'ditolak');
  sama(w.mentah().prepare('SELECT stok FROM produk WHERE id = ?').get(p.id).stok, 0, 'stok akhir');
  sama(w.mentah().prepare('SELECT COUNT(*) AS n FROM penjualan').get().n, 3, 'jumlah catatan');
});

await uji('batalkanPenjualan: catatan hilang, stok kembali 1, batal kedua ditolak', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 2 }));
  const c = await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 5 });
  sama(c.stok, 1, 'sesudah jual');
  const b = await w.panggil('batalkanPenjualan', { id: c.id });
  sama(b.stok, 2, 'stok kembali');
  sama(w.mentah().prepare('SELECT COUNT(*) AS n FROM penjualan').get().n, 0, 'catatan terhapus');
  await gagalDengan(w.panggil('batalkanPenjualan', { id: c.id }), /tidak ditemukan/, 'batal dua kali');
  sama(w.mentah().prepare('SELECT stok FROM produk WHERE id = ?').get(p.id).stok, 2, 'stok tidak bertambah lagi');
  await gagalDengan(w.panggil('batalkanPenjualan', { id: 'x' }), /bilangan bulat/, 'id tak sah');
});

await uji('produk dihapus: catatan penjualan tetap ada (salinan nama/SKU), batal tidak menambah stok siapa pun', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 2 }));
  const c = await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 5 });
  await w.panggil('hapus', p.id);
  const sisa = w.mentah().prepare('SELECT produk_id, sku, nama FROM penjualan').all();
  sama(sisa.length, 1, 'catatan tetap'); sama(sisa[0].produk_id, null, 'produk_id NULL'); sama(sisa[0].nama, 'Produk A', 'nama tersalin');
  const b = await w.panggil('batalkanPenjualan', { id: c.id });
  sama(b.stok, null, 'tak ada stok untuk dikembalikan');
});

await uji('ringkasanPenjualan: hitung dan jumlah untung sejak waktu tertentu', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 10 }));
  await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 700 });
  await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: -200 });
  w.mentah().exec('UPDATE penjualan SET dicatat_pada = 1000 WHERE id = 1'); // catatan lama
  const semua = await w.panggil('ringkasanPenjualan', { sejak: 0 });
  sama(semua.jumlah, 2, 'semua'); sama(semua.untungSen, 500, 'untung gabungan');
  const baru = await w.panggil('ringkasanPenjualan', { sejak: 2000 });
  sama(baru.jumlah, 1, 'sejak 2000'); sama(baru.untungSen, -200, 'untung negatif');
  sama((await w.panggil('ringkasanPenjualan', { sejak: Date.now() + 60_000 })).jumlah, 0, 'masa depan kosong');
  await gagalDengan(w.panggil('ringkasanPenjualan', { sejak: -1 }), /tidak valid/, 'waktu negatif');
});

await uji('Hapus semua data juga mengosongkan penjualan; ringkasan tetap benar', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 2 }));
  await w.panggil('ubahTayang', { id: p.id, tayang: true });
  await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: 100, untungSen: 5 });
  await w.panggil('kosongkan');
  sama(w.mentah().prepare('SELECT COUNT(*) AS n FROM penjualan').get().n, 0, 'penjualan kosong');
  const r = await w.panggil('ringkasan');
  sama(r.jumlah, 0, 'jumlah'); sama(r.tayang, 0, 'tayang'); sama(r.totalStok, 0, 'stok');
});

await uji('operasi lama Fase 2-6 tetap jalan di skema v5 (stok, target, riwayat, dummy)', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 5 }));
  sama(await w.panggil('ubahStok', { id: p.id, selisih: -2 }), 3, 'ubahStok');
  sama(await w.panggil('ubahStok', { id: p.id, selisih: -99 }), 0, 'stok tidak negatif');
  sama(await w.panggil('ubahTarget', { id: p.id, targetUntungSen: 250_000 }), 250_000, 'ubahTarget');
  await w.panggil('ubahProduk', { id: p.id, ...produk({ modalSen: 1_200_000 }) });
  sama((await w.panggil('riwayatModal', { id: p.id })).length, 1, 'riwayat modal');
  const d = await w.panggil('suntikDummy', { jumlah: 1000 });
  sama(d.ditambah, 1000, 'dummy'); sama((await w.panggil('halaman', { batas: 24 })).total, 1001, 'total');
  sama((await w.panggil('ubahStokMassal', [{ id: p.id, stok: 12 }])), 1, 'ubahStokMassal');
});

const gagal = hasil.filter((x) => !x.ok);
for (const x of hasil) console.log(`${x.ok ? 'LOLOS' : 'GAGAL'}  ${x.nama}${x.ok ? '' : `\n        ${x.galat}`}`);
console.log(`\n${hasil.length - gagal.length} dari ${hasil.length} uji database lolos`);
process.exitCode = gagal.length ? 1 : 0;
