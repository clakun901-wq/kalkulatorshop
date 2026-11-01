// worker.js — Web Worker kalkulator Kalsara v6 (Fase 3)
//
// Seluruh perhitungan harga berjalan di sini, bukan di utas utama.
// Utas utama cukup mengirim data dan menerima hasil akhir.
//
// Pesan masuk : { id, op, args }
// Pesan keluar: { id, ok: true, hasil } atau { id, ok: false, galat }
//
// Operasi:
//   ping                                       -> { versi }
//   hitung        { produk, pengaturan, tanggal }          -> hasil satu produk
//   hitungBanyak  { daftar, pengaturan, tanggal }          -> { hasil: [...], ms }
//   hitungMaju    { produk, listingSen, pengaturan, tanggal }
//   impas         { produk, pengaturan, tanggal }
//   rincian       { produk, pengaturan, tanggal }   -> baris rincian biaya + harga impas (Fase 6)
//   pesaing       { produk, hargaSen, pengaturan, tanggal } -> hitung terbalik dari harga pesaing (Fase 6)
//   grafik        (ikut dalam hitungBanyak, lihat di bawah)
//
// Catatan: di build satu-file HTML, worker ini digabung dengan calculator.js
// (baris import di bawah dibuang oleh skrip build).

import {
  VERSI_KALKULATOR,
  hitungHarga,
  hitungMaju,
  hargaImpas,
} from './calculator.js';
import { bagianGrafik, barisRincian, pesanPeringatan } from './rincian.js';

const OPERASI = {
  ping() {
    return { versi: VERSI_KALKULATOR };
  },

  hitung({ produk, pengaturan, tanggal }) {
    return hitungHarga(produk, pengaturan, tanggal);
  },

  hitungBanyak({ daftar, pengaturan, tanggal }) {
    if (!Array.isArray(daftar)) throw new Error('daftar harus berupa array produk.');
    const mulai = performance.now();
    // Satu produk yang salah tidak menggagalkan yang lain: galatnya ikut dikembalikan.
    const hasil = daftar.map((produk) => {
      const h = hitungHarga(produk, pengaturan, tanggal);
      if (h.ok) h.grafik = bagianGrafik(h);
      return h;
    });
    return { hasil, ms: performance.now() - mulai };
  },

  hitungMaju({ produk, listingSen, pengaturan, tanggal }) {
    return hitungMaju(produk, listingSen, pengaturan, tanggal);
  },

  impas({ produk, pengaturan, tanggal }) {
    return hargaImpas(produk, pengaturan, tanggal);
  },

  // Rincian lengkap satu produk (dipanggil saat pengguna membuka "Lihat rincian biaya").
  rincian({ produk, pengaturan, tanggal }) {
    const hasil = hitungHarga(produk, pengaturan, tanggal);
    if (!hasil.ok) return hasil;
    const impas = hargaImpas(produk, pengaturan, tanggal);
    const impasSen = impas.ok ? impas.hargaListingSen : null;
    return {
      ok: true,
      baris: barisRincian(hasil, { impasSen, targetSen: produk.targetUntungSen ?? 0 }),
      impasSen,
    };
  },

  // Hitung terbalik: dengan harga diskon coret `hargaSen` (mis. harga pesaing), berapa untungnya?
  pesaing({ produk, hargaSen, pengaturan, tanggal }) {
    const hasil = hitungMaju(produk, hargaSen, pengaturan, tanggal);
    if (!hasil.ok) return hasil;
    const impas = hargaImpas(produk, pengaturan, tanggal);
    const impasSen = impas.ok ? impas.hargaListingSen : null;
    return {
      ok: true,
      hargaSen: hasil.hargaListingSen,
      baris: barisRincian(hasil, { targetSen: 0 }),
      peringatan: pesanPeringatan(hasil, pengaturan, true),
      untungSen: hasil.untungSen,
      marginPpm: hasil.marginPpm,
      impasSen,
      selisihImpasSen: impasSen === null ? null : hasil.hargaListingSen - impasSen,
    };
  },
};

self.addEventListener('message', ({ data }) => {
  const { id, op, args } = data ?? {};
  try {
    const fn = OPERASI[op];
    if (!fn) throw new Error(`Operasi tidak dikenal: ${op}`);
    self.postMessage({ id, ok: true, hasil: fn(args ?? {}) });
  } catch (e) {
    self.postMessage({ id, ok: false, galat: e?.message ?? String(e) });
  }
});
