// laporan.js — logika murni tab Laporan Kalsara v6 (Fase 8)
//
// Modul MURNI (tanpa DOM) supaya bisa diuji di Node. Isinya: rentang waktu periode,
// persen margin (bilangan bulat ppm), dan penyusun berkas CSV.
// Uang selalu bilangan bulat SEN; pembagian hanya terjadi saat ditampilkan / diekspor.

import { awalHari } from './etalase.js';

export const PERIODE = [
  ['hari', 'Hari ini'],
  ['minggu', '7 hari terakhir'],
  ['bulan', 'Bulan ini'],
  ['semua', 'Semua'],
];

// Batas atas "tanpa batas" yang masih aman sebagai bilangan bulat SQLite.
export const WAKTU_MAKS = Number.MAX_SAFE_INTEGER;

// Rentang [dari, sampai) dalam ms menurut zona waktu perangkat. `sampai` tidak ikut.
export function rentangPeriode(kunci, sekarang = Date.now()) {
  const hariIni = awalHari(sekarang);
  const geser = (ms, hari) => { const d = new Date(ms); d.setDate(d.getDate() + hari); return d.getTime(); };
  switch (kunci) {
    case 'hari':
      return { dari: hariIni, sampai: geser(hariIni, 1) };
    case 'minggu':
      return { dari: geser(hariIni, -6), sampai: geser(hariIni, 1) };
    case 'bulan': {
      const d = new Date(sekarang);
      return { dari: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), sampai: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
    }
    case '30hari': // jendela perkiraan stok; tidak ada di menu Periode
      return { dari: geser(hariIni, -29), sampai: geser(hariIni, 1) };
    case 'semua':
      return { dari: 0, sampai: WAKTU_MAKS };
    default:
      throw new Error(`Periode tidak dikenal: ${kunci}`);
  }
}

const dua = (n) => String(n).padStart(2, '0');

// "2026-11-04" -> awal hari itu (ms, zona waktu perangkat), atau null bila bukan tanggal nyata
// (mis. "2026-02-31", "04/11/2026", kosong).
export function bacaTanggal(teks) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(teks ?? '').trim());
  if (!m) return null;
  const [y, b, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return null;
  const d = new Date(y, b - 1, t);
  if (d.getFullYear() !== y || d.getMonth() !== b - 1 || d.getDate() !== t) return null;
  return d.getTime();
}

// ms -> "2026-11-04" (zona waktu perangkat), untuk mengisi kolom tanggal.
export function teksTanggal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

// Periode bebas: kedua tanggal ikut (akhir sampai pukul 23:59 hari itu). Mengembalikan [dari, sampai).
export function rentangTanggal(dariTeks, sampaiTeks) {
  const dari = bacaTanggal(dariTeks);
  const akhir = bacaTanggal(sampaiTeks);
  if (dari === null || akhir === null) throw new Error('Isi tanggal awal dan tanggal akhir dengan benar.');
  if (akhir < dari) throw new Error('Tanggal akhir tidak boleh sebelum tanggal awal.');
  const d = new Date(akhir);
  d.setDate(d.getDate() + 1);
  return { dari, sampai: d.getTime() };
}

/* ---------------- Perkiraan stok habis ---------------- */
// Laju dihitung dari penjualan beberapa hari terakhir. Bila data baru ada beberapa hari, jendela
// dipendekkan sampai hari pertama penjualan, tapi tidak kurang dari 7 hari supaya satu hari ramai
// tidak membuat perkiraan terlalu pendek.
export const HARI_JENDELA_MAKS = 30;
export const HARI_JENDELA_MIN = 7;

export function hariJendela(sekarang, pertama) {
  if (pertama === null || pertama === undefined) return HARI_JENDELA_MIN;
  const selisih = Math.round((awalHari(sekarang) - awalHari(pertama)) / 86_400_000) + 1;
  return Math.min(HARI_JENDELA_MAKS, Math.max(HARI_JENDELA_MIN, selisih));
}

// Sisa hari sampai stok habis (dibulatkan ke bawah, bilangan bulat). null bila tidak ada penjualan.
export function hariSisa(stok, terjual, hari) {
  if (![stok, terjual, hari].every(Number.isSafeInteger) || hari < 1) throw new Error('Stok, terjual, dan hari harus bilangan bulat.');
  if (terjual <= 0) return null;
  if (stok <= 0) return 0;
  return Math.floor((stok * hari) / terjual);
}

export function teksSisa(hari) {
  if (hari === null || hari === undefined) return '-';
  if (hari <= 0) return 'kurang dari 1 hari';
  if (hari > 365) return 'lebih dari 1 tahun';
  return `${hari} hari`;
}

// Margin = untung / omzet, dalam ppm (1% = 10.000), dibulatkan menjauhi nol.
// BigInt dipakai agar perkalian tidak melewati batas bilangan bulat aman JavaScript.
export function marginPpm(untungSen, omzetSen) {
  if (!Number.isSafeInteger(untungSen) || !Number.isSafeInteger(omzetSen) || omzetSen <= 0) return null;
  const u = BigInt(untungSen);
  const o = BigInt(omzetSen);
  const negatif = u < 0n;
  const mutlak = negatif ? -u : u;
  const hasil = (mutlak * 1_000_000n + o / 2n) / o;
  return Number(negatif ? -hasil : hasil);
}

/* ---------------- CSV ---------------- */
// 1234567 sen -> "12345,67"; -200 -> "-2" (koma desimal, tanpa pemisah ribuan, hanya bilangan bulat).
export function senKeTeksCsv(sen) {
  if (!Number.isSafeInteger(sen)) throw new Error('Nominal harus bilangan bulat sen.');
  const tanda = sen < 0 ? '-' : '';
  const mutlak = Math.abs(sen);
  const rupiah = Math.floor(mutlak / 100);
  const sisa = mutlak % 100;
  return `${tanda}${rupiah}${sisa === 0 ? '' : `,${dua(sisa)}`}`;
}

// Waktu (ms) -> "2026-11-01 23:05" menurut zona waktu perangkat.
export function formatWaktuLengkap(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())} ${dua(d.getHours())}:${dua(d.getMinutes())}`;
}

// Sel teks CSV. Teks yang diawali = + - @ (atau tab / CR) diberi petik di depan supaya Excel
// tidak menjalankannya sebagai rumus. Sel dibungkus kutip bila memuat pemisah, kutip, atau baris baru.
export function selTeksCsv(teks) {
  let t = String(teks ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  if (/[";\r\n]/.test(t)) t = `"${t.replace(/"/g, '""')}"`;
  return t;
}

export const PEMISAH_CSV = ';'; // titik koma: terbuka rapi di Excel / Sheets berlokal Indonesia
export const KEPALA_CSV = ['Waktu', 'SKU', 'Nama', 'Harga (Rp)', 'Untung (Rp)'];

// baris: [{ dicatatPada, sku, nama, hargaSen, untungSen }] -> teks CSV (baris diakhiri CRLF).
export function bangunCsv(baris) {
  const keluar = [KEPALA_CSV.join(PEMISAH_CSV)];
  for (const b of baris) {
    keluar.push([
      formatWaktuLengkap(b.dicatatPada),
      selTeksCsv(b.sku),
      selTeksCsv(b.nama),
      senKeTeksCsv(b.hargaSen),
      senKeTeksCsv(b.untungSen),
    ].join(PEMISAH_CSV));
  }
  return `${keluar.join('\r\n')}\r\n`;
}

export function namaBerkasCsv(kunci, sekarang = Date.now(), tanggal = null) {
  if (kunci === 'kustom' && tanggal) {
    return `kalsara-penjualan-${tanggal.dari.replace(/-/g, '')}-${tanggal.sampai.replace(/-/g, '')}.csv`;
  }
  const d = new Date(sekarang);
  return `kalsara-penjualan-${kunci}-${d.getFullYear()}${dua(d.getMonth() + 1)}${dua(d.getDate())}.csv`;
}
