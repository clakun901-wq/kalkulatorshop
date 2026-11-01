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
//
// Catatan: di build satu-file HTML, worker ini digabung dengan calculator.js
// (baris import di bawah dibuang oleh skrip build).

import {
  VERSI_KALKULATOR,
  hitungHarga,
  hitungMaju,
  hargaImpas,
} from './calculator.js';

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
    const hasil = daftar.map((produk) => hitungHarga(produk, pengaturan, tanggal));
    return { hasil, ms: performance.now() - mulai };
  },

  hitungMaju({ produk, listingSen, pengaturan, tanggal }) {
    return hitungMaju(produk, listingSen, pengaturan, tanggal);
  },

  impas({ produk, pengaturan, tanggal }) {
    return hargaImpas(produk, pengaturan, tanggal);
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
