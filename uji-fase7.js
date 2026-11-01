// uji-fase7.js — pemeriksaan modul murni Fase 7 (bukan bagian aplikasi).
// Jalan di Node: `node uji-fase7.js` dan di browser lewat uji-fase7.html.
// Uji database ada di uji-db-fase7.mjs (hanya Node), uji tampilan dilakukan di HP / browser.

import {
  BATAS_HAMPIR_HABIS, BATAS_MENIPIS, LAMA_GEMBOK_MS, statusStok, perluIsiUlang,
  buatGembok, teksPenjualan, awalHari, bacaStok,
} from './etalase.js';

const hasilUji = [];
function uji(nama, fn) {
  try { fn(); hasilUji.push({ nama, ok: true }); } catch (e) { hasilUji.push({ nama, ok: false, galat: e.message }); }
}
const sama = (a, b, pesan = '') => { if (a !== b) throw new Error(`${pesan} diharapkan ${JSON.stringify(b)}, dapat ${JSON.stringify(a)}`); };
const benar = (k, pesan) => { if (!k) throw new Error(pesan); };

uji('status stok: batas habis / hampir habis / menipis / aman tepat di ujung', () => {
  sama(statusStok(0), 'habis', '0'); sama(statusStok(null), 'habis', 'null'); sama(statusStok(-3), 'habis', 'negatif');
  sama(statusStok(1), 'hampir', '1'); sama(statusStok(BATAS_HAMPIR_HABIS), 'hampir', 'batas hampir habis');
  sama(statusStok(BATAS_HAMPIR_HABIS + 1), 'menipis', 'di atas hampir habis');
  sama(statusStok(BATAS_MENIPIS), 'menipis', 'batas menipis');
  sama(statusStok(BATAS_MENIPIS + 1), 'aman', 'di atas menipis');
  sama(statusStok(999_999), 'aman', 'banyak');
  benar(BATAS_HAMPIR_HABIS <= BATAS_MENIPIS, 'batas hampir habis tidak boleh melebihi batas menipis');
});

uji('perluIsiUlang cocok dengan urutan di database (stok <= batas menipis)', () => {
  for (let s = 0; s <= BATAS_MENIPIS; s++) benar(perluIsiUlang(s), `stok ${s} perlu isi ulang`);
  for (const s of [BATAS_MENIPIS + 1, 50, 10_000]) benar(!perluIsiUlang(s), `stok ${s} aman`);
});

uji('gembok: terkunci bawaan, terbuka tepat 10 detik, lalu terkunci sendiri', () => {
  let t = 1_000_000;
  const g = buatGembok({ sekarang: () => t });
  sama(LAMA_GEMBOK_MS, 10_000, 'lama bawaan');
  sama(g.terbuka(7), false, 'bawaan terkunci');
  g.buka(7);
  sama(g.terbuka(7), true, 'terbuka');
  t += 9_999; sama(g.terbuka(7), true, 'detik 9,999 masih terbuka');
  t += 1; sama(g.terbuka(7), false, 'tepat 10 detik sudah terkunci');
});

uji('gembok: perpanjang memulai lagi dari awal, hanya bila sedang terbuka', () => {
  let t = 0;
  const g = buatGembok({ sekarang: () => t });
  g.perpanjang(1); sama(g.terbuka(1), false, 'perpanjang pada gembok terkunci tidak membukanya');
  g.buka(1);
  t += 8_000; g.perpanjang(1);
  t += 8_000; sama(g.terbuka(1), true, 'diperpanjang: masih terbuka di detik 16');
  t += 2_000; sama(g.terbuka(1), false, 'terkunci 10 detik setelah ketukan terakhir');
  t += 5_000; g.perpanjang(1); sama(g.terbuka(1), false, 'perpanjang sesudah kedaluwarsa tidak menghidupkan lagi');
});

uji('gembok: tiap produk berdiri sendiri; kunci, kunciSemua, bersihkan', () => {
  let t = 0;
  const g = buatGembok({ sekarang: () => t });
  g.buka(1); t += 4_000; g.buka(2);
  sama(g.jumlahTerbuka, 2, 'dua terbuka');
  t += 6_000; // produk 1 sudah 10 detik, produk 2 baru 6 detik
  sama(g.terbuka(1), false, 'produk 1 terkunci'); sama(g.terbuka(2), true, 'produk 2 masih terbuka');
  sama(g.bersihkan(), true, 'bersihkan membuang yang lewat waktu');
  sama(g.jumlahTerbuka, 1, 'tersisa satu'); sama(g.bersihkan(), false, 'tidak ada lagi yang dibuang');
  g.buka(3); sama(g.kunci(3), true, 'kunci manual'); sama(g.terbuka(3), false, 'terkunci manual');
  g.buka(4); sama(g.kunciSemua(), true, 'kunciSemua'); sama(g.jumlahTerbuka, 0, 'semua terkunci');
  sama(g.kunciSemua(), false, 'kunciSemua saat kosong');
});

uji('gembok: lama bisa diatur (untuk uji), tanpa pengaturan memakai jam sungguhan', () => {
  const g = buatGembok({ lama: 50 });
  g.buka(1); sama(g.terbuka(1), true, 'terbuka segera setelah dibuka');
  const h = buatGembok();
  h.buka(9); sama(h.terbuka(9), true, 'jam sungguhan');
});

uji('kalimat penjualan: untung, rugi, sisa stok, stok habis', () => {
  const u = teksPenjualan({ nama: 'Kaos A', untungSen: 1_234_500, stok: 19 });
  benar(u.startsWith('Terjual 1: Kaos A. Untung ') && u.includes('12.345') && u.endsWith('Sisa stok 19 pcs.'), `untung: ${u}`);
  benar(teksPenjualan({ nama: 'B', untungSen: -250_000, stok: 3 }).includes('Rugi'), 'rugi memakai kata Rugi');
  benar(!/-/.test(teksPenjualan({ nama: 'B', untungSen: -250_000, stok: 3 }).replace('Terjual 1: B.', '')), 'tanpa tanda minus ganda');
  benar(teksPenjualan({ nama: 'C', untungSen: 0, stok: 0 }).endsWith('Stok habis.'), 'stok habis');
  benar(teksPenjualan({ nama: 'C', untungSen: 0, stok: 0 }).includes('Untung'), 'untung nol bukan rugi');
});

uji('awalHari: pukul 00:00 waktu perangkat, tidak melewati waktu sekarang', () => {
  const kini = new Date(2026, 10, 1, 15, 42, 7, 321).getTime();
  const awal = awalHari(kini);
  const d = new Date(awal);
  sama(d.getHours() + d.getMinutes() + d.getSeconds() + d.getMilliseconds(), 0, 'jam nol');
  sama(d.getDate(), 1, 'tanggal sama');
  benar(awal <= kini && kini - awal < 24 * 3600 * 1000 + 3600 * 1000, 'dalam sehari');
});

uji('bacaStok: hanya bilangan bulat >= 0; titik ribuan boleh; selainnya ditolak', () => {
  sama(bacaStok('12'), 12, '12'); sama(bacaStok(' 40 '), 40, 'spasi'); sama(bacaStok('0'), 0, 'nol');
  sama(bacaStok('1.250'), 1250, 'titik ribuan'); sama(bacaStok('1.250.000'), 1_250_000, 'dua titik ribuan');
  sama(bacaStok('999999999'), 999_999_999, 'maksimum 9 digit'); sama(bacaStok('999.999.999'), 999_999_999, 'maksimum berpemisah');
  // Salah ketik desimal TIDAK boleh dibaca sebagai bilangan lebih besar (1.5 bukan 15).
  for (const buruk of ['1.5', '12.34', '1.5.', '1.2500', '.500', '1.250.', '1.000.000.000', '', '  ', '-1', '1,5', 'abc', '12abc', '1e3', '0x10', '9999999999', null, undefined]) {
    sama(bacaStok(buruk), null, `tolak ${JSON.stringify(buruk)}`);
  }
});

const gagal = hasilUji.filter((x) => !x.ok);
const teksRingkas = `${hasilUji.length - gagal.length} dari ${hasilUji.length} uji lolos`;
if (typeof document === 'undefined') {
  for (const x of hasilUji) console.log(`${x.ok ? 'LOLOS' : 'GAGAL'}  ${x.nama}${x.ok ? '' : `\n        ${x.galat}`}`);
  console.log(`\n${teksRingkas}`);
  process.exitCode = gagal.length ? 1 : 0;
} else {
  const ringkas = document.getElementById('ringkasan');
  ringkas.textContent = teksRingkas;
  ringkas.dataset.status = gagal.length ? 'gagal' : 'lolos';
  const daftar = document.getElementById('daftar-uji');
  for (const x of hasilUji) {
    const li = document.createElement('li');
    li.className = `uji ${x.ok ? 'lolos' : 'gagal'}`;
    li.textContent = `${x.ok ? 'Lolos' : 'GAGAL'} · ${x.nama}${x.ok ? '' : ` — ${x.galat}`}`;
    daftar.append(li);
  }
}
