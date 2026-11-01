// db.js — pintu masuk penyimpanan Kalsara v6 (Fase 2; Fase 6 menambah ubahTarget dan riwayatModal)
//
// Utas utama TIDAK menyentuh SQLite. File ini hanya mengirim perintah ke
// db.worker.js lewat postMessage dan mengembalikan hasilnya sebagai Promise.
//
// Uang selalu bilangan bulat sen (rupiah x 100): properti `hargaSen`.

let worker = null;
let penghitung = 0;
const menunggu = new Map();

function gagalkanSemua(galat) {
  for (const { reject } of menunggu.values()) reject(galat);
  menunggu.clear();
  worker = null; // panggilan berikutnya boleh mencoba membuat worker baru
}

function buatWorker() {
  // Build satu-file HTML mengisi __KALSARA_WORKER_URL__ dengan Blob URL.
  const sumber = globalThis.__KALSARA_WORKER_URL__ ?? new URL('./db.worker.js', import.meta.url);
  const w = new Worker(sumber, { type: 'module' });

  w.addEventListener('message', ({ data }) => {
    const janji = menunggu.get(data.id);
    if (!janji) return;
    menunggu.delete(data.id);
    if (data.ok) janji.resolve(data.hasil);
    else janji.reject(new Error(data.galat));
  });

  w.addEventListener('error', (e) => {
    gagalkanSemua(new Error(e.message || 'Worker penyimpanan gagal dimuat.'));
  });

  w.addEventListener('messageerror', () => {
    gagalkanSemua(new Error('Pesan dari worker penyimpanan tidak bisa dibaca.'));
  });

  return w;
}

function panggil(op, args) {
  worker ??= buatWorker();
  return new Promise((resolve, reject) => {
    const id = ++penghitung;
    menunggu.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

export const db = {
  // Minta penyimpanan permanen (anti dibersihkan browser), lalu buka database.
  // Mengembalikan: { mode, vfs, permanen, alasan, versiSqlite, versiSkema, jumlahProduk, persisten }
  async init() {
    let persisten = false;
    try {
      persisten = (await navigator.storage?.persist?.()) ?? false;
    } catch {
      persisten = false;
    }
    const info = await panggil('init');
    return { ...info, persisten };
  },

  daftar: () => panggil('daftar'),
  halaman: (opsi) => panggil('halaman', opsi), // { kata, batas, offset } -> { baris, total }
  ringkasan: () => panggil('ringkasan'), // { jumlah, totalStok } seluruh produk
  suntikDummy: (jumlah = 1000) => panggil('suntikDummy', { jumlah }),
  tambah: (produk) => panggil('tambah', produk),
  tambahBanyak: (daftar) => panggil('tambahBanyak', daftar),
  ubahStok: (id, selisih) => panggil('ubahStok', { id, selisih }),
  ubahStokMassal: (daftar) => panggil('ubahStokMassal', daftar),
  ubahProduk: (produk) => panggil('ubahProduk', produk), // { id, ...field produk }; modal berubah -> masuk riwayat
  ubahTarget: (id, targetUntungSen) => panggil('ubahTarget', { id, targetUntungSen }), // -> target tersimpan (sen)
  riwayatModal: (id, batas = 20) => panggil('riwayatModal', { id, batas }), // -> [{ lamaSen, baruSen, dicatatPada }]
  hapus: (id) => panggil('hapus', id),
  ambilPengaturan: () => panggil('ambilPengaturan'), // objek atau null bila belum pernah disimpan
  simpanPengaturan: (pengaturan) => panggil('simpanPengaturan', pengaturan),
  kosongkan: () => panggil('kosongkan'),
};
