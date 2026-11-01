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
    case 'semua':
      return { dari: 0, sampai: WAKTU_MAKS };
    default:
      throw new Error(`Periode tidak dikenal: ${kunci}`);
  }
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
const dua = (n) => String(n).padStart(2, '0');

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

export function namaBerkasCsv(kunci, sekarang = Date.now()) {
  const d = new Date(sekarang);
  return `kalsara-penjualan-${kunci}-${d.getFullYear()}${dua(d.getMonth() + 1)}${dua(d.getDate())}.csv`;
}
