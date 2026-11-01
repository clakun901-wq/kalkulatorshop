// uji-fase6.js — pemeriksaan Fase 6 (bukan bagian aplikasi). Jalan di Node: `node uji-fase6.js`
// dan di browser lewat uji-fase6.html. Hanya menguji modul murni (tanpa DOM, tanpa database).

import { KASUS_UJI } from './uji-fase3-data.js';
import {
  hitungHarga, hitungMaju, hargaImpas, periksaHasil, gabungPengaturan, PENGATURAN_BAWAAN,
} from './calculator.js';
import { bagianGrafik, barisRincian, pesanPeringatan, barisRiwayat } from './rincian.js';
import { formatRupiah, formatPersenPpm } from './format.js';
import {
  isianDariPengaturan, pengaturanDariIsian, isianProdukKosong, produkDariIsian, isianDariProduk,
} from './isian.js';

const hasilUji = [];
function uji(nama, fn) {
  try { fn(); hasilUji.push({ nama, ok: true }); } catch (e) { hasilUji.push({ nama, ok: false, galat: e.message }); }
}
function sama(a, b, pesan = '') {
  if (a !== b) throw new Error(`${pesan} diharapkan ${b}, dapat ${a}`);
}
function benar(k, pesan) { if (!k) throw new Error(pesan); }

const produkContoh = (u = {}) => ({
  modalSen: 6_000_000, kemitraanSen: 0, packingSen: 100_000, targetUntungSen: 1_500_000, isiPaket: 1, override: {}, ...u,
});
const TGL = '2026-11-01';

/* 1. Kasus emas v5.82 masih lolos (Fase 6 tidak boleh mengubah angka harga). */
uji(`kasus emas v5.82 (${KASUS_UJI.length} kasus)`, () => {
  for (const k of KASUS_UJI) {
    const h = hitungHarga(k.produk, k.pengaturan, k.tanggal);
    if (k.harapanGalat) { sama(h.galat, k.harapanGalat, k.nama); continue; }
    for (const [kunci, nilai] of Object.entries(k.harapan)) {
      sama(h[kunci] ?? h.biaya?.[kunci], nilai, `${k.nama} / ${kunci}`);
    }
  }
});

/* 2. Margin dan potongan. */
uji('margin = untung / harga pembeli (ppm), cocok dengan rumus v5.82', () => {
  const h = hitungHarga(produkContoh(), {}, TGL);
  benar(h.ok, 'harus ok');
  const harapan = Math.round((h.untungSen / h.hargaPembeliSen) * 1_000_000);
  sama(h.marginPpm, harapan, 'marginPpm');
  const pot = Math.round(((h.biaya.totalPlatformSen + h.premiSen + h.pajakSen) / h.hargaPembeliSen) * 1_000_000);
  sama(h.potonganPpm, pot, 'potonganPpm');
});

uji('margin 1.500 kasus acak sama dengan float v5.82 (selisih maks 1 ppm)', () => {
  let seed = 12345;
  const acak = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 1500; i++) {
    const p = produkContoh({
      modalSen: Math.round(1000 + acak() * 500_000) * 100,
      targetUntungSen: Math.round(acak() * 30_000) * 100,
      isiPaket: 1 + Math.floor(acak() * 3),
    });
    const h = hitungHarga(p, { tipeToko: acak() < 0.5 ? 'biasa' : 'mall' }, TGL);
    if (!h.ok) continue;
    const m = (h.untungSen / h.hargaPembeliSen) * 1_000_000;
    benar(Math.abs(h.marginPpm - m) <= 1, `kasus ${i}: ${h.marginPpm} vs ${m}`);
  }
});

/* 3. Peringatan. */
uji('peringatan: rugi, nol, tipis, aman, potongan tinggi', () => {
  const p = produkContoh({ targetUntungSen: 0 });
  const rugi = hitungMaju(p, 6_000_000, {}, TGL); // jual di harga modal -> rugi
  sama(rugi.tingkat, 'r', 'rugi tingkat'); sama(rugi.kode[0], 'rugi', 'rugi kode');

  const impas = hargaImpas(p, {}, TGL);
  let nol = null;
  for (let s = impas.hargaListingSen - 2000; s <= impas.hargaListingSen + 2000; s += 100) {
    const h = hitungMaju(p, s, {}, TGL);
    if (h.untungSen === 0) { nol = h; break; }
  }
  if (nol) { sama(nol.tingkat, 'r', 'nol tingkat'); sama(nol.kode[0], 'nol', 'nol kode'); }

  const tipis = hitungMaju(p, impas.hargaListingSen + 500, {}, TGL);
  benar(tipis.untungSen > 0 && tipis.kode.includes('tipis'), 'harus tipis');
  sama(tipis.tingkat, 'y', 'tipis tingkat');

  const aman = hitungHarga(produkContoh({ targetUntungSen: 5_000_000 }), {}, TGL);
  sama(aman.tingkat, '', 'aman tingkat'); sama(aman.kode.length, 0, 'aman kode');

  const potongan = hitungMaju(produkContoh(), 20_000_000, { gratisOngkirXtra: { kategori: 'H', ukuran: 'k', batasKhususSen: 1_000_000_000 } }, TGL);
  benar(potongan.potonganPpm > 300_000 ? potongan.kode.includes('potongan') : !potongan.kode.includes('potongan'), 'konsisten dengan ambang 30%');
  const tinggi = periksaHasil({ ...aman, potonganPpm: 0, biaya: { ...aman.biaya, totalPlatformSen: aman.hargaPembeliSen } }, {});
  benar(tinggi.kode.includes('potongan'), 'potongan tinggi terdeteksi');
});

uji('batas peringatan bisa diubah lewat pengaturan', () => {
  const h = hitungHarga(produkContoh({ targetUntungSen: 100_000 }), { peringatan: { untungMinSen: 100_000, marginMinPpm: 0 } }, TGL);
  sama(h.kode.includes('tipis'), false, 'tidak tipis bila batas rendah');
  const h2 = hitungHarga(produkContoh({ targetUntungSen: 100_000 }), { peringatan: { untungMinSen: 100_000_000 } }, TGL);
  sama(h2.kode.includes('tipis'), true, 'tipis bila batas tinggi');
});

uji('pesan peringatan berbahasa Indonesia dan memuat angka', () => {
  const h = hitungMaju(produkContoh({ targetUntungSen: 0 }), 6_000_000, {}, TGL);
  const r = pesanPeringatan(h, {}, false);
  sama(r.pesan[0], 'Rugi. Naikkan harga atau target untung.', 'rugi');
  sama(pesanPeringatan(h, {}, true).pesan[0], 'Rugi pada harga ini.', 'rugi balik');
  const impas = hargaImpas(produkContoh({ targetUntungSen: 0 }), {}, TGL);
  const t = hitungMaju(produkContoh({ targetUntungSen: 0 }), impas.hargaListingSen + 500, {}, TGL);
  benar(/^Untung tipis \(Rp.*margin .*%\)\. Batas aman: Rp.*dan 1%\.$/.test(pesanPeringatan(t, {}, false).pesan[0]), 'format tipis');
});

/* 4. Grafik. */
uji('grafik: lebar batang tepat 100% dan persen masuk akal', () => {
  for (const target of [0, 500_000, 1_500_000, 8_000_000]) {
    const h = hitungHarga(produkContoh({ targetUntungSen: target }), {}, TGL);
    const g = bagianGrafik(h);
    sama(g.lebarModal + g.lebarPotongan + g.lebarUntung, 1000, `jumlah lebar target ${target}`);
    benar(Math.abs(g.modalPersen + g.potonganPersen + g.untungPersen - 100) <= 1, 'jumlah persen ~100');
    sama(g.modalSen, h.modalSen, 'modal');
  }
  const rugi = bagianGrafik(hitungMaju(produkContoh({ targetUntungSen: 0 }), 6_000_000, {}, TGL));
  sama(rugi.untungSen, 0, 'untung negatif ditulis 0 di grafik');
});

/* 5. Rincian biaya. */
uji('rincian: jumlah baris cocok dengan hasil kalkulator', () => {
  const p = produkContoh();
  const h = hitungHarga(p, { promoXtra: { ppm: 30_000 }, iklanPpm: 50_000, returPpm: 10_000, biayaLainSen: 100_000 }, TGL);
  const impas = hargaImpas(p, { promoXtra: { ppm: 30_000 }, iklanPpm: 50_000, returPpm: 10_000, biayaLainSen: 100_000 }, TGL);
  const baris = barisRincian(h, { impasSen: impas.hargaListingSen, targetSen: p.targetUntungSen });
  const ambil = (label) => baris.find((b) => b.label.startsWith(label));
  sama(ambil('Total Biaya Shopee').sen, h.biaya.totalPlatformSen, 'total');
  sama(ambil('Saldo masuk toko').sen, h.penerimaanSen, 'saldo');
  sama(ambil('Untung bersih').sen, h.untungSen, 'untung');
  sama(ambil('Biaya iklan').sen, h.iklanSen, 'iklan');
  sama(ambil('Cadangan retur').sen, h.returSen, 'retur');
  sama(ambil('Ongkir ditanggung').sen, 100_000, 'ongkir');
  sama(ambil('Harga impas').sen, impas.hargaListingSen, 'impas');
  sama(ambil('Margin').teks, `${formatPersenPpm(h.marginPpm)}%`, 'margin teks');
  // Saldo = harga pembeli - semua potongan; untung = saldo - modal.
  sama(h.hargaPembeliSen - h.biaya.totalPlatformSen - h.premiSen - h.pajakSen - h.iklanSen - h.returSen - h.biayaLainSen, h.penerimaanSen, 'identitas saldo');
  sama(h.penerimaanSen - h.modalSen, h.untungSen, 'identitas untung');
});

uji('rincian: tanda "kena batas" dan baris voucher', () => {
  const h = hitungHarga(produkContoh({ targetUntungSen: 20_000_000 }), {
    gratisOngkirXtra: { kategori: 'D', batasBiasaSen: 100_000 },
    voucher: { mode: 'nom', nilai: 500_000, batasSen: 0 },
  }, TGL);
  const baris = barisRincian(h);
  benar(baris.some((b) => b.catatan === 'kena batas'), 'harus ada catatan kena batas');
  benar(baris.some((b) => b.label === 'Voucher toko' && b.sen === -500_000), 'baris voucher');
  benar(baris.some((b) => b.label === 'Harga setelah voucher'), 'harga setelah voucher');
});

/* 6. Cek pesaing = hitung maju dari harga diskon coret. */
uji('cek pesaing: harga hasil hitungHarga memberi untung yang sama bila dimasukkan lagi', () => {
  const p = produkContoh();
  const h = hitungHarga(p, {}, TGL);
  const balik = hitungMaju(p, h.hargaListingSen, {}, TGL);
  sama(balik.untungSen, h.untungSen, 'untung balik');
  sama(balik.marginPpm, h.marginPpm, 'margin balik');
});

uji('cek pesaing: makin murah makin kecil untung, dan harga impas = batas rugi', () => {
  const p = produkContoh({ targetUntungSen: 0 });
  const impas = hargaImpas(p, {}, TGL).hargaListingSen;
  benar(hitungMaju(p, impas, {}, TGL).untungSen >= 0, 'di harga impas tidak rugi');
  benar(hitungMaju(p, impas - 5000, {}, TGL).untungSen < 0, 'di bawah impas rugi');
});

/* 7. Riwayat modal. */
uji('riwayat modal: perubahan persen dan arah', () => {
  const t = Date.UTC(2026, 10, 12, 12);
  const baris = barisRiwayat([{ lamaSen: 5_000_000, baruSen: 6_000_000, dicatatPada: t }, { lamaSen: 6_000_000, baruSen: 5_700_000, dicatatPada: t }]);
  sama(baris[0].naik, true, 'naik');
  benar(/\(\+20%\)$/.test(baris[0].teks), `teks naik: ${baris[0].teks}`);
  sama(baris[1].naik, false, 'turun');
  benar(/\(-5%\)$/.test(baris[1].teks), `teks turun: ${baris[1].teks}`);
  benar(baris[0].teks.includes('Rp') && baris[0].teks.includes(' ke '), 'format');
});

/* 8. Format. */
uji('format persen dan rupiah', () => {
  sama(formatPersenPpm(123_456), '12,3', 'persen');
  sama(formatPersenPpm(120_000), '12', 'bulat');
  sama(formatPersenPpm(-5_000), '-0,5', 'negatif');
  sama(formatPersenPpm(0), '0', 'nol');
  benar(formatRupiah(7_854_000).includes('78.540'), 'rupiah');
});

/* 9. Isian: bidang baru. */
uji('setelan: bidang peringatan bolak-balik', () => {
  const isian = isianDariPengaturan({ peringatan: { untungMinSen: 350_000, marginMinPpm: 25_000, potonganMaksPpm: 400_000 } });
  sama(isian.untungMin, '3500', 'untungMin'); sama(isian.marginMin, '2,5', 'marginMin'); sama(isian.potonganMaks, '40', 'potonganMaks');
  const r = pengaturanDariIsian({ ...isian, untungMin: '4.000', marginMin: '3', potonganMaks: '35,5' });
  benar(r.ok, 'ok');
  sama(r.pengaturan.peringatan.untungMinSen, 400_000, 'sen'); sama(r.pengaturan.peringatan.marginMinPpm, 30_000, 'ppm'); sama(r.pengaturan.peringatan.potonganMaksPpm, 355_000, 'ppm2');
  benar(!pengaturanDariIsian({ ...isian, marginMin: 'abc' }).ok, 'tolak teks');
  benar(!pengaturanDariIsian({ ...isian, potonganMaks: '150' }).ok, 'tolak di atas 100%');
});

uji('pengaturan lama (tanpa peringatan) tetap valid dan memakai bawaan', () => {
  const p = gabungPengaturan({ tipeToko: 'mall' });
  sama(p.peringatan.untungMinSen, 200_000, 'bawaan');
  const h = hitungHarga(produkContoh(), { tipeToko: 'mall' }, TGL);
  benar(h.ok, 'hitung tetap jalan');
});

uji('produk: supplier dan link divalidasi', () => {
  const k = { ...isianProdukKosong(), nama: 'A', sku: 'B', modal: '10000' };
  let r = produkDariIsian({ ...k, supplier: ' Toko X ', linkSupplier: 'https://x.id/p?1' });
  benar(r.ok, 'ok'); sama(r.produk.supplier, 'Toko X', 'trim'); sama(r.produk.linkSupplier, 'https://x.id/p?1', 'link');
  benar(!produkDariIsian({ ...k, linkSupplier: 'javascript:alert(1)' }).ok, 'tolak javascript:');
  benar(!produkDariIsian({ ...k, linkSupplier: 'ftp://x' }).ok, 'tolak ftp');
  benar(!produkDariIsian({ ...k, linkSupplier: 'https://a b' }).ok, 'tolak spasi');
  benar(!produkDariIsian({ ...k, supplier: 'x'.repeat(101) }).ok, 'tolak supplier panjang');
  r = produkDariIsian(k);
  benar(r.ok && r.produk.supplier === '' && r.produk.linkSupplier === '', 'kosong boleh');
  const bal = isianDariProduk({ nama: 'A', sku: 'B', modalSen: 100, isiPaket: 1, kemitraanSen: 0, packingSen: 0, targetUntungSen: 0, stok: 0, supplier: 'S', linkSupplier: 'https://s.id', override: {} });
  sama(bal.supplier, 'S', 'bolak-balik supplier'); sama(bal.linkSupplier, 'https://s.id', 'bolak-balik link');
  const lama = isianDariProduk({ nama: 'A', sku: 'B', modalSen: 100, isiPaket: 1, kemitraanSen: 0, packingSen: 0, targetUntungSen: 0, stok: 0, override: {} });
  sama(lama.supplier, '', 'baris tanpa supplier');
});

/* Ringkasan */
const gagal = hasilUji.filter((x) => !x.ok);
const teksRingkas = `${hasilUji.length - gagal.length} dari ${hasilUji.length} uji lolos`;
if (typeof document === 'undefined') {
  for (const x of hasilUji) console.log(`${x.ok ? 'LOLOS' : 'GAGAL'}  ${x.nama}${x.ok ? '' : `\n        ${x.galat}`}`);
  console.log(`\n${teksRingkas}`);
  process.exitCode = gagal.length ? 1 : 0;
} else {
  const ringkas = document.getElementById('ringkasan');
  ringkas.textContent = teksRingkas;
  ringkas.dataset.status = gagal.length ? 'gagal' : 'lolos';
  const daftar = document.getElementById('daftar-uji');
  for (const x of hasilUji) {
    const li = document.createElement('li');
    li.className = `uji ${x.ok ? 'lolos' : 'gagal'}`;
    li.textContent = `${x.ok ? 'Lolos' : 'GAGAL'} · ${x.nama}${x.ok ? '' : ` — ${x.galat}`}`;
    daftar.append(li);
  }
}
