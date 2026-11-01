// rincian.js — bahan tampilan hasil hitung Kalsara v6 (Fase 6)
//
// Modul MURNI (tanpa DOM). Mengubah hasil kalkulator menjadi:
//   - baris rincian biaya ("Lihat rincian biaya"),
//   - bagian grafik "Ke mana harga jual pergi",
//   - pesan peringatan untung,
//   - baris riwayat modal.
// Uang tetap bilangan bulat sen; yang dikembalikan adalah data, bukan HTML.

import { persenDari, gabungPengaturan } from './calculator.js';
import { formatRupiah, formatPersenPpm, formatTarifPpm, formatTanggalPendek } from './format.js';

/* ---------------------------------------------------------------
   Grafik: modal + potongan + untung (setara sp() di v5.82)
---------------------------------------------------------------- */
export function bagianGrafik(hasil) {
  const modalSen = hasil.modalSen;
  const potonganSen = hasil.biaya.totalPlatformSen + hasil.premiSen + hasil.pajakSen +
    hasil.iklanSen + hasil.returSen + hasil.biayaLainSen;
  const untungSen = Math.max(hasil.untungSen, 0);
  const total = modalSen + potonganSen + untungSen;
  if (total <= 0) return null;

  const persen = (sen) => Math.round((sen * 100) / total);
  // Lebar batang memakai persepuluh persen (bilangan bulat) agar jumlahnya tepat 1000.
  const lebar = (sen) => Math.round((sen * 1000) / total);
  const lMod = lebar(modalSen);
  const lPot = lebar(potonganSen);
  return {
    modalSen,
    potonganSen,
    untungSen,
    modalPersen: persen(modalSen),
    potonganPersen: persen(potonganSen),
    untungPersen: persen(untungSen),
    lebarModal: lMod,
    lebarPotongan: lPot,
    lebarUntung: Math.max(0, 1000 - lMod - lPot),
  };
}

/* ---------------------------------------------------------------
   Rincian biaya (setara "Lihat rincian biaya" di v5.82)
   Setiap baris: { label, sen, catatan?, gaya? }  gaya: 'ok' | 'bad' | 'tebal'
---------------------------------------------------------------- */
function barisTarif(label, ppm, nilaiSen, mentahSen, wajib = false) {
  if (!(ppm > 0) && !wajib) return null;
  return {
    label: `${label} (${formatTarifPpm(ppm)}%)`,
    sen: nilaiSen,
    catatan: mentahSen > nilaiSen ? 'kena batas' : undefined,
  };
}

export function barisRincian(hasil, { impasSen = null, targetSen = 0 } = {}) {
  const R = hasil.tarif;
  const b = hasil.biaya;
  const P = hasil.hargaPembeliSen;
  const baris = [];
  const tambah = (x) => { if (x) baris.push(x); };

  if (hasil.voucherSen > 0) {
    baris.push({ label: 'Voucher toko', sen: -hasil.voucherSen });
    baris.push({ label: 'Harga setelah voucher', sen: P });
  }
  tambah(barisTarif('Tarif administrasi', R.admin, b.adminSen, b.adminSen, true));
  tambah(barisTarif('Tarif Gratis Ongkir XTRA', R.gx, b.gratisOngkirXtraSen, persenDari(P, R.gx)));
  tambah(barisTarif('Tarif Promo XTRA', R.px, b.promoXtraSen, persenDari(P, R.px)));
  tambah(barisTarif('Tarif Video XTRA', R.vx, b.videoXtraSen, persenDari(P, R.vx)));
  tambah(barisTarif('Tarif Live XTRA', R.lv, b.liveXtraSen, persenDari(P, R.lv)));
  tambah(barisTarif('Biaya pembayaran', R.pb, b.pembayaranSen, persenDari(P, R.pb)));
  if (b.prosesSen) baris.push({ label: 'Biaya layanan pesanan', sen: b.prosesSen });
  baris.push({ label: 'Total Biaya Shopee', sen: b.totalPlatformSen, gaya: 'tebal' });
  baris.push({ label: 'Premi', sen: hasil.premiSen });
  baris.push({ label: 'PPh 22', sen: hasil.pajakSen });
  if (hasil.iklanSen) baris.push({ label: `Biaya iklan (${formatTarifPpm(R.ads)}%)`, sen: hasil.iklanSen });
  if (hasil.returSen) baris.push({ label: `Cadangan retur (${formatTarifPpm(R.rt)}%)`, sen: hasil.returSen });
  if (hasil.biayaLainSen) baris.push({ label: 'Ongkir ditanggung', sen: hasil.biayaLainSen });
  baris.push({ label: 'Saldo masuk toko', sen: hasil.penerimaanSen, gaya: 'tebal' });
  baris.push({ label: 'Modal + Management Partner + packing', sen: hasil.modalSen });
  baris.push({
    label: hasil.untungSen < 0 ? 'Rugi bersih' : 'Untung bersih',
    sen: hasil.untungSen,
    gaya: hasil.untungSen >= targetSen ? 'ok' : 'bad',
  });
  baris.push({ label: 'Margin (dari harga jual)', persenPpm: hasil.marginPpm, teks: `${formatPersenPpm(hasil.marginPpm)}%` });
  if (impasSen !== null) baris.push({ label: 'Harga impas (harga diskon coret)', sen: impasSen });
  return baris;
}

/* ---------------------------------------------------------------
   Pesan peringatan (setara WN()/warns() di v5.82)
   balik = true untuk hasil cek harga pesaing (kalimat sedikit berbeda).
---------------------------------------------------------------- */
export function pesanPeringatan(hasil, pengaturanParsial = {}, balik = false) {
  const w = gabungPengaturan(pengaturanParsial).peringatan;
  const pesan = [];
  const ringkas = [];
  for (const kode of hasil.kode ?? []) {
    if (kode === 'rugi') {
      pesan.push(balik ? 'Rugi pada harga ini.' : 'Rugi. Naikkan harga atau target untung.');
      ringkas.push('Rugi');
    } else if (kode === 'nol') {
      pesan.push(balik
        ? 'Impas, tidak ada untung sama sekali.'
        : 'Untung nol. Tidak ada cadangan untuk risiko.');
      ringkas.push('Untung nol');
    } else if (kode === 'tipis') {
      pesan.push(
        `Untung tipis (${formatRupiah(hasil.untungSen)}, margin ${formatPersenPpm(hasil.marginPpm)}%). ` +
        `Batas aman: ${formatRupiah(w.untungMinSen)} dan ${formatPersenPpm(w.marginMinPpm)}%.`
      );
      ringkas.push('Untung tipis');
    } else if (kode === 'potongan') {
      pesan.push(
        `Total potongan tinggi (${formatPersenPpm(hasil.potonganPpm)}% dari harga jual). Periksa tarif yang diisi.`
      );
      ringkas.push('Potongan tinggi');
    }
  }
  return { tingkat: hasil.tingkat ?? '', pesan, ringkas };
}

/* ---------------------------------------------------------------
   Cek harga pesaing (hitung terbalik)
---------------------------------------------------------------- */
export function ringkasPesaing(hasil, impasSen) {
  const selisihSen = impasSen === null || impasSen === undefined ? null : hasil.hargaListingSen - impasSen;
  return { selisihSen };
}

/* ---------------------------------------------------------------
   Riwayat modal. Masukan: [{ lamaSen, baruSen, dicatatPada }] (terbaru dulu)
---------------------------------------------------------------- */
export function barisRiwayat(daftar) {
  return (daftar ?? []).map((r) => {
    const naik = r.baruSen >= r.lamaSen;
    let perubahan = '';
    if (r.lamaSen > 0) {
      const ppm = Math.round(((r.baruSen - r.lamaSen) * 1_000_000) / r.lamaSen);
      perubahan = ` (${naik ? '+' : ''}${formatPersenPpm(ppm)}%)`;
    }
    return {
      naik,
      teks: `${formatTanggalPendek(r.dicatatPada)}: ${formatRupiah(r.lamaSen)} ke ${formatRupiah(r.baruSen)}${perubahan}`,
    };
  });
}
