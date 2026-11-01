// uji-fase3.js — pemeriksaan kalkulator Kalsara v6 di browser (bukan bagian aplikasi).
// 1) Menjalankan kasus emas (hasil rumus asli v5.82) lewat worker.js.
// 2) Mengukur waktu hitung 1.000 produk di worker (tanpa database).

import { KASUS_UJI } from './uji-fase3-data.js';

// Build satu-file HTML mengisi __KALSARA_CALC_WORKER_URL__ dengan Blob URL.
const sumberWorker = globalThis.__KALSARA_CALC_WORKER_URL__ ?? new URL('./worker.js', import.meta.url);

const elRingkasan = document.getElementById('ringkasan');
const elDaftar = document.getElementById('daftar-uji');
const elBench = document.getElementById('benchmark');
const tombol = document.getElementById('btn-uji');

let worker = null;
let penghitung = 0;
const menunggu = new Map();

function panggil(op, args) {
  if (!worker) {
    worker = new Worker(sumberWorker, { type: 'module' });
    worker.addEventListener('message', ({ data }) => {
      const janji = menunggu.get(data.id);
      if (!janji) return;
      menunggu.delete(data.id);
      if (data.ok) janji.resolve(data.hasil);
      else janji.reject(new Error(data.galat));
    });
    worker.addEventListener('error', (e) => {
      const galat = new Error(e.message || 'Worker kalkulator gagal dimuat.');
      for (const { reject } of menunggu.values()) reject(galat);
      menunggu.clear();
      worker = null;
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++penghitung;
    menunggu.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

const rupiah = (sen) => `Rp ${(sen / 100).toLocaleString('id-ID')}`;

function baris(status, teks, rinci) {
  const li = document.createElement('li');
  li.className = `uji ${status}`;
  const judul = document.createElement('span');
  judul.textContent = `${status === 'lolos' ? 'Lolos' : 'GAGAL'} · ${teks}`;
  li.append(judul);
  if (rinci) {
    const p = document.createElement('pre');
    p.textContent = rinci;
    li.append(p);
  }
  return li;
}

async function jalankanKasus() {
  elDaftar.replaceChildren();
  let lolos = 0;

  for (const k of KASUS_UJI) {
    let li;
    try {
      const hasil = await panggil('hitung', {
        produk: k.produk, pengaturan: k.pengaturan, tanggal: k.tanggal,
      });

      if (k.harapanGalat) {
        const cocok = !hasil.ok && hasil.galat === k.harapanGalat;
        li = cocok
          ? baris('lolos', `${k.nama} → "${hasil.galat}"`)
          : baris('gagal', k.nama, `harapan galat: ${k.harapanGalat}\ndapat: ${JSON.stringify(hasil)}`);
        if (cocok) lolos += 1;
      } else {
        // totalPlatformSen ada di hasil.biaya, selebihnya di akar hasil.
        const nilaiHasil = (kunci) => hasil[kunci] ?? hasil.biaya?.[kunci];
        const salah = Object.entries(k.harapan).filter(([kunci, nilai]) => nilaiHasil(kunci) !== nilai);
        if (hasil.ok && salah.length === 0) {
          li = baris('lolos', `${k.nama} → harga coret ${rupiah(hasil.hargaCoretSen)}, untung ${rupiah(hasil.untungSen)}`);
          lolos += 1;
        } else {
          const rinci = salah.map(([kunci, nilai]) => `${kunci}: harapan ${nilai}, dapat ${nilaiHasil(kunci)}`).join('\n')
            || JSON.stringify(hasil);
          li = baris('gagal', k.nama, rinci);
        }
      }
    } catch (e) {
      li = baris('gagal', k.nama, e.message);
    }
    elDaftar.append(li);
  }

  elRingkasan.textContent = `${lolos} dari ${KASUS_UJI.length} kasus uji lolos`;
  elRingkasan.dataset.status = lolos === KASUS_UJI.length ? 'lolos' : 'gagal';
}

async function jalankanBenchmark() {
  const jumlah = 1000;
  const daftar = [];
  for (let i = 0; i < jumlah; i++) {
    daftar.push({
      modalSen: (5_000 + ((i * 7919) % 995_000)) * 100,
      kemitraanSen: 0,
      packingSen: (i % 4) * 50_000,
      targetUntungSen: (1_000 + (i % 50) * 500) * 100,
      isiPaket: 1 + (i % 3),
    });
  }

  const mulai = performance.now();
  const { hasil, ms } = await panggil('hitungBanyak', {
    daftar, pengaturan: { tipeToko: 'mall' }, tanggal: '2026-10-31',
  });
  const total = performance.now() - mulai;
  const ok = hasil.filter((h) => h.ok).length;

  elBench.textContent =
    `${jumlah} produk: ${ok} berhasil dihitung. ` +
    `Waktu hitung di worker ${ms.toFixed(0)} ms, ` +
    `termasuk kirim-terima pesan ${total.toFixed(0)} ms.`;
}

async function jalankan() {
  tombol.disabled = true;
  elRingkasan.textContent = 'Menjalankan uji…';
  elRingkasan.removeAttribute('data-status');
  elBench.textContent = '';
  try {
    const { versi } = await panggil('ping', {});
    document.getElementById('versi').textContent = `Kalkulator ${versi}`;
    await jalankanKasus();
    await jalankanBenchmark();
  } catch (e) {
    elRingkasan.textContent = `Uji gagal dijalankan: ${e.message}`;
    elRingkasan.dataset.status = 'gagal';
  } finally {
    tombol.disabled = false;
  }
}

tombol.addEventListener('click', jalankan);
jalankan();
