// etalase.js — logika murni tab Etalase Kalsara v6 (Fase 7)
//
// Modul MURNI (tanpa DOM, tanpa import selain format.js) supaya bisa diuji di Node.
// Isinya: status stok, kunci gembok stok, dan kalimat konfirmasi penjualan.
// Uang selalu bilangan bulat SEN; pembagian hanya terjadi di format.js saat tampil.

import { formatRupiah } from './format.js';

// Batas stok (pcs). Stok 0 = habis; 1..BATAS_HAMPIR_HABIS = hampir habis (merah);
// sampai BATAS_MENIPIS = menipis (kuning); di atasnya aman. Sama dengan bawaan v5.82.
// Belum ada di Setelan (sengaja, agar tidak menyentuh pengaturan harga); mudah dipindah nanti.
export const BATAS_HAMPIR_HABIS = 5;
export const BATAS_MENIPIS = 10;

// Gembok stok terbuka 10 detik, diperpanjang setiap tombol ditekan (sama dengan v5.82).
export const LAMA_GEMBOK_MS = 10_000;

export function statusStok(stok) {
  if (stok === null || stok === undefined || stok <= 0) return 'habis';
  if (stok <= BATAS_HAMPIR_HABIS) return 'hampir';
  if (stok <= BATAS_MENIPIS) return 'menipis';
  return 'aman';
}

export const LABEL_STATUS = {
  habis: 'Habis',
  hampir: 'Hampir habis',
  menipis: 'Menipis',
  aman: 'Aman',
};

// Produk berstatus habis/hampir/menipis masuk kelompok "Perlu isi ulang".
export const perluIsiUlang = (stok) => statusStok(stok) !== 'aman';

/* ---------------------------------------------------------------
   Gembok stok per produk. Waktu bisa disuntik supaya mudah diuji.
   Gembok hanya hidup di memori: tutup halaman = semua terkunci lagi.
---------------------------------------------------------------- */
export function buatGembok({ lama = LAMA_GEMBOK_MS, sekarang = () => Date.now() } = {}) {
  const sampai = new Map(); // id produk -> waktu (ms) gembok terkunci lagi

  return {
    // Membuka (atau memperpanjang) gembok satu produk.
    buka(id) {
      sampai.set(id, sekarang() + lama);
    },
    // Dipanggil tiap tombol stok ditekan saat terbuka: waktu dimulai lagi dari awal.
    perpanjang(id) {
      if (this.terbuka(id)) sampai.set(id, sekarang() + lama);
    },
    terbuka(id) {
      const batas = sampai.get(id);
      return batas !== undefined && batas > sekarang();
    },
    kunci(id) {
      return sampai.delete(id);
    },
    // Berpindah tab mengunci semuanya kembali.
    kunciSemua() {
      const ada = sampai.size > 0;
      sampai.clear();
      return ada;
    },
    // Buang gembok yang sudah lewat waktu. Mengembalikan true bila ada yang dibuang
    // (artinya tampilan perlu disegarkan).
    bersihkan() {
      const kini = sekarang();
      let berubah = false;
      for (const [id, batas] of sampai) {
        if (batas <= kini) { sampai.delete(id); berubah = true; }
      }
      return berubah;
    },
    get jumlahTerbuka() {
      return sampai.size;
    },
  };
}

/* ---------------------------------------------------------------
   Kalimat penjualan
---------------------------------------------------------------- */
// catatan: { nama, untungSen, stok }
export function teksPenjualan({ nama, untungSen, stok }) {
  const hasil = untungSen < 0
    ? `Rugi ${formatRupiah(-untungSen)}`
    : `Untung ${formatRupiah(untungSen)}`;
  const sisa = stok <= 0 ? 'Stok habis.' : `Sisa stok ${stok} pcs.`;
  return `Terjual 1: ${nama}. ${hasil}. ${sisa}`;
}

// Awal hari (00:00 waktu perangkat) dalam ms, untuk ringkasan "penjualan hari ini".
export function awalHari(sekarang = Date.now()) {
  const d = new Date(sekarang);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Teks stok dari input pengguna -> bilangan bulat >= 0, atau null bila tidak valid.
// Titik hanya diterima sebagai pemisah ribuan yang benar ("1.250", "1.250.000"). Teks seperti
// "1.5" ditolak, bukan dibaca 15: salah ketik tidak boleh diam-diam melipatgandakan stok.
export function bacaStok(teks) {
  const t = String(teks ?? '').trim();
  if (/^\d{1,9}$/.test(t)) return Number(t);
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    const n = Number(t.replace(/\./g, ''));
    return n <= 999_999_999 ? n : null;
  }
  return null;
}
