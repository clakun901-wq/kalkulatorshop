// uji-fase8.js — pemeriksaan modul murni Fase 8 (bukan bagian aplikasi).
// Jalan di Node: `node uji-fase8.js` dan di browser lewat uji-fase8.html.
// Uji database ada di uji-db-fase8.mjs (hanya Node 22+).

import {
  PERIODE, WAKTU_MAKS, rentangPeriode, marginPpm, senKeTeksCsv, selTeksCsv,
  formatWaktuLengkap, bangunCsv, namaBerkasCsv,
} from './laporan.js';

const hasilUji = [];
function uji(nama, fn) {
  try { fn(); hasilUji.push({ nama, ok: true }); } catch (e) { hasilUji.push({ nama, ok: false, galat: e.message }); }
}
const sama = (a, b, pesan = '') => { if (a !== b) throw new Error(`${pesan} diharapkan ${JSON.stringify(b)}, dapat ${JSON.stringify(a)}`); };
const benar = (k, pesan) => { if (!k) throw new Error(pesan); };
const gagal = (fn, pola, pesan) => {
  try { fn(); } catch (e) { benar(pola.test(e.message), `${pesan}: galat tidak sesuai (${e.message})`); return; }
  throw new Error(`${pesan}: seharusnya gagal`);
};

// Rabu, 4 Nov 2026 15:30 waktu perangkat (zona waktu apa pun: dibangun dari komponen lokal).
const SEKARANG = new Date(2026, 10, 4, 15, 30, 0).getTime();
const lokal = (t, b, h, j = 0, m = 0) => new Date(t, b, h, j, m, 0, 0).getTime();

uji('rentang hari ini: 00:00 sampai 00:00 besok', () => {
  const r = rentangPeriode('hari', SEKARANG);
  sama(r.dari, lokal(2026, 10, 4), 'dari'); sama(r.sampai, lokal(2026, 10, 5), 'sampai');
  benar(SEKARANG >= r.dari && SEKARANG < r.sampai, 'sekarang di dalam rentang');
});

uji('rentang 7 hari terakhir: tepat 7 hari kalender termasuk hari ini', () => {
  const r = rentangPeriode('minggu', SEKARANG);
  sama(r.dari, lokal(2026, 10, -2), 'dari = 29 Okt (4 Nov dikurangi 6 hari)');
  sama(r.sampai, lokal(2026, 10, 5), 'sampai');
});

uji('rentang bulan ini: 1 Nov sampai 1 Des; melintasi akhir tahun benar', () => {
  const r = rentangPeriode('bulan', SEKARANG);
  sama(r.dari, lokal(2026, 10, 1), 'dari'); sama(r.sampai, lokal(2026, 11, 1), 'sampai');
  const d = rentangPeriode('bulan', lokal(2026, 11, 31, 23, 59));
  sama(d.dari, lokal(2026, 11, 1), 'Des dari'); sama(d.sampai, lokal(2027, 0, 1), 'Des sampai = 1 Jan');
});

uji('rentang semua dan periode tak dikenal', () => {
  const r = rentangPeriode('semua', SEKARANG);
  sama(r.dari, 0, 'dari'); sama(r.sampai, WAKTU_MAKS, 'sampai');
  gagal(() => rentangPeriode('kemarin', SEKARANG), /tidak dikenal/, 'periode');
  for (const [kunci] of PERIODE) rentangPeriode(kunci, SEKARANG); // semua pilihan menu valid
});

uji('batas penjualan tepat: 00:00 masuk hari ini, 23:59:59.999 kemarin tidak', () => {
  const r = rentangPeriode('hari', SEKARANG);
  const masuk = (t) => t >= r.dari && t < r.sampai;
  benar(masuk(lokal(2026, 10, 4, 0, 0)), '00:00 masuk');
  benar(!masuk(lokal(2026, 10, 4) - 1), 'sebelum 00:00 tidak masuk');
  benar(!masuk(lokal(2026, 10, 5)), '00:00 besok tidak masuk');
});

uji('margin ppm: pembulatan menjauhi nol, rugi negatif, omzet 0 = null', () => {
  sama(marginPpm(5008, 27020), 185_344, '18,5%'); // 5008/27020 = 0,185344...
  sama(marginPpm(1, 3), 333_333, '1/3');
  sama(marginPpm(2, 3), 666_667, '2/3 dibulatkan naik');
  sama(marginPpm(-200, 1000), -200_000, 'rugi');
  sama(marginPpm(-2, 3), -666_667, 'negatif dibulatkan menjauhi nol');
  sama(marginPpm(0, 1000), 0, 'untung nol');
  sama(marginPpm(5, 0), null, 'omzet 0'); sama(marginPpm(5, -1), null, 'omzet negatif');
  sama(marginPpm(1.5, 10), null, 'bukan bilangan bulat');
});

uji('margin ppm: nominal sangat besar tidak melewati batas bilangan aman', () => {
  const omzet = 9_000_000_000_000_000; // Rp 90 triliun dalam sen
  sama(marginPpm(omzet / 2, omzet), 500_000, 'separuh');
  sama(marginPpm(omzet, omzet), 1_000_000, '100%');
});

uji('sen ke teks CSV: bilangan bulat murni, tanpa float', () => {
  sama(senKeTeksCsv(0), '0'); sama(senKeTeksCsv(100), '1'); sama(senKeTeksCsv(2_702_000), '27020');
  sama(senKeTeksCsv(1), '0,01'); sama(senKeTeksCsv(150), '1,50'); sama(senKeTeksCsv(-200), '-2');
  sama(senKeTeksCsv(-1), '-0,01'); sama(senKeTeksCsv(500_816), '5008,16');
  gagal(() => senKeTeksCsv(1.5), /bilangan bulat/, 'pecahan'); gagal(() => senKeTeksCsv(NaN), /bilangan bulat/, 'NaN');
});

uji('sel teks CSV: kutip, titik koma, baris baru, dan penangkal rumus', () => {
  sama(selTeksCsv('Plastik 20x30'), 'Plastik 20x30');
  sama(selTeksCsv('A;B'), '"A;B"');
  sama(selTeksCsv('Kata "bagus"'), '"Kata ""bagus"""');
  sama(selTeksCsv('baris1\nbaris2'), '"baris1\nbaris2"');
  sama(selTeksCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  sama(selTeksCsv('+62812'), "'+62812"); sama(selTeksCsv('-5'), "'-5"); sama(selTeksCsv('@SUM(A1)'), "'@SUM(A1)");
  sama(selTeksCsv(null), ''); sama(selTeksCsv(undefined), '');
});

uji('CSV lengkap: kepala, baris, rugi negatif tidak diberi petik, akhir CRLF', () => {
  const waktu = lokal(2026, 10, 4, 9, 5);
  const csv = bangunCsv([
    { dicatatPada: waktu, sku: 'KLS-002', nama: 'Plastik vacuum (isi 50)', hargaSen: 2_702_000, untungSen: 500_800 },
    { dicatatPada: waktu + 60_000, sku: '=BAHAYA', nama: 'Nama; aneh', hargaSen: 100, untungSen: -200 },
  ]);
  const baris = csv.split('\r\n');
  sama(baris.length, 4, 'tiga baris + akhir kosong'); sama(baris[3], '', 'berakhir CRLF');
  sama(baris[0], 'Waktu;SKU;Nama;Harga (Rp);Untung (Rp)', 'kepala');
  sama(baris[1], '2026-11-04 09:05;KLS-002;Plastik vacuum (isi 50);27020;5008', 'baris 1');
  sama(baris[2], "2026-11-04 09:06;'=BAHAYA;\"Nama; aneh\";1;-2", 'baris 2');
  sama(bangunCsv([]), 'Waktu;SKU;Nama;Harga (Rp);Untung (Rp)\r\n', 'tanpa data hanya kepala');
});

uji('waktu lengkap dan nama berkas', () => {
  sama(formatWaktuLengkap(lokal(2026, 0, 2, 3, 4)), '2026-01-02 03:04');
  sama(namaBerkasCsv('minggu', SEKARANG), 'kalsara-penjualan-minggu-20261104.csv');
});

const gagalSemua = hasilUji.filter((x) => !x.ok);
if (typeof document === 'undefined') {
  for (const x of hasilUji) console.log(`${x.ok ? 'LOLOS' : 'GAGAL'}  ${x.nama}${x.ok ? '' : `\n        ${x.galat}`}`);
  console.log(`\n${hasilUji.length - gagalSemua.length} dari ${hasilUji.length} uji lolos`);
  process.exitCode = gagalSemua.length ? 1 : 0;
} else {
  document.getElementById('ringkasan').textContent = `${hasilUji.length - gagalSemua.length} dari ${hasilUji.length} uji lolos`;
  const daftar = document.getElementById('daftar-uji');
  for (const x of hasilUji) {
    const li = document.createElement('li');
    li.className = `uji ${x.ok ? 'lolos' : 'gagal'}`;
    li.textContent = `${x.ok ? 'LOLOS' : 'GAGAL'}  ${x.nama}${x.ok ? '' : ` — ${x.galat}`}`;
    daftar.append(li);
  }
}
