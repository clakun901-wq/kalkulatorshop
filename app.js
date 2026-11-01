// app.js — entry point Kalsara v6 (Fase 4)
//
// Menyambungkan tiga lapisan:
//   UI (Signals + <product-card>)  <->  db.js -> db.worker.js (SQLite di OPFS)
//                                  <->  kalkulator.js -> worker.js (calculator.js)
// Utas utama hanya merender dan mengirim pesan; baca/tulis database, pencarian,
// dan perhitungan harga semuanya berjalan di worker.

import { signal, computed, effect, batch, h } from './ui.js';
import { db } from './db.js';
import { kalkulator } from './kalkulator.js';
import { jalankanUjiBeban } from './beban.js';

const BATAS_HALAMAN = 24;
const JEDA_CARI_MS = 300;

// Pengaturan tarif toko. Tab Setelan/Tarif belum ada, jadi memakai nilai bawaan kalkulator.
const PENGATURAN_TOKO = {};

const sen = (rupiah) => rupiah * 100;

const PRODUK_AWAL = [
  { sku: 'KLS-001', nama: 'Vacuum sealer portabel', modalSen: sen(45000), packingSen: sen(1000), targetUntungSen: sen(10000), stok: 12 },
  { sku: 'KLS-002', nama: 'Plastik vacuum embossed 20x30 (isi 50)', modalSen: sen(18000), packingSen: sen(500), targetUntungSen: sen(5000), stok: 4 },
  { sku: 'KLS-003', nama: 'Botol minum stainless 750 ml', modalSen: sen(32000), packingSen: sen(1000), targetUntungSen: sen(8000), stok: 0 },
];

/* ---------------------------------------------------------------
   State
---------------------------------------------------------------- */
const daftarProduk = signal([]); // hanya produk di halaman yang tampil
const halaman = signal(0); // 0-based
const kata = signal('');
const totalCocok = signal(0); // jumlah produk yang cocok dengan pencarian
const ringkasan = signal({ jumlah: 0, totalStok: 0 }); // seluruh database
const statusDb = signal({ tahap: 'memuat' }); // memuat | siap | galat
const pesan = signal({ teks: '', jenis: 'info' });
const sibuk = signal(false);
const hasilBeban = signal(null); // null = panel tersembunyi, array = baris laporan

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
    stok: signal(baris.stok),
    hitung: signal({ tahap: 'menunggu' }),
    // Bahan hitung untuk kalkulator (tidak reaktif).
    data: {
      modalSen: baris.modalSen,
      kemitraanSen: baris.kemitraanSen,
      packingSen: baris.packingSen,
      targetUntungSen: baris.targetUntungSen,
      isiPaket: baris.isiPaket,
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
const elCari = $('cari');
const elInfoHalaman = $('info-halaman');
const btnSebelumnya = $('btn-sebelumnya');
const btnBerikutnya = $('btn-berikutnya');
const panelBeban = $('panel-beban');
const daftarBeban = $('hasil-beban');
const tombolAksi = ['btn-tambah', 'btn-acak', 'btn-dummy', 'btn-beban', 'btn-hapus-semua'].map($);

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
        : 'Belum ada produk. Tekan "Isi 1.000 data dummy" untuk mencoba.',
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

/* ---------------------------------------------------------------
   Memuat data: halaman (dari database) + harga (dari worker kalkulator)
---------------------------------------------------------------- */
let nomorPermintaan = 0;
let msRenderTerakhir = 0;

async function hitungHarga(produk, saya) {
  if (produk.length === 0) return;
  let hasil;
  try {
    ({ hasil } = await kalkulator.hitungBanyak(produk.map((p) => p.data), PENGATURAN_TOKO, tanggalHariIni()));
  } catch (e) {
    hasil = produk.map(() => ({ ok: false, galat: `Kalkulator gagal: ${e.message}` }));
  }
  if (saya !== nomorPermintaan) return; // pengguna sudah pindah halaman
  batch(() => {
    hasil.forEach((r, i) => {
      produk[i].hitung.value = r.ok
        ? { tahap: 'ok', hargaSen: r.hargaListingSen, untungSen: r.untungSen }
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

  await hitungHarga(produk, saya);
}

async function muatRingkasan() {
  ringkasan.value = await db.ringkasan();
}

async function muatSemua() {
  await Promise.all([muatRingkasan(), muatHalaman()]);
}

/* ---------------------------------------------------------------
   Aksi
---------------------------------------------------------------- */
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

$('btn-sebelumnya').addEventListener('click', () => {
  if (halaman.peek() > 0) {
    halaman.value -= 1;
    jalankan(muatHalaman);
  }
});

$('btn-berikutnya').addEventListener('click', () => {
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

$('btn-tambah').addEventListener('click', () => {
  jalankan(async () => {
    let nomor = ringkasan.peek().jumlah + 1;
    let dibuat = null;
    for (let percobaan = 0; percobaan < 50 && !dibuat; percobaan++) {
      try {
        dibuat = await db.tambah({
          sku: `KLS-${String(nomor).padStart(3, '0')}`,
          nama: `Produk contoh ${nomor}`,
          modalSen: sen(8000 + (nomor % 9) * 4000),
          packingSen: sen(500),
          targetUntungSen: sen(5000),
          stok: 10,
        });
      } catch (e) {
        if (!/SKU sudah dipakai/.test(e.message)) throw e;
        nomor += 1;
      }
    }
    if (!dibuat) throw new Error('Gagal membuat SKU unik.');

    elCari.value = '';
    kata.value = '';
    await muatRingkasan();
    halaman.value = Math.max(0, Math.ceil(ringkasan.peek().jumlah / BATAS_HALAMAN) - 1);
    await muatHalaman();
    tampilkanPesan(`Ditambahkan: ${dibuat.sku}.`);
  });
});

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
        pengaturan: PENGATURAN_TOKO,
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
    const ring = await db.ringkasan();
    if (ring.jumlah === 0) await db.tambahBanyak(PRODUK_AWAL);

    statusDb.value = { tahap: 'siap', ...info };
    await muatSemua();
  } catch (e) {
    statusDb.value = { tahap: 'galat', galat: e?.message ?? String(e) };
  }
}

mulai();
