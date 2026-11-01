// app.js — entry point Kalsara v6 (Fase 7: Etalase)
//
// Menyambungkan:
//   UI (Signals + <product-card> + formulir)
//     <-> db.js -> db.worker.js     (SQLite di OPFS: produk dan pengaturan toko)
//     <-> kalkulator.js -> worker.js (calculator.js: harga jual dan untung)
// Utas utama hanya merender dan mengirim pesan.

import { signal, computed, effect, batch, h, formatRupiah } from './ui.js';
import './kartu-etalase.js';
import { buatGembok, teksPenjualan, awalHari, perluIsiUlang, BATAS_MENIPIS } from './etalase.js';
import { db } from './db.js';
import { kalkulator } from './kalkulator.js';
import { jalankanUjiBeban } from './beban.js';
import { gabungPengaturan, PENGATURAN_BAWAAN } from './calculator.js';
import { pesanPeringatan, barisRiwayat } from './rincian.js';
import {
  teksKeSen,
  SPEK_SETELAN,
  SPEK_PRODUK,
  isianDariPengaturan,
  pengaturanDariIsian,
  isianDariProduk,
  isianProdukKosong,
  produkDariIsian,
} from './isian.js';
import { bangunFormulir } from './form.js';
import { pasangLaporan } from './laporan-ui.js';

const BATAS_HALAMAN = 24;
const JEDA_CARI_MS = 300;

/* ---------------------------------------------------------------
   State
---------------------------------------------------------------- */
const daftarProduk = signal([]); // hanya produk di halaman yang tampil
const halaman = signal(0); // 0-based
const kata = signal('');
const totalCocok = signal(0);
const ringkasan = signal({ jumlah: 0, totalStok: 0, tayang: 0 }); // seluruh database
const statusDb = signal({ tahap: 'memuat' }); // memuat | siap | galat
const pesan = signal({ teks: '', jenis: 'info' });
const sibuk = signal(false);
const hasilBeban = signal(null);
const pengaturan = signal(gabungPengaturan({}));
const pengaturanTersimpan = signal(false);

const jumlahHalaman = computed(() => Math.max(1, Math.ceil(totalCocok.value / BATAS_HALAMAN)));

// Etalase (Fase 7): daftar produk yang tampil, halaman, pencarian, ringkasan penjualan.
const daftarEtalase = signal([]);
const halamanEtalase = signal(0);
const kataEtalase = signal('');
const totalEtalase = signal(0);
const penjualanHariIni = signal({ jumlah: 0, untungSen: 0 });
const penjualanTerakhir = signal(null); // catatan penjualan terakhir (untuk tombol Batalkan)
const jumlahHalamanEtalase = computed(() => Math.max(1, Math.ceil(totalEtalase.value / BATAS_HALAMAN)));

// Gembok stok: hanya hidup di memori. `versiGembok` naik tiap gembok berubah supaya kartu dirender ulang.
const gembok = buatGembok();
const versiGembok = signal(0);
const konteksEtalase = { versiGembok, terbuka: (id) => gembok.terbuka(id) };
const segarkanGembok = () => { versiGembok.value += 1; };

function tanggalHariIni() {
  const d = new Date();
  const dua = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

// Bahan hitung untuk kalkulator (tidak reaktif). Dipakai kartu Hitung dan kartu Etalase.
function dataHitung(baris) {
  return {
    modalSen: baris.modalSen,
    kemitraanSen: baris.kemitraanSen,
    packingSen: baris.packingSen,
    targetUntungSen: baris.targetUntungSen,
    isiPaket: baris.isiPaket,
    override: baris.override,
  };
}

function dariBaris(baris) {
  return {
    tayang: signal(Boolean(baris.tayang)),
    id: baris.id,
    sku: baris.sku,
    nama: baris.nama,
    supplier: baris.supplier ?? '',
    linkSupplier: baris.linkSupplier ?? '',
    baris, // data lengkap untuk formulir ubah
    stok: signal(baris.stok),
    target: signal(baris.targetUntungSen),
    hitung: signal({ tahap: 'menunggu' }),
    rincian: signal(null), // null = belum dibuka
    pesaing: signal(null),
    riwayat: signal(null),
    versiHitung: 0, // untuk membuang hasil hitung yang sudah usang
    versiPesaing: 0,
    antrean: Promise.resolve(), // urutan tulis database (tombol target diketuk cepat)
    data: dataHitung(baris),
  };
}

// Produk di Etalase: lebih ringan dari kartu Hitung (tanpa rincian, pesaing, riwayat).
function dariBarisEtalase(baris) {
  return {
    id: baris.id,
    sku: baris.sku,
    nama: baris.nama,
    stok: signal(baris.stok),
    hitung: signal({ tahap: 'menunggu' }),
    antrean: Promise.resolve(), // urutan tulis database (tombol ditekan cepat)
    data: dataHitung(baris),
  };
}

const PESAN_GALAT = {
  TARIF_100: 'Total tarif (admin, iklan, premi, dan lainnya) mencapai 100%. Periksa persen iklan dan tarif di tab Setelan.',
  VOUCHER_100: 'Voucher toko 100% membuat harga jadi nol. Turunkan nilainya di tab Setelan.',
  DISKON_100: 'Diskon coret 100% atau lebih tidak masuk akal. Turunkan nilainya di tab Setelan.',
  DI_LUAR_BATAS: 'Target untung belum tercapai dalam batas pencarian harga. Periksa target untung, modal, biaya, dan tarif.',
};
const pesanGalat = (r) => PESAN_GALAT[r.kode] ?? r.galat;

// Hasil kalkulator -> bahan kartu. Nada untung: hijau bila mencapai target, merah bila tidak.
function petakanHasil(r, produk) {
  if (!r.ok) return { tahap: 'galat', galat: pesanGalat(r) };
  return {
    tahap: 'ok',
    awalSen: r.hargaCoretSen, // v5.82: "Harga listing awal"
    diskonSen: r.hargaListingSen, // v5.82: "Harga diskon coret"
    untungSen: r.untungSen,
    marginPpm: r.marginPpm,
    nada: r.untungSen >= produk.data.targetUntungSen ? 'ok' : 'bad',
    peringatan: pesanPeringatan(r, pengaturan.peek(), false),
    grafik: r.grafik ?? null,
  };
}

/* ---------------------------------------------------------------
   Elemen halaman
---------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const wadah = $('daftar');
const elRingkas = $('ringkas');
const elStatus = $('status-db');
const elPeringatan = $('peringatan');
const elPesan = $('pesan');
const elInfoSetelan = $('info-setelan');
const elCari = $('cari');
const elInfoHalaman = $('info-halaman');
const btnSebelumnya = $('btn-sebelumnya');
const btnBerikutnya = $('btn-berikutnya');
const panelBeban = $('panel-beban');
const daftarBeban = $('hasil-beban');
const wadahEtalase = $('daftar-etalase');
const elCariEtalase = $('cari-etalase');
const elRingkasEtalase = $('ringkas-etalase');
const elStrip = $('strip-penjualan');
const elTeksStrip = $('teks-strip');
const elInfoHalamanEtalase = $('info-halaman-etalase');
const btnSebelumnyaEtalase = $('btn-sebelumnya-etalase');
const btnBerikutnyaEtalase = $('btn-berikutnya-etalase');
const tombolAksi = ['btn-tambah', 'btn-acak', 'btn-dummy', 'btn-beban', 'btn-hapus-semua'].map($);

/* ---------------------------------------------------------------
   Tab
---------------------------------------------------------------- */
const TAB = {
  hitung: { tab: $('tab-hitung'), panel: $('panel-hitung') },
  etalase: { tab: $('tab-etalase'), panel: $('panel-etalase') },
  laporan: { tab: $('tab-laporan'), panel: $('panel-laporan') },
  setelan: { tab: $('tab-setelan'), panel: $('panel-setelan') },
};
let tabAktif = 'hitung';

function pilihTab(nama) {
  if (nama === tabAktif) return;
  const dari = tabAktif;
  tabAktif = nama;
  for (const [kunci, { tab, panel }] of Object.entries(TAB)) {
    const aktif = kunci === nama;
    tab.setAttribute('aria-selected', String(aktif));
    tab.tabIndex = aktif ? 0 : -1;
    panel.hidden = !aktif;
  }
  // Meninggalkan Etalase mengunci semua gembok stok kembali.
  if (dari === 'etalase' && gembok.kunciSemua()) segarkanGembok();
  // Data dimuat ulang saat tab dibuka, jadi stok dan harga di dua tab tidak saling usang.
  if (statusDb.peek().tahap === 'siap') {
    const muat = nama === 'etalase' ? muatEtalase : nama === 'hitung' ? muatHalaman : nama === 'laporan' ? laporan.muat : null;
    muat?.().catch((e) => tampilkanPesan(e?.message ?? String(e), 'galat'));
  }
}
for (const [kunci, { tab }] of Object.entries(TAB)) {
  tab.addEventListener('click', () => pilihTab(kunci));
}

/* ---------------------------------------------------------------
   Render (semua lewat effect Signals, tanpa innerHTML)
---------------------------------------------------------------- */
effect(() => {
  const daftar = daftarProduk.value;
  const siap = statusDb.value.tahap === 'siap';

  if (daftar.length > 0) {
    wadah.replaceChildren(...daftar.map((produk) => {
      const kartu = document.createElement('product-card');
      kartu.produk = produk;
      return kartu;
    }));
  } else if (siap) {
    wadah.replaceChildren(h('p', {
      class: 'kosong',
      text: kata.value
        ? 'Tidak ada produk yang cocok dengan pencarian.'
        : 'Belum ada produk. Tekan "Tambah produk" untuk mulai.',
    }));
  } else {
    wadah.replaceChildren();
  }
});

effect(() => {
  const daftar = daftarEtalase.value;
  const siap = statusDb.value.tahap === 'siap';

  if (daftar.length > 0) {
    // Produk yang perlu isi ulang (stok <= batas menipis) berada di depan; sisanya "Stok aman".
    // Stok dibaca dengan peek() supaya daftar tidak dirakit ulang tiap stok berubah.
    const anak = [];
    let kelompok = null;
    for (const item of daftar) {
      const baru = perluIsiUlang(item.stok.peek()) ? 'isi' : 'aman';
      if (baru !== kelompok) {
        kelompok = baru;
        anak.push(h('h2', { class: 'judul-kelompok', text: baru === 'isi' ? 'Perlu isi ulang' : 'Stok aman' }));
      }
      const kartu = document.createElement('etalase-card');
      kartu.konteks = konteksEtalase;
      kartu.item = item;
      anak.push(kartu);
    }
    wadahEtalase.replaceChildren(...anak);
  } else if (siap) {
    wadahEtalase.replaceChildren(h('p', {
      class: 'kosong',
      text: kataEtalase.value
        ? 'Tidak ada produk Etalase yang cocok dengan pencarian.'
        : 'Etalase masih kosong. Di tab Hitung, ketuk "Tampil di Etalase" pada produk yang sudah tayang di Shopee.',
    }));
  } else {
    wadahEtalase.replaceChildren();
  }
});

effect(() => {
  const siap = statusDb.value.tahap === 'siap';
  const nomor = halamanEtalase.value + 1;
  const total = jumlahHalamanEtalase.value;
  elInfoHalamanEtalase.textContent = siap
    ? `Halaman ${nomor} dari ${total} · ${totalEtalase.value.toLocaleString('id-ID')} produk`
    : '';
  btnSebelumnyaEtalase.disabled = !siap || halamanEtalase.value === 0;
  btnBerikutnyaEtalase.disabled = !siap || nomor >= total;
  elCariEtalase.disabled = !siap;
});

effect(() => {
  const { jumlah, untungSen } = penjualanHariIni.value;
  elRingkasEtalase.textContent = jumlah === 0
    ? 'Hari ini belum ada penjualan tercatat.'
    : `Hari ini: ${jumlah.toLocaleString('id-ID')} terjual · ${untungSen < 0 ? 'rugi' : 'untung'} ${formatRupiah(Math.abs(untungSen))}`;
});

effect(() => {
  const c = penjualanTerakhir.value;
  elStrip.hidden = c === null;
  if (c) {
    elTeksStrip.textContent = `Terakhir: ${c.nama}, ${c.untungSen < 0 ? 'rugi' : 'untung'} ${formatRupiah(Math.abs(c.untungSen))}. Salah ketuk?`;
  }
});

effect(() => {
  const s = statusDb.value;
  if (s.tahap === 'memuat') elRingkas.textContent = 'Menyiapkan penyimpanan…';
  else if (s.tahap === 'galat') elRingkas.textContent = 'Penyimpanan belum siap';
  else {
    const r = ringkasan.value;
    elRingkas.textContent =
      `${r.jumlah.toLocaleString('id-ID')} produk · ${r.tayang.toLocaleString('id-ID')} di Etalase · total stok ${r.totalStok.toLocaleString('id-ID')}`;
  }
});

effect(() => {
  const siap = statusDb.value.tahap === 'siap';
  const nomor = halaman.value + 1;
  const total = jumlahHalaman.value;
  elInfoHalaman.textContent = siap
    ? `Halaman ${nomor} dari ${total} · ${totalCocok.value.toLocaleString('id-ID')} produk`
    : '';
  btnSebelumnya.disabled = !siap || halaman.value === 0;
  btnBerikutnya.disabled = !siap || nomor >= total;
  elCari.disabled = !siap;
});

effect(() => {
  const nonaktif = sibuk.value || statusDb.value.tahap !== 'siap';
  for (const t of tombolAksi) t.disabled = nonaktif;
});

effect(() => {
  elInfoSetelan.hidden = pengaturanTersimpan.value || statusDb.value.tahap !== 'siap';
});

effect(() => {
  const s = statusDb.value;
  const peringatan = [];

  if (s.tahap === 'memuat') {
    elStatus.textContent = 'Membuka database…';
  } else if (s.tahap === 'galat') {
    elStatus.textContent = 'Database gagal dibuka';
    peringatan.push(`Database gagal dibuka: ${s.galat}`);
  } else {
    const lokasi = s.mode === 'opfs' ? 'OPFS (tersimpan di perangkat)' : 'Memori (sementara)';
    const persisten = s.mode === 'opfs'
      ? (s.persisten ? 'perlindungan hapus-cache aktif' : 'belum dilindungi dari hapus-cache')
      : null;
    elStatus.textContent = [
      `Penyimpanan: ${lokasi}`,
      `SQLite ${s.versiSqlite}`,
      `skema v${s.versiSkema}`,
      persisten,
    ].filter(Boolean).join(' · ');

    if (s.mode !== 'opfs') {
      peringatan.push(
        'Data TIDAK akan tersimpan setelah halaman ditutup. ' +
        'Pastikan hanya ada satu tab Kalsara yang terbuka dan halaman dibuka lewat http://localhost atau HTTPS, ' +
        `lalu muat ulang. Detail: ${s.alasan}`
      );
    }
  }

  elPeringatan.textContent = peringatan.join(' ');
  elPeringatan.hidden = peringatan.length === 0;
});

effect(() => {
  const { teks, jenis } = pesan.value;
  elPesan.textContent = teks;
  elPesan.dataset.jenis = jenis;
  elPesan.hidden = teks === '';
});

effect(() => {
  const baris = hasilBeban.value;
  panelBeban.hidden = baris === null;
  daftarBeban.replaceChildren(...(baris ?? []).map((teks) => h('li', { text: teks })));
});

let waktuPesan = 0;
function tampilkanPesan(teks, jenis = 'info') {
  pesan.value = { teks, jenis };
  clearTimeout(waktuPesan);
  waktuPesan = setTimeout(() => { pesan.value = { teks: '', jenis }; }, 7000);
}

// Tab Laporan (Fase 8): modul sendiri, hanya membaca tabel penjualan.
const laporan = pasangLaporan({ tampilkanPesan });

function tampilkanGalat(elDaftar, daftar) {
  elDaftar.replaceChildren(...daftar.map((teks) => h('li', { text: teks })));
  elDaftar.hidden = daftar.length === 0;
}

/* ---------------------------------------------------------------
   Memuat data: halaman (database) + harga (worker kalkulator)
---------------------------------------------------------------- */
let nomorPermintaan = 0;
let msRenderTerakhir = 0;

async function hitungHargaHalaman(produk, saya) {
  if (produk.length === 0) return;
  const versi = produk.map((p) => p.versiHitung);
  let hasil;
  try {
    ({ hasil } = await kalkulator.hitungBanyak(produk.map((p) => p.data), pengaturan.peek(), tanggalHariIni()));
  } catch (e) {
    hasil = produk.map(() => ({ ok: false, galat: `Kalkulator gagal: ${e.message}` }));
  }
  if (saya !== nomorPermintaan) return; // pengguna sudah pindah halaman
  batch(() => {
    hasil.forEach((r, i) => {
      if (produk[i].versiHitung !== versi[i]) return; // target diubah saat menghitung: hasil usang
      produk[i].hitung.value = petakanHasil(r, produk[i]);
    });
  });
}

// Hitung ulang satu produk (mis. setelah target untung diubah) dan segarkan rincian bila terbuka.
async function hitungUlangSatu(produk) {
  const versi = ++produk.versiHitung;
  let r;
  try {
    ({ hasil: [r] } = await kalkulator.hitungBanyak([produk.data], pengaturan.peek(), tanggalHariIni()));
  } catch (e) {
    r = { ok: false, galat: `Kalkulator gagal: ${e.message}` };
  }
  if (versi !== produk.versiHitung) return;
  produk.hitung.value = petakanHasil(r, produk);
  if (produk.rincian.peek() !== null) await muatRincian(produk);
}

async function muatRincian(produk) {
  if (produk.rincian.peek() === null) produk.rincian.value = { tahap: 'memuat' };
  const versi = produk.versiHitung;
  try {
    const r = await kalkulator.rincian(produk.data, pengaturan.peek(), tanggalHariIni());
    if (versi !== produk.versiHitung) return;
    produk.rincian.value = r.ok
      ? { tahap: 'ok', baris: r.baris, impasSen: r.impasSen }
      : { tahap: 'galat', galat: pesanGalat(r) };
  } catch (e) {
    produk.rincian.value = { tahap: 'galat', galat: `Kalkulator gagal: ${e.message}` };
  }
}

async function muatHalaman() {
  const saya = ++nomorPermintaan;
  const { baris, total } = await db.halaman({
    kata: kata.peek(),
    batas: BATAS_HALAMAN,
    offset: halaman.peek() * BATAS_HALAMAN,
  });
  if (saya !== nomorPermintaan) return;

  const halamanTerakhir = Math.max(0, Math.ceil(total / BATAS_HALAMAN) - 1);
  if (halaman.peek() > halamanTerakhir) {
    halaman.value = halamanTerakhir;
    return muatHalaman();
  }

  const mulai = performance.now();
  const produk = baris.map(dariBaris);
  batch(() => {
    totalCocok.value = total;
    daftarProduk.value = produk;
  });
  msRenderTerakhir = performance.now() - mulai;

  await hitungHargaHalaman(produk, saya);
}

async function muatRingkasan() {
  ringkasan.value = await db.ringkasan();
}

/* ---------------------------------------------------------------
   Etalase (Fase 7): produk yang tampil, harga dari kalkulator, stok dari database
---------------------------------------------------------------- */
let nomorEtalase = 0;

async function hitungHargaEtalase(items, saya) {
  if (items.length === 0) return;
  let hasil;
  try {
    ({ hasil } = await kalkulator.hitungBanyak(items.map((p) => p.data), pengaturan.peek(), tanggalHariIni()));
  } catch (e) {
    hasil = items.map(() => ({ ok: false, galat: `Kalkulator gagal: ${e.message}` }));
  }
  if (saya !== nomorEtalase) return;
  batch(() => {
    hasil.forEach((r, i) => { items[i].hitung.value = petakanHasil(r, items[i]); });
  });
}

async function muatPenjualanHariIni() {
  penjualanHariIni.value = await db.ringkasanPenjualan(awalHari());
}

async function muatEtalase() {
  const saya = ++nomorEtalase;
  const { baris, total } = await db.halaman({
    kata: kataEtalase.peek(),
    batas: BATAS_HALAMAN,
    offset: halamanEtalase.peek() * BATAS_HALAMAN,
    tayang: true,
    urut: 'etalase',
    batasMenipis: BATAS_MENIPIS,
  });
  if (saya !== nomorEtalase) return;

  const halamanTerakhir = Math.max(0, Math.ceil(total / BATAS_HALAMAN) - 1);
  if (halamanEtalase.peek() > halamanTerakhir) {
    halamanEtalase.value = halamanTerakhir;
    return muatEtalase();
  }

  const items = baris.map(dariBarisEtalase);
  batch(() => {
    totalEtalase.value = total;
    daftarEtalase.value = items;
  });
  await Promise.all([hitungHargaEtalase(items, saya), muatPenjualanHariIni()]);
}

async function muatSemua() {
  await Promise.all([muatRingkasan(), muatHalaman()]);
}

async function jalankan(aksi) {
  sibuk.value = true;
  try {
    await aksi();
  } catch (e) {
    tampilkanPesan(e?.message ?? String(e), 'galat');
  } finally {
    sibuk.value = false;
  }
}

/* ---------------------------------------------------------------
   Daftar produk: stok, halaman, pencarian
---------------------------------------------------------------- */
wadah.addEventListener('stok-ubah', async (e) => {
  const { id, selisih } = e.detail;
  try {
    const produk = daftarProduk.peek().find((p) => p.id === id);
    if (!produk) return;
    produk.stok.value = await db.ubahStok(id, selisih);
    await muatRingkasan();
  } catch (err) {
    tampilkanPesan(err?.message ?? String(err), 'galat');
  }
});

/* ---------------------------------------------------------------
   Kartu produk (Fase 6): target untung, rincian, cek pesaing, riwayat modal
---------------------------------------------------------------- */
const TARGET_MAKS_SEN = 100_000_000_000; // Rp 1 miliar

const cariProduk = (id) => daftarProduk.peek().find((p) => p.id === id);

wadah.addEventListener('target-ubah', (e) => {
  const produk = cariProduk(e.detail.id);
  if (!produk) return;
  const lama = produk.target.peek();
  const baru = e.detail.reset ? 0 : lama + (e.detail.tambahSen ?? 0);
  if (!Number.isSafeInteger(baru) || baru < 0 || baru > TARGET_MAKS_SEN) {
    tampilkanPesan('Target untung di luar batas yang wajar.', 'galat');
    return;
  }
  if (baru === lama) return;

  // Tampilan langsung berubah; penulisan database diurutkan agar ketukan cepat tidak saling timpa.
  produk.target.value = baru;
  produk.data.targetUntungSen = baru;
  produk.antrean = produk.antrean.then(async () => {
    try {
      await db.ubahTarget(produk.id, baru);
      produk.baris.targetUntungSen = baru;
    } catch (err) {
      tampilkanPesan(err?.message ?? String(err), 'galat');
      const tersimpan = produk.baris.targetUntungSen;
      produk.target.value = tersimpan;
      produk.data.targetUntungSen = tersimpan;
    }
    await hitungUlangSatu(produk);
  });
});

wadah.addEventListener('rincian-buka', (e) => {
  const produk = cariProduk(e.detail.id);
  if (produk) muatRincian(produk);
});

wadah.addEventListener('pesaing-hitung', async (e) => {
  const produk = cariProduk(e.detail.id);
  if (!produk) return;
  const versi = ++produk.versiPesaing; // buang hasil lama bila pengguna masih mengetik
  const teks = String(e.detail.teks ?? '').trim();
  if (teks === '') { produk.pesaing.value = null; return; }

  const harga = teksKeSen(teks);
  if (!harga.ok || harga.nilai <= 0) {
    produk.pesaing.value = { tahap: 'galat', galat: 'Isi harga dengan angka rupiah lebih dari 0, contoh 89900.' };
    return;
  }
  let hasil;
  try {
    const r = await kalkulator.pesaing(produk.data, harga.nilai, pengaturan.peek(), tanggalHariIni());
    hasil = r.ok ? { tahap: 'ok', ...r } : { tahap: 'galat', galat: pesanGalat(r) };
  } catch (err) {
    hasil = { tahap: 'galat', galat: `Kalkulator gagal: ${err.message}` };
  }
  if (versi === produk.versiPesaing) produk.pesaing.value = hasil;
});

wadah.addEventListener('riwayat-buka', async (e) => {
  const produk = cariProduk(e.detail.id);
  if (!produk) return;
  try {
    produk.riwayat.value = barisRiwayat(await db.riwayatModal(produk.id));
  } catch (err) {
    tampilkanPesan(err?.message ?? String(err), 'galat');
  }
});

/* ---------------------------------------------------------------
   Tab Hitung: tampil / lepas dari Etalase
---------------------------------------------------------------- */
wadah.addEventListener('tayang-ubah', async (e) => {
  const produk = cariProduk(e.detail.id);
  if (!produk) return;
  const baru = !produk.tayang.peek();
  try {
    const tersimpan = await db.ubahTayang(produk.id, baru);
    produk.tayang.value = tersimpan;
    produk.baris.tayang = tersimpan ? 1 : 0;
    await muatRingkasan();
    tampilkanPesan(tersimpan ? 'Produk tampil di tab Etalase.' : 'Produk dilepas dari tab Etalase.');
  } catch (err) {
    tampilkanPesan(err?.message ?? String(err), 'galat');
  }
});

/* ---------------------------------------------------------------
   Tab Etalase: gembok, penjualan, stok
---------------------------------------------------------------- */
const cariItemEtalase = (id) => daftarEtalase.peek().find((p) => p.id === id);

let penjagaGembok = 0;
function jagaGembok() {
  if (penjagaGembok || gembok.jumlahTerbuka === 0) return;
  penjagaGembok = setInterval(() => {
    if (gembok.bersihkan()) segarkanGembok();
    if (gembok.jumlahTerbuka === 0) { clearInterval(penjagaGembok); penjagaGembok = 0; }
  }, 500);
}

// Gembok adalah sumber kebenaran tunggal: kartu hanya melapor, di sini dicek ulang.
// Mengembalikan true bila terbuka; sekaligus memperpanjang waktunya.
function gembokTerbukaUntuk(id) {
  if (!gembok.terbuka(id)) {
    tampilkanPesan('Terkunci. Ketuk ikon gembok dulu.');
    return false;
  }
  gembok.perpanjang(id);
  segarkanGembok();
  return true;
}

wadahEtalase.addEventListener('gembok-ketuk', (e) => {
  const { id, dariKolom } = e.detail;
  if (dariKolom) { tampilkanPesan('Terkunci. Ketuk ikon gembok dulu.'); return; }
  if (gembok.terbuka(id)) {
    gembok.kunci(id);
  } else {
    gembok.buka(id);
    jagaGembok();
    tampilkanPesan('Stok terbuka 10 detik.');
  }
  segarkanGembok();
});

wadahEtalase.addEventListener('penjualan-catat', (e) => {
  const item = cariItemEtalase(e.detail.id);
  if (!item || !gembokTerbukaUntuk(item.id)) return;

  const harga = item.hitung.peek();
  if (harga.tahap !== 'ok') {
    tampilkanPesan('Harga produk ini belum bisa dihitung, jadi penjualan tidak dicatat dan stok tidak berubah. Lengkapi modal di tab Hitung.', 'galat');
    return;
  }
  if (item.stok.peek() <= 0) {
    tampilkanPesan('Stok sudah 0, penjualan tidak dicatat. Isi stok dulu bila ada stok baru.', 'galat');
    return;
  }
  // Stok dan penjualan ditulis dalam satu transaksi di database. Ketukan cepat diantre berurutan.
  item.antrean = item.antrean.then(async () => {
    try {
      const catatan = await db.catatPenjualan(item.id, harga.diskonSen, harga.untungSen);
      item.stok.value = catatan.stok;
      penjualanTerakhir.value = catatan;
      tampilkanPesan(teksPenjualan(catatan));
      await Promise.all([muatRingkasan(), muatPenjualanHariIni()]);
    } catch (err) {
      tampilkanPesan(err?.message ?? String(err), 'galat');
      muatEtalase().catch(() => {}); // samakan tampilan dengan database
    }
  });
});

wadahEtalase.addEventListener('stok-tambah', (e) => {
  const item = cariItemEtalase(e.detail.id);
  if (!item || !gembokTerbukaUntuk(item.id)) return;
  item.antrean = item.antrean.then(async () => {
    try {
      item.stok.value = await db.ubahStok(item.id, 1);
      await muatRingkasan();
    } catch (err) {
      tampilkanPesan(err?.message ?? String(err), 'galat');
    }
  });
});

wadahEtalase.addEventListener('stok-atur', (e) => {
  const item = cariItemEtalase(e.detail.id);
  if (!item) return;
  if (!gembokTerbukaUntuk(item.id)) { item.stok.value = item.stok.peek(); return; }
  const stok = e.detail.stok;
  item.antrean = item.antrean.then(async () => {
    try {
      await db.ubahStokMassal([{ id: item.id, stok }]);
      item.stok.value = stok;
      await muatRingkasan();
    } catch (err) {
      tampilkanPesan(err?.message ?? String(err), 'galat');
    }
  });
});

wadahEtalase.addEventListener('stok-tidak-valid', () => {
  tampilkanPesan('Isi stok dengan bilangan bulat 0 atau lebih, contoh 25.', 'galat');
});

wadahEtalase.addEventListener('buka-di-hitung', (e) => {
  elCari.value = e.detail.sku;
  kata.value = e.detail.sku;
  halaman.value = 0;
  pilihTab('hitung'); // memuat ulang halaman Hitung dengan pencarian SKU ini
});

// Tombol "Batalkan": hapus catatan penjualan terakhir dan kembalikan stok 1.
let waktuStrip = 0;
effect(() => {
  const c = penjualanTerakhir.value;
  clearTimeout(waktuStrip);
  if (c) waktuStrip = setTimeout(() => { penjualanTerakhir.value = null; }, 30_000);
});

$('btn-batal-jual').addEventListener('click', async () => {
  const c = penjualanTerakhir.peek();
  if (!c) return;
  penjualanTerakhir.value = null; // cegah dobel ketuk
  try {
    const { stok } = await db.batalkanPenjualan(c.id);
    const item = stok === null ? null : cariItemEtalase(c.produkId);
    if (item) item.stok.value = stok;
    tampilkanPesan('Penjualan dibatalkan. Stok dikembalikan 1 pcs.');
    await Promise.all([muatRingkasan(), muatPenjualanHariIni()]);
  } catch (err) {
    tampilkanPesan(err?.message ?? String(err), 'galat');
  }
});

btnSebelumnyaEtalase.addEventListener('click', () => {
  if (halamanEtalase.peek() > 0) {
    halamanEtalase.value -= 1;
    muatEtalase().catch((err) => tampilkanPesan(err.message, 'galat'));
  }
});

btnBerikutnyaEtalase.addEventListener('click', () => {
  if (halamanEtalase.peek() + 1 < jumlahHalamanEtalase.peek()) {
    halamanEtalase.value += 1;
    muatEtalase().catch((err) => tampilkanPesan(err.message, 'galat'));
  }
});

let waktuCariEtalase = 0;
elCariEtalase.addEventListener('input', () => {
  clearTimeout(waktuCariEtalase);
  waktuCariEtalase = setTimeout(() => {
    kataEtalase.value = elCariEtalase.value;
    halamanEtalase.value = 0;
    muatEtalase().catch((err) => tampilkanPesan(err.message, 'galat'));
  }, JEDA_CARI_MS);
});

btnSebelumnya.addEventListener('click', () => {
  if (halaman.peek() > 0) {
    halaman.value -= 1;
    jalankan(muatHalaman);
  }
});

btnBerikutnya.addEventListener('click', () => {
  if (halaman.peek() + 1 < jumlahHalaman.peek()) {
    halaman.value += 1;
    jalankan(muatHalaman);
  }
});

let waktuCari = 0;
elCari.addEventListener('input', () => {
  clearTimeout(waktuCari);
  waktuCari = setTimeout(() => {
    kata.value = elCari.value;
    halaman.value = 0;
    muatHalaman().catch((e) => tampilkanPesan(e.message, 'galat'));
  }, JEDA_CARI_MS);
});

/* ---------------------------------------------------------------
   Dialog produk (tambah / ubah / hapus)
---------------------------------------------------------------- */
const dlgProduk = $('dlg-produk');
const formProduk = bangunFormulir(SPEK_PRODUK, 'p');
$('isi-form-produk').append(formProduk.akar);
const elGalatProduk = $('galat-produk');
const btnSimpanProduk = $('btn-simpan-produk');
const btnHapusProduk = $('btn-hapus-produk');
let idDiubah = null; // null = produk baru

function bukaFormProduk(baris) {
  idDiubah = baris ? baris.id : null;
  $('judul-produk').textContent = baris ? 'Ubah produk' : 'Tambah produk';
  formProduk.isi(baris ? isianDariProduk(baris) : isianProdukKosong());
  btnHapusProduk.hidden = !baris;
  tampilkanGalat(elGalatProduk, []);
  dlgProduk.showModal();
}

$('btn-tambah').addEventListener('click', () => bukaFormProduk(null));

wadah.addEventListener('produk-ubah', (e) => {
  const produk = daftarProduk.peek().find((p) => p.id === e.detail.id);
  if (produk) bukaFormProduk(produk.baris);
});

$('btn-batal-produk').addEventListener('click', () => dlgProduk.close());

$('form-produk').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = produkDariIsian(formProduk.ambil());
  if (!r.ok) { tampilkanGalat(elGalatProduk, r.galat); return; }
  tampilkanGalat(elGalatProduk, []);

  btnSimpanProduk.disabled = true;
  const produkBaru = idDiubah === null;
  let pesanBerhasil;
  try {
    if (produkBaru) {
      const baru = await db.tambah(r.produk);
      pesanBerhasil = `Produk ditambahkan: ${baru.sku}.`;
    } else {
      await db.ubahProduk({ id: idDiubah, ...r.produk });
      pesanBerhasil = 'Perubahan produk disimpan.';
    }
  } catch (err) {
    // Gagal menyimpan (mis. SKU kembar): dialog tetap terbuka agar isian tidak hilang.
    tampilkanGalat(elGalatProduk, [err?.message ?? String(err)]);
    btnSimpanProduk.disabled = false;
    return;
  }
  btnSimpanProduk.disabled = false;
  dlgProduk.close();
  tampilkanPesan(pesanBerhasil);

  try {
    if (produkBaru) {
      elCari.value = '';
      kata.value = '';
      await muatRingkasan();
      halaman.value = Math.max(0, Math.ceil(ringkasan.peek().jumlah / BATAS_HALAMAN) - 1);
      await muatHalaman();
    } else {
      await muatSemua();
    }
  } catch (err) {
    tampilkanPesan(err?.message ?? String(err), 'galat');
  }
});

btnHapusProduk.addEventListener('click', async () => {
  if (idDiubah === null || !confirm('Hapus produk ini dari database?')) return;
  try {
    await db.hapus(idDiubah);
  } catch (err) {
    tampilkanGalat(elGalatProduk, [err?.message ?? String(err)]);
    return;
  }
  dlgProduk.close();
  tampilkanPesan('Produk dihapus.');
  try {
    await muatSemua();
  } catch (err) {
    tampilkanPesan(err?.message ?? String(err), 'galat');
  }
});

/* ---------------------------------------------------------------
   Setelan toko
---------------------------------------------------------------- */
const formSetelan = bangunFormulir(SPEK_SETELAN, 's');
$('isi-form-setelan').append(formSetelan.akar);
const elGalatSetelan = $('galat-setelan');

$('form-setelan').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = pengaturanDariIsian(formSetelan.ambil(), pengaturan.peek());
  if (!r.ok) { tampilkanGalat(elGalatSetelan, r.galat); return; }
  tampilkanGalat(elGalatSetelan, []);

  await jalankan(async () => {
    await db.simpanPengaturan(r.pengaturan);
    batch(() => {
      pengaturan.value = gabungPengaturan(r.pengaturan);
      pengaturanTersimpan.value = true;
    });
    await muatHalaman(); // hitung ulang harga dengan pengaturan baru
    tampilkanPesan('Pengaturan toko disimpan. Harga dihitung ulang.');
  });
});

$('btn-reset-setelan').addEventListener('click', () => {
  formSetelan.isi(isianDariPengaturan(PENGATURAN_BAWAAN));
  tampilkanGalat(elGalatSetelan, []);
  tampilkanPesan('Nilai bawaan dimuat di formulir. Tekan "Simpan pengaturan" untuk memakainya.');
});

/* ---------------------------------------------------------------
   Alat uji (di Setelan)
---------------------------------------------------------------- */
$('btn-acak').addEventListener('click', () => {
  jalankan(async () => {
    const perubahan = daftarProduk.peek().map((p) => ({ id: p.id, stok: Math.floor(Math.random() * 40) }));
    if (perubahan.length === 0) return;
    await db.ubahStokMassal(perubahan);
    const peta = new Map(perubahan.map((x) => [x.id, x.stok]));
    batch(() => {
      for (const p of daftarProduk.peek()) p.stok.value = peta.get(p.id);
    });
    await muatRingkasan();
  });
});

$('btn-dummy').addEventListener('click', () => {
  jalankan(async () => {
    const r = await db.suntikDummy(1000);
    await muatSemua();
    tampilkanPesan(
      r.ditambah > 0
        ? `${r.ditambah} data dummy ditambahkan dalam ${r.ms.toFixed(0)} ms. Total ${r.total} produk.`
        : `Data dummy sudah lengkap. Total ${r.total} produk.`
    );
  });
});

$('btn-hapus-semua').addEventListener('click', () => {
  if (!confirm('Hapus semua produk dari database di perangkat ini?')) return;
  jalankan(async () => {
    await db.kosongkan();
    elCari.value = '';
    kata.value = '';
    halaman.value = 0;
    elCariEtalase.value = '';
    kataEtalase.value = '';
    halamanEtalase.value = 0;
    gembok.kunciSemua();
    segarkanGembok();
    batch(() => {
      daftarEtalase.value = [];
      totalEtalase.value = 0;
      penjualanTerakhir.value = null;
      penjualanHariIni.value = { jumlah: 0, untungSen: 0 };
    });
    hasilBeban.value = null;
    await muatSemua();
  });
});

$('btn-beban').addEventListener('click', () => {
  jalankan(async () => {
    const baris = [];
    hasilBeban.value = ['Menjalankan uji beban…'];
    try {
      await jalankanUjiBeban({
        db,
        kalkulator,
        pengaturan: pengaturan.peek(),
        tanggal: tanggalHariIni(),
        renderHalaman: async () => {
          await muatHalaman();
          return msRenderTerakhir;
        },
        lapor: (teks) => {
          baris.push(teks);
          hasilBeban.value = [...baris];
        },
      });
    } finally {
      await muatSemua();
    }
  });
});

/* ---------------------------------------------------------------
   Mulai
---------------------------------------------------------------- */
async function mulai() {
  try {
    const info = await db.init();
    const tersimpan = await db.ambilPengaturan();
    batch(() => {
      if (tersimpan) {
        pengaturan.value = gabungPengaturan(tersimpan);
        pengaturanTersimpan.value = true;
      }
      statusDb.value = { tahap: 'siap', ...info };
    });
    formSetelan.isi(isianDariPengaturan(pengaturan.peek()));
    await muatSemua();
  } catch (e) {
    statusDb.value = { tahap: 'galat', galat: e?.message ?? String(e) };
  }
}

mulai();
