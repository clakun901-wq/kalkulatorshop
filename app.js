// app.js — entry point Kalsara v6 (Fase 5: Setelan toko + Hitung)
//
// Menyambungkan:
//   UI (Signals + <product-card> + formulir)
//     <-> db.js -> db.worker.js     (SQLite di OPFS: produk dan pengaturan toko)
//     <-> kalkulator.js -> worker.js (calculator.js: harga jual dan untung)
// Utas utama hanya merender dan mengirim pesan.

import { signal, computed, effect, batch, h } from './ui.js';
import { db } from './db.js';
import { kalkulator } from './kalkulator.js';
import { jalankanUjiBeban } from './beban.js';
import { gabungPengaturan, PENGATURAN_BAWAAN } from './calculator.js';
import {
  SPEK_SETELAN,
  SPEK_PRODUK,
  isianDariPengaturan,
  pengaturanDariIsian,
  isianDariProduk,
  isianProdukKosong,
  produkDariIsian,
} from './isian.js';
import { bangunFormulir } from './form.js';

const BATAS_HALAMAN = 24;
const JEDA_CARI_MS = 300;

/* ---------------------------------------------------------------
   State
---------------------------------------------------------------- */
const daftarProduk = signal([]); // hanya produk di halaman yang tampil
const halaman = signal(0); // 0-based
const kata = signal('');
const totalCocok = signal(0);
const ringkasan = signal({ jumlah: 0, totalStok: 0 }); // seluruh database
const statusDb = signal({ tahap: 'memuat' }); // memuat | siap | galat
const pesan = signal({ teks: '', jenis: 'info' });
const sibuk = signal(false);
const hasilBeban = signal(null);
const pengaturan = signal(gabungPengaturan({}));
const pengaturanTersimpan = signal(false);

const jumlahHalaman = computed(() => Math.max(1, Math.ceil(totalCocok.value / BATAS_HALAMAN)));

function tanggalHariIni() {
  const d = new Date();
  const dua = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

function dariBaris(baris) {
  return {
    id: baris.id,
    sku: baris.sku,
    nama: baris.nama,
    baris, // data lengkap untuk formulir ubah
    stok: signal(baris.stok),
    hitung: signal({ tahap: 'menunggu' }),
    // Bahan hitung untuk kalkulator (tidak reaktif).
    data: {
      modalSen: baris.modalSen,
      kemitraanSen: baris.kemitraanSen,
      packingSen: baris.packingSen,
      targetUntungSen: baris.targetUntungSen,
      isiPaket: baris.isiPaket,
      override: baris.override,
    },
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
const tombolAksi = ['btn-tambah', 'btn-acak', 'btn-dummy', 'btn-beban', 'btn-hapus-semua'].map($);

/* ---------------------------------------------------------------
   Tab
---------------------------------------------------------------- */
const TAB = {
  hitung: { tab: $('tab-hitung'), panel: $('panel-hitung') },
  setelan: { tab: $('tab-setelan'), panel: $('panel-setelan') },
};

function pilihTab(nama) {
  for (const [kunci, { tab, panel }] of Object.entries(TAB)) {
    const aktif = kunci === nama;
    tab.setAttribute('aria-selected', String(aktif));
    tab.tabIndex = aktif ? 0 : -1;
    panel.hidden = !aktif;
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
  const s = statusDb.value;
  if (s.tahap === 'memuat') elRingkas.textContent = 'Menyiapkan penyimpanan…';
  else if (s.tahap === 'galat') elRingkas.textContent = 'Penyimpanan belum siap';
  else {
    const r = ringkasan.value;
    elRingkas.textContent = `${r.jumlah.toLocaleString('id-ID')} produk · total stok ${r.totalStok.toLocaleString('id-ID')}`;
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
  let hasil;
  try {
    ({ hasil } = await kalkulator.hitungBanyak(produk.map((p) => p.data), pengaturan.peek(), tanggalHariIni()));
  } catch (e) {
    hasil = produk.map(() => ({ ok: false, galat: `Kalkulator gagal: ${e.message}` }));
  }
  if (saya !== nomorPermintaan) return; // pengguna sudah pindah halaman
  batch(() => {
    hasil.forEach((r, i) => {
      produk[i].hitung.value = r.ok
        ? { tahap: 'ok', hargaSen: r.hargaListingSen, coretSen: r.hargaCoretSen, untungSen: r.untungSen }
        : { tahap: 'galat', galat: r.galat };
    });
  });
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
