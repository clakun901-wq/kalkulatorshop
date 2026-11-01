// kalkulator.js — pintu masuk kalkulator di utas utama (Fase 4)
//
// Utas utama TIDAK menghitung harga. File ini hanya mengirim data ke worker.js
// (yang memakai calculator.js) lewat postMessage dan menerima hasilnya.

let worker = null;
let penghitung = 0;
const menunggu = new Map();

function gagalkanSemua(galat) {
  for (const { reject } of menunggu.values()) reject(galat);
  menunggu.clear();
  worker = null;
}

function buatWorker() {
  // Build satu-file HTML mengisi __KALSARA_CALC_WORKER_URL__ dengan Blob URL.
  const sumber = globalThis.__KALSARA_CALC_WORKER_URL__ ?? new URL('./worker.js', import.meta.url);
  const w = new Worker(sumber, { type: 'module' });

  w.addEventListener('message', ({ data }) => {
    const janji = menunggu.get(data.id);
    if (!janji) return;
    menunggu.delete(data.id);
    if (data.ok) janji.resolve(data.hasil);
    else janji.reject(new Error(data.galat));
  });
  w.addEventListener('error', (e) => {
    gagalkanSemua(new Error(e.message || 'Worker kalkulator gagal dimuat.'));
  });
  w.addEventListener('messageerror', () => {
    gagalkanSemua(new Error('Pesan dari worker kalkulator tidak bisa dibaca.'));
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

export const kalkulator = {
  ping: () => panggil('ping', {}),

  // daftar: [{ modalSen, kemitraanSen, packingSen, targetUntungSen, isiPaket }]
  // -> { hasil: [...sejajar dengan daftar], ms }
  hitungBanyak: (daftar, pengaturan, tanggal) =>
    panggil('hitungBanyak', { daftar, pengaturan, tanggal }),

  impas: (produk, pengaturan, tanggal) => panggil('impas', { produk, pengaturan, tanggal }),

  // Fase 6. rincian -> { ok, baris, impasSen }
  rincian: (produk, pengaturan, tanggal) => panggil('rincian', { produk, pengaturan, tanggal }),

  // Fase 6. pesaing -> { ok, baris, peringatan, untungSen, marginPpm, impasSen, selisihImpasSen }
  pesaing: (produk, hargaSen, pengaturan, tanggal) =>
    panggil('pesaing', { produk, hargaSen, pengaturan, tanggal }),
};
