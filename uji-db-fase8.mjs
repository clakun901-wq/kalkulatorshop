// uji-db-fase7.mjs — uji database Fase 8 (bukan bagian aplikasi). Jalan di Node 22+:
//   node --no-warnings uji-db-fase8.mjs
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
const T = 1_700_000_000_000; // waktu tetap supaya hasil tidak bergantung jam
async function jual(w, p, harga, untung, waktu) {
  const c = await w.panggil('catatPenjualan', { produkId: p.id, hargaSen: harga, untungSen: untung });
  w.mentah().exec(`UPDATE penjualan SET dicatat_pada = ${waktu} WHERE id = ${c.id}`);
  return c;
}

await uji('laporanRingkas: jumlah, omzet, untung, jumlah rugi; batas [dari, sampai) tepat', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 20 }));
  await jual(w, p, 2_702_000, 500_800, T);
  await jual(w, p, 2_702_000, 500_800, T + 1000);
  await jual(w, p, 100, -200, T + 2000);
  const semua = await w.panggil('laporanRingkas', { dari: 0, sampai: Number.MAX_SAFE_INTEGER });
  sama(semua.jumlah, 3, 'jumlah'); sama(semua.omzetSen, 5_404_100, 'omzet'); sama(semua.untungSen, 1_001_400, 'untung'); sama(semua.jumlahRugi, 1, 'rugi');
  const tepat = await w.panggil('laporanRingkas', { dari: T, sampai: T + 2000 });
  sama(tepat.jumlah, 2, 'sampai tidak ikut (T+2000 dikecualikan)');
  const dariTepat = await w.panggil('laporanRingkas', { dari: T + 1000, sampai: T + 2001 });
  sama(dariTepat.jumlah, 2, 'dari ikut (T+1000 dihitung)');
  const kosong = await w.panggil('laporanRingkas', { dari: T + 10_000, sampai: T + 20_000 });
  sama(kosong.jumlah, 0, 'kosong'); sama(kosong.omzetSen, 0, 'omzet kosong'); sama(kosong.untungSen, 0, 'untung kosong'); sama(kosong.jumlahRugi, 0, 'rugi kosong');
});

await uji('laporan menolak rentang tidak valid', async () => {
  const w = await muatWorker(); await w.panggil('init');
  await gagalDengan(w.panggil('laporanRingkas', { dari: -1, sampai: 5 }), /Awal periode/, 'dari negatif');
  await gagalDengan(w.panggil('laporanRingkas', { dari: 10, sampai: 5 }), /Akhir periode/, 'sampai < dari');
  await gagalDengan(w.panggil('laporanRingkas', { dari: 1.5, sampai: 5 }), /Awal periode/, 'dari pecahan');
  await gagalDengan(w.panggil('laporanRingkas', undefined), /Awal periode/, 'tanpa argumen');
  await gagalDengan(w.panggil('laporanProduk', { dari: 0, sampai: 5, batas: 0 }), /batas/, 'batas 0');
  await gagalDengan(w.panggil('laporanProduk', { dari: 0, sampai: 5, urut: 'acak' }), /urutan/, 'urutan');
  await gagalDengan(w.panggil('daftarPenjualan', { dari: 0, sampai: 5, offset: -1 }), /offset/, 'offset');
  await gagalDengan(w.panggil('semuaPenjualan', { dari: 5, sampai: 1 }), /Akhir periode/, 'ekspor rentang terbalik');
});

await uji('laporanProduk: dikelompokkan per SKU, urutan untung dan paling laku, stok sekarang', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const a = await w.panggil('tambah', produk({ sku: 'A', nama: 'Produk A', stok: 10 }));
  const b = await w.panggil('tambah', produk({ sku: 'B', nama: 'Produk B', stok: 10 }));
  const c = await w.panggil('tambah', produk({ sku: 'C', nama: 'Produk C', stok: 10 }));
  await jual(w, a, 1000, 300, T); // A: 1 terjual, untung 300
  for (let n = 0; n < 3; n++) await jual(w, b, 500, 50, T + n); // B: 3 terjual, untung 150
  await jual(w, c, 400, -100, T); await jual(w, c, 400, 900, T + 1); // C: 2 terjual, untung 800
  const r = { dari: 0, sampai: Number.MAX_SAFE_INTEGER };
  const untung = await w.panggil('laporanProduk', { ...r, urut: 'untung' });
  sama(untung.map((x) => x.sku).join(','), 'C,A,B', 'urut untung terbesar');
  sama(untung[0].terjual, 2, 'C terjual'); sama(untung[0].untungSen, 800, 'C untung'); sama(untung[0].omzetSen, 800, 'C omzet'); sama(untung[0].stok, 8, 'C stok tersisa');
  const laku = await w.panggil('laporanProduk', { ...r, urut: 'terjual' });
  sama(laku.map((x) => x.sku).join(','), 'B,C,A', 'urut paling laku');
  sama((await w.panggil('laporanProduk', { ...r })).map((x) => x.sku).join(','), 'C,A,B', 'bawaan = untung');
  sama((await w.panggil('laporanProduk', { ...r, batas: 2 })).length, 2, 'batas 2');
  sama((await w.panggil('laporanProduk', { dari: T + 100, sampai: T + 200 })).length, 0, 'periode kosong');
});

await uji('laporan tetap utuh setelah produk dihapus (stok null, nama dan SKU salinan)', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ sku: 'DEL', nama: 'Akan dihapus', stok: 5 }));
  await jual(w, p, 700, 70, T); await jual(w, p, 700, 70, T + 1);
  await w.panggil('hapus', p.id);
  const r = { dari: 0, sampai: Number.MAX_SAFE_INTEGER };
  const prod = await w.panggil('laporanProduk', r);
  sama(prod.length, 1, 'satu SKU'); sama(prod[0].terjual, 2, 'terjual'); sama(prod[0].stok, null, 'stok null'); sama(prod[0].nama, 'Akan dihapus', 'nama salinan');
  const ring = await w.panggil('laporanRingkas', r);
  sama(ring.jumlah, 2, 'ringkas'); sama(ring.untungSen, 140, 'untung');
  const daftar = await w.panggil('daftarPenjualan', r);
  sama(daftar.total, 2, 'daftar'); sama(daftar.baris[0].sku, 'DEL', 'SKU salinan');
});

await uji('daftarPenjualan: terbaru dulu, paginasi, total benar, halaman melewati akhir kosong', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ stok: 100 }));
  for (let n = 0; n < 7; n++) await jual(w, p, 100 + n, n, T + n * 10);
  const r = { dari: 0, sampai: Number.MAX_SAFE_INTEGER };
  const h1 = await w.panggil('daftarPenjualan', { ...r, batas: 3, offset: 0 });
  sama(h1.total, 7, 'total'); sama(h1.baris.map((x) => x.untungSen).join(','), '6,5,4', 'halaman 1 terbaru dulu');
  const h3 = await w.panggil('daftarPenjualan', { ...r, batas: 3, offset: 6 });
  sama(h3.baris.length, 1, 'halaman terakhir'); sama(h3.baris[0].untungSen, 0, 'paling lama');
  sama((await w.panggil('daftarPenjualan', { ...r, batas: 3, offset: 30 })).baris.length, 0, 'lewat akhir');
  const satu = await w.panggil('daftarPenjualan', { dari: T + 20, sampai: T + 40, batas: 10 });
  sama(satu.total, 2, 'rentang sempit'); sama(satu.baris.length, 2, 'baris rentang sempit');
  const sama_waktu = await w.panggil('tambah', produk({ sku: 'Z', stok: 5 }));
  await jual(w, sama_waktu, 1, 1, T + 65); await jual(w, sama_waktu, 1, 2, T + 65);
  const urutan = await w.panggil('daftarPenjualan', { dari: T + 65, sampai: T + 66 });
  sama(urutan.baris.map((x) => x.untungSen).join(','), '2,1', 'waktu sama: id lebih besar dulu');
});

await uji('semuaPenjualan: urut waktu naik, bentuk baris cocok bangunCsv, batas ekspor menolak', async () => {
  const w = await muatWorker(); await w.panggil('init');
  const p = await w.panggil('tambah', produk({ sku: 'X', nama: 'Nama; "aneh"', stok: 5 }));
  await jual(w, p, 2_702_000, 500_800, T + 5); await jual(w, p, 100, -200, T);
  const semua = await w.panggil('semuaPenjualan', { dari: 0, sampai: Number.MAX_SAFE_INTEGER });
  sama(semua.map((x) => x.untungSen).join(','), '-200,500800', 'waktu naik');
  const { bangunCsv } = await import(pathToFileURL(join(folder, 'laporan.js')).href);
  const csv = bangunCsv(semua).split('\r\n');
  sama(csv.length, 4, 'baris CSV'); benar(csv[1].endsWith(';-2'), 'rugi tanpa petik'); benar(csv[2].includes('"Nama; ""aneh"""'), 'nama di-escape');
  sama((await w.panggil('semuaPenjualan', { dari: T + 100, sampai: T + 200 })).length, 0, 'kosong');
  // batas ekspor: isi langsung lewat SQL, bukan 100.000 panggilan
  w.mentah().exec('BEGIN');
  const ins = w.mentah().prepare("INSERT INTO penjualan (produk_id, sku, nama, harga_sen, untung_sen, dicatat_pada) VALUES (NULL, 'M', 'Massal', 1, 1, ?)");
  for (let n = 0; n < 100_000; n++) ins.run(T + 1000 + n);
  w.mentah().exec('COMMIT');
  await gagalDengan(w.panggil('semuaPenjualan', { dari: 0, sampai: Number.MAX_SAFE_INTEGER }), /Pilih periode/, '100.002 baris');
  sama((await w.panggil('semuaPenjualan', { dari: T + 1000, sampai: T + 1000 + 100_000 })).length, 100_000, 'tepat 100.000 baris boleh');
});

await uji('operasi laporan hanya membaca: skema tetap v5, tabel tidak berubah, Batalkan Fase 7 tetap jalan', async () => {
  const w = await muatWorker();
  const info = await w.panggil('init');
  sama(info.versiSkema, 5, 'versi skema tetap 5');
  const p = await w.panggil('tambah', produk({ stok: 3 }));
  const c = await jual(w, p, 100, 10, T);
  const sebelum = JSON.stringify(w.mentah().prepare('SELECT * FROM penjualan').all());
  const r = { dari: 0, sampai: Number.MAX_SAFE_INTEGER };
  await w.panggil('laporanRingkas', r); await w.panggil('laporanProduk', r); await w.panggil('daftarPenjualan', r); await w.panggil('semuaPenjualan', r);
  sama(JSON.stringify(w.mentah().prepare('SELECT * FROM penjualan').all()), sebelum, 'penjualan tidak berubah');
  sama((await w.panggil('batalkanPenjualan', { id: c.id })).stok, 3, 'batalkan mengembalikan stok');
  sama((await w.panggil('laporanRingkas', r)).jumlah, 0, 'laporan ikut kosong setelah dibatalkan');
});

await uji('uji beban: 20.000 penjualan, 1.000 SKU, keempat kueri cepat dan benar', async () => {
  const w = await muatWorker(); await w.panggil('init');
  w.mentah().exec('BEGIN');
  const ins = w.mentah().prepare("INSERT INTO penjualan (produk_id, sku, nama, harga_sen, untung_sen, dicatat_pada) VALUES (NULL, ?, ?, ?, ?, ?)");
  let untungTotal = 0; let omzetTotal = 0;
  for (let n = 0; n < 20_000; n++) {
    const harga = 1000 + (n % 97) * 100; const untung = (n % 13 === 0 ? -1 : 1) * (50 + (n % 29)) * 10;
    ins.run(`S${n % 1000}`, `Produk ${n % 1000}`, harga, untung, T + n);
    untungTotal += untung; omzetTotal += harga;
  }
  w.mentah().exec('COMMIT');
  const r = { dari: 0, sampai: Number.MAX_SAFE_INTEGER };
  const mulai = performance.now();
  const ring = await w.panggil('laporanRingkas', r);
  const prod = await w.panggil('laporanProduk', { ...r, batas: 10 });
  const dp = await w.panggil('daftarPenjualan', { ...r, batas: 25 });
  const sem = await w.panggil('semuaPenjualan', r);
  const ms = performance.now() - mulai;
  sama(ring.jumlah, 20_000, 'jumlah'); sama(ring.untungSen, untungTotal, 'untung cocok hitungan JS'); sama(ring.omzetSen, omzetTotal, 'omzet cocok hitungan JS');
  sama(prod.length, 10, 'top 10'); sama(dp.total, 20_000, 'total daftar'); sama(sem.length, 20_000, 'ekspor');
  sama(prod.reduce((a, x) => a + x.terjual, 0) > 0, true, 'top produk terisi');
  benar(ms < 3000, `empat kueri 20.000 baris terlalu lambat: ${Math.round(ms)} ms`);
  console.log(`        (empat kueri pada 20.000 penjualan: ${Math.round(ms)} ms di Node)`);
});

const gagal = hasil.filter((x) => !x.ok);
for (const x of hasil) console.log(`${x.ok ? 'LOLOS' : 'GAGAL'}  ${x.nama}${x.ok ? '' : `\n        ${x.galat}`}`);
console.log(`\n${hasil.length - gagal.length} dari ${hasil.length} uji database lolos`);
process.exitCode = gagal.length ? 1 : 0;
