// app.js — entry point Kalsara v6 (Fase 2)
// State reaktif (Signals) kini bersumber dari SQLite di atas OPFS (lewat db.js).
// Utas utama hanya merender; semua baca/tulis database ada di worker.

import { signal, computed, effect, batch, h } from './ui.js';
import { db } from './db.js';

/* ---------------------------------------------------------------
   State
   Uang = bilangan bulat sen (rupiah x 100). Rp 89.900 → 8_990_000.
---------------------------------------------------------------- */
const rupiahKeSen = (rupiah) => rupiah * 100;

function dariBaris(baris) {
  return {
    id: baris.id,
    sku: baris.sku,
    nama: baris.nama,
    harga: signal(baris.hargaSen),
    stok: signal(baris.stok),
  };
}

const PRODUK_AWAL = [
  { sku: 'KLS-001', nama: 'Vacuum sealer portabel', hargaSen: rupiahKeSen(89900), stok: 12 },
  { sku: 'KLS-002', nama: 'Plastik vacuum embossed 20x30 (isi 50)', hargaSen: rupiahKeSen(35000), stok: 4 },
  { sku: 'KLS-003', nama: 'Botol minum stainless 750 ml', hargaSen: rupiahKeSen(64500), stok: 0 },
];

const daftarProduk = signal([]);
const statusDb = signal({ tahap: 'memuat' }); // memuat | siap | galat
const pesan = signal('');

const jumlahProduk = computed(() => daftarProduk.value.length);
const totalStok = computed(() =>
  daftarProduk.value.reduce((jumlah, p) => jumlah + p.stok.value, 0)
);

/* ---------------------------------------------------------------
   Elemen halaman
---------------------------------------------------------------- */
const wadah = document.getElementById('daftar');
const elRingkas = document.getElementById('ringkas');
const elStatus = document.getElementById('status-db');
const elPeringatan = document.getElementById('peringatan');
const elPesan = document.getElementById('pesan');
const tombol = [
  document.getElementById('btn-tambah'),
  document.getElementById('btn-acak'),
  document.getElementById('btn-hapus-semua'),
];

/* ---------------------------------------------------------------
   Render
   Kartu di-cache per id: menambah produk hanya membuat satu kartu baru.
---------------------------------------------------------------- */
const cacheKartu = new Map();

function ambilKartu(produk) {
  let kartu = cacheKartu.get(produk.id);
  if (!kartu) {
    kartu = document.createElement('product-card');
    kartu.produk = produk;
    cacheKartu.set(produk.id, kartu);
  }
  return kartu;
}

effect(() => {
  const daftar = daftarProduk.value;
  const siap = statusDb.value.tahap === 'siap';

  if (daftar.length > 0) {
    wadah.replaceChildren(...daftar.map(ambilKartu));
  } else if (siap) {
    wadah.replaceChildren(
      h('p', { class: 'kosong', text: 'Belum ada produk. Tekan "Tambah produk contoh" untuk mulai.' })
    );
  } else {
    wadah.replaceChildren();
  }

  // Buang kartu milik produk yang sudah dihapus dari cache.
  const idAktif = new Set(daftar.map((p) => p.id));
  for (const id of cacheKartu.keys()) {
    if (!idAktif.has(id)) cacheKartu.delete(id);
  }
});

effect(() => {
  const s = statusDb.value;
  if (s.tahap === 'memuat') {
    elRingkas.textContent = 'Menyiapkan penyimpanan…';
  } else if (s.tahap === 'galat') {
    elRingkas.textContent = 'Penyimpanan belum siap';
  } else {
    elRingkas.textContent = `${jumlahProduk.value} produk · total stok ${totalStok.value}`;
  }
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

let waktuPesan = 0;
effect(() => {
  const teks = pesan.value;
  elPesan.textContent = teks;
  elPesan.hidden = teks === '';
});

function tampilkanPesan(teks) {
  pesan.value = teks;
  clearTimeout(waktuPesan);
  waktuPesan = setTimeout(() => { pesan.value = ''; }, 5000);
}

/* ---------------------------------------------------------------
   Aksi (setiap aksi: tulis ke database dulu, baru perbarui signal)
---------------------------------------------------------------- */
async function jalankan(aksi) {
  try {
    await aksi();
  } catch (e) {
    tampilkanPesan(e?.message ?? String(e));
  }
}

function cariProduk(id) {
  return daftarProduk.peek().find((p) => p.id === id);
}

wadah.addEventListener('stok-ubah', (e) => {
  const { id, selisih } = e.detail;
  jalankan(async () => {
    const produk = cariProduk(id);
    if (!produk) return;
    produk.stok.value = await db.ubahStok(id, selisih);
  });
});

document.getElementById('btn-tambah').addEventListener('click', () => {
  jalankan(async () => {
    const dipakai = new Set(daftarProduk.peek().map((p) => p.sku.toLowerCase()));
    let nomor = daftarProduk.peek().length + 1;
    let sku = `KLS-${String(nomor).padStart(3, '0')}`;
    while (dipakai.has(sku.toLowerCase())) {
      nomor += 1;
      sku = `KLS-${String(nomor).padStart(3, '0')}`;
    }

    const baris = await db.tambah({
      sku,
      nama: `Produk contoh ${nomor}`,
      hargaSen: rupiahKeSen(10000 + (nomor % 9) * 5000),
      stok: 10,
    });
    daftarProduk.value = [...daftarProduk.peek(), dariBaris(baris)];
  });
});

document.getElementById('btn-acak').addEventListener('click', () => {
  jalankan(async () => {
    const perubahan = daftarProduk.peek().map((p) => ({
      id: p.id,
      stok: Math.floor(Math.random() * 15),
    }));
    if (perubahan.length === 0) return;

    await db.ubahStokMassal(perubahan); // satu transaksi
    batch(() => {
      for (const { id, stok } of perubahan) {
        const produk = cariProduk(id);
        if (produk) produk.stok.value = stok;
      }
    });
  });
});

document.getElementById('btn-hapus-semua').addEventListener('click', () => {
  if (!confirm('Hapus semua produk dari database di perangkat ini?')) return;
  jalankan(async () => {
    await db.kosongkan();
    daftarProduk.value = [];
  });
});

/* ---------------------------------------------------------------
   Mulai: buka database, isi data awal bila kosong, muat ke signal
---------------------------------------------------------------- */
async function mulai() {
  try {
    const info = await db.init();
    let baris = await db.daftar();

    // Data contoh hanya untuk uji Fase 2: terisi bila database masih kosong.
    if (baris.length === 0) {
      baris = await db.tambahBanyak(PRODUK_AWAL);
    }

    batch(() => {
      daftarProduk.value = baris.map(dariBaris);
      statusDb.value = { tahap: 'siap', ...info };
    });
    for (const t of tombol) t.disabled = false;
  } catch (e) {
    statusDb.value = { tahap: 'galat', galat: e?.message ?? String(e) };
  }
}

mulai();
