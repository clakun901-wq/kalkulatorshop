// beban.js — uji beban Kalsara v6 (Fase 4)
//
// Mengukur jalur lengkap UI -> Worker database -> OPFS/SQLite -> Worker kalkulator
// dengan 1.000 produk, sambil memantau apakah utas utama tetap lancar.
// Dijalankan dari tombol "Uji beban 1.000 produk" (tidak otomatis).

const fmt = (ms) => `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;

// Pantau jeda antar frame. Jeda besar = utas utama sempat tersendat.
function pantauFrame() {
  const mulai = performance.now();
  let terakhir = mulai;
  let jedaMaks = 0;
  let jumlah = 0;
  let aktif = true;

  const tik = (t) => {
    if (!aktif) return;
    jedaMaks = Math.max(jedaMaks, t - terakhir);
    terakhir = t;
    jumlah += 1;
    requestAnimationFrame(tik);
  };
  requestAnimationFrame(tik);

  return () => {
    aktif = false;
    const detik = (performance.now() - mulai) / 1000;
    return { jedaMaks, fps: detik > 0 ? jumlah / detik : 0, jumlah };
  };
}

const untukKalkulator = (b) => ({
  modalSen: b.modalSen,
  kemitraanSen: b.kemitraanSen,
  packingSen: b.packingSen,
  targetUntungSen: b.targetUntungSen,
  isiPaket: b.isiPaket,
});

// lapor(teks) dipanggil setiap satu langkah selesai.
export async function jalankanUjiBeban({ db, kalkulator, pengaturan, tanggal, renderHalaman, lapor }) {
  const henti = pantauFrame();
  try {
    let t = performance.now();
    const dummy = await db.suntikDummy(1000);
    lapor(`Tulis data dummy: ${dummy.ditambah} baris baru dalam ${fmt(dummy.ms)} (total ${dummy.total} produk, ` +
      `${fmt(performance.now() - t)} termasuk kirim-terima pesan).`);

    t = performance.now();
    const semua = await db.daftar();
    lapor(`Baca ${semua.length} produk dari database: ${fmt(performance.now() - t)}.`);

    t = performance.now();
    const { hasil, ms } = await kalkulator.hitungBanyak(semua.map(untukKalkulator), pengaturan, tanggal);
    const ok = hasil.filter((h) => h.ok).length;
    lapor(`Hitung harga ${semua.length} produk di worker: ${fmt(ms)} ` +
      `(${fmt(performance.now() - t)} termasuk kirim-terima pesan; ${ok} berhasil, ${hasil.length - ok} galat).`);

    t = performance.now();
    const cari = await db.halaman({ kata: 'sealer', batas: 24, offset: 0 });
    lapor(`Cari "sealer": ${cari.total} cocok, halaman pertama siap dalam ${fmt(performance.now() - t)}.`);

    t = performance.now();
    await db.ubahStokMassal(semua.map((b) => ({ id: b.id, stok: b.stok })));
    lapor(`Tulis ulang stok ${semua.length} produk dalam satu transaksi: ${fmt(performance.now() - t)}.`);

    const msRender = await renderHalaman();
    lapor(`Render satu halaman kartu di utas utama: ${fmt(msRender)}.`);
  } finally {
    const r = henti();
    lapor(`Utas utama selama uji: jeda antar-frame terpanjang ${fmt(r.jedaMaks)}, ` +
      `rata-rata ${r.fps.toFixed(0)} frame/detik. Jeda di bawah sekitar 100 ms berarti tampilan tidak tersendat. ` +
      'Biarkan tab tetap terbuka di layar selama uji, karena tab latar membuat angka ini tidak bermakna.');
  }
}
