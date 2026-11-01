// isian.js — jembatan antara isian formulir (teks) dan data internal Kalsara v6 (Fase 5)
//
// Modul MURNI (tanpa DOM) supaya mudah diuji. Berisi:
//   - spesifikasi bidang formulir Setelan toko dan formulir Produk,
//   - konversi teks <-> sen (rupiah x 100) dan teks <-> ppm (persen x 10.000),
//   - validasi dengan pesan galat berbahasa Indonesia.
// Tidak ada parseFloat: semua angka diurai dari teks dengan aturan bilangan bulat.

import {
  TABEL_ADMIN,
  TABEL_GRATIS_ONGKIR,
  PENGATURAN_BAWAAN,
  gabungPengaturan,
  persenKePpm,
} from './calculator.js';

/* ===============================================================
   Konversi teks <-> satuan internal
=============================================================== */

// 65000 ppm -> "6,5"
export function ppmKeTeks(ppm) {
  const bulat = Math.floor(ppm / 10_000);
  const sisa = ppm % 10_000;
  return sisa === 0 ? String(bulat) : `${bulat},${String(sisa).padStart(4, '0').replace(/0+$/, '')}`;
}

// 8990000 sen -> "89900" ; 8990050 sen -> "89900,5"
export function senKeTeks(sen) {
  const rupiah = Math.floor(sen / 100);
  const sen2 = sen % 100;
  if (sen2 === 0) return String(rupiah);
  return `${rupiah},${String(sen2).padStart(2, '0').replace(/0+$/, '')}`;
}

const salah = (galat) => ({ ok: false, galat });
const benar = (nilai) => ({ ok: true, nilai });

// "6,5" | "6.5" | "6,5%" -> ppm. Kosong dianggap 0.
export function teksKePpm(teks, { maks = 999_999 } = {}) {
  const t = String(teks ?? '').replace('%', '').trim();
  if (t === '') return benar(0);
  let ppm;
  try {
    ppm = persenKePpm(t);
  } catch {
    return salah('harus berupa angka persen, contoh 6,5');
  }
  if (ppm > maks) return salah(`tidak boleh lebih dari ${ppmKeTeks(maks)}%`);
  return benar(ppm);
}

// "89.900" | "Rp 89.900" | "89900" | "1250,5" -> sen. Kosong dianggap 0.
export function teksKeSen(teks, { min = 0, maks = 1_000_000_000 } = {}) {
  let t = String(teks ?? '').trim().replace(/^rp\.?\s*/i, '').replace(/\s/g, '');
  if (t === '') t = '0';
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, ''); // titik ribuan
  t = t.replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return salah('harus berupa angka rupiah, contoh 89900');
  const rupiah = Number(m[1]);
  if (rupiah > maks) return salah('terlalu besar');
  const sen = rupiah * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (sen < min * 100) return salah(`minimal ${min.toLocaleString('id-ID')}`);
  return benar(sen);
}

export function teksKeBulat(teks, { min = 0, maks = 10_000_000 } = {}) {
  const t = String(teks ?? '').trim();
  if (!/^\d+$/.test(t)) return salah('harus bilangan bulat, contoh 10');
  const n = Number(t);
  if (n < min) return salah(`minimal ${min}`);
  if (n > maks) return salah(`maksimal ${maks.toLocaleString('id-ID')}`);
  return benar(n);
}

function tanggalValid(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
}

/* ===============================================================
   Spesifikasi formulir Setelan toko
   jenis: teks | persen | rupiah | angka | tanggal | pilih | cek | sesuaiMode
=============================================================== */
const OPSI_ADMIN = [
  ...Object.keys(TABEL_ADMIN).map((k) => [
    k,
    `Kategori ${k} · ${ppmKeTeks(TABEL_ADMIN[k][0])}% (Mall ${ppmKeTeks(TABEL_ADMIN[k][1])}%)`,
  ]),
  ['man', 'Isi manual'],
];

const OPSI_GO = [
  ...Object.keys(TABEL_GRATIS_ONGKIR).map((k) => [k, `Kategori ${k}`]),
  ['man', 'Isi manual'],
  ['none', 'Tidak ikut'],
];

export const SPEK_SETELAN = [
  { kelompok: 'Status toko' },
  {
    id: 'tipeLabel', label: 'Tipe toko', jenis: 'pilih', jalur: ['tipeLabel'],
    opsi: [['ns', 'Non-Star'], ['st', 'Star / Star+'], ['ml', 'Shopee Mall']],
    bantuan: 'Mall memakai tarif kolom Mall dan biaya pembayaran 1,8%.',
  },
  { id: 'prosesAktif', label: 'Biaya proses pesanan sudah dikenakan Shopee', jenis: 'cek', jalur: ['biayaProses', 'aktif'] },
  { id: 'prosesNominal', label: 'Nominal biaya proses per pesanan (Rp)', jenis: 'rupiah', jalur: ['biayaProses', 'nominalSen'] },

  { kelompok: 'Administrasi' },
  { id: 'adminKategori', label: 'Kategori administrasi bawaan', jenis: 'pilih', jalur: ['administrasi', 'kategori'], opsi: OPSI_ADMIN },
  { id: 'adminManual', label: 'Tarif manual (%)', jenis: 'persen', jalur: ['administrasi', 'manualPpm'], bantuan: 'Dipakai bila kategori "Isi manual".' },

  { kelompok: 'Gratis Ongkir XTRA' },
  {
    id: 'goKategori', label: 'Kategori', jenis: 'pilih', jalur: ['gratisOngkirXtra', 'kategori'], opsi: OPSI_GO,
    bantuan: 'Tarif mengikuti tabel resmi. Tarif baru berlaku otomatis mulai 1 Desember 2026.',
  },
  { id: 'goUkuran', label: 'Ukuran produk', jenis: 'pilih', jalur: ['gratisOngkirXtra', 'ukuran'], opsi: [['b', 'Biasa'], ['k', 'Khusus (besar atau berat)']] },
  { id: 'goManual', label: 'Tarif manual (%)', jenis: 'persen', jalur: ['gratisOngkirXtra', 'manualPpm'] },
  {
    id: 'goFaktor', label: 'Tarif toko baru (% dari tarif penuh)', jenis: 'persen', maks: 1_000_000,
    jalur: ['gratisOngkirXtra', 'faktorPpm'], bantuan: '100 = tarif penuh. Isi 50 bila toko baru mendapat keringanan setengah tarif.',
  },
  { id: 'goSampai', label: 'Keringanan berakhir pada tanggal', jenis: 'tanggal', jalur: ['gratisOngkirXtra', 'faktorSampai'], bantuan: 'Kosongkan bila tidak ada batas. Setelah tanggal ini tarif kembali penuh.' },
  { id: 'goBatasBiasa', label: 'Batas biaya produk biasa (Rp)', jenis: 'rupiah', jalur: ['gratisOngkirXtra', 'batasBiasaSen'] },
  { id: 'goBatasKhusus', label: 'Batas biaya produk khusus (Rp)', jenis: 'rupiah', jalur: ['gratisOngkirXtra', 'batasKhususSen'] },

  { kelompok: 'Program XTRA lain (0 = tidak ikut)' },
  { id: 'promoPersen', label: 'Promo XTRA (%)', jenis: 'persen', jalur: ['promoXtra', 'ppm'] },
  { id: 'promoBatas', label: 'Batas Promo XTRA (Rp)', jenis: 'rupiah', jalur: ['promoXtra', 'batasSen'] },
  { id: 'videoPersen', label: 'Video XTRA (%)', jenis: 'persen', jalur: ['videoXtra', 'ppm'] },
  { id: 'videoBatas', label: 'Batas Video XTRA (Rp)', jenis: 'rupiah', jalur: ['videoXtra', 'batasSen'] },
  { id: 'livePersen', label: 'Live XTRA (%)', jenis: 'persen', jalur: ['liveXtra', 'ppm'] },
  { id: 'liveBatas', label: 'Batas Live XTRA (Rp)', jenis: 'rupiah', jalur: ['liveXtra', 'batasSen'] },

  { kelompok: 'Biaya lain' },
  { id: 'pajak', label: 'PPh 22 (%)', jenis: 'persen', jalur: ['pajakPpm'], bantuan: 'Isi 0 jika bebas.' },
  { id: 'premi', label: 'Premi / proteksi (%)', jenis: 'persen', jalur: ['premiPpm'] },
  { id: 'iklan', label: 'Biaya iklan, target ACOS (%)', jenis: 'persen', jalur: ['iklanPpm'] },
  { id: 'retur', label: 'Cadangan retur dan batal (%)', jenis: 'persen', jalur: ['returPpm'] },
  { id: 'biayaLain', label: 'Ongkir ditanggung penjual / biaya tetap lain per pesanan (Rp)', jenis: 'rupiah', jalur: ['biayaLainSen'] },

  { kelompok: 'Harga jual' },
  { id: 'diskonAktif', label: 'Pakai harga coret (diskon tampilan)', jenis: 'cek', jalur: ['diskonCoret', 'aktif'] },
  { id: 'diskonMode', label: 'Jenis diskon coret', jenis: 'pilih', jalur: ['diskonCoret', 'mode'], opsi: [['pct', 'Persen'], ['nom', 'Nominal (Rp)']] },
  { id: 'diskonNilai', label: 'Besar diskon coret (% atau Rp sesuai jenis)', jenis: 'sesuaiMode', modeId: 'diskonMode', jalur: ['diskonCoret', 'nilai'] },
  { id: 'voucherMode', label: 'Voucher toko', jenis: 'pilih', jalur: ['voucher', 'mode'], opsi: [['none', 'Tanpa voucher'], ['pct', 'Persen'], ['nom', 'Nominal (Rp)']] },
  { id: 'voucherNilai', label: 'Besar voucher (% atau Rp sesuai jenis)', jenis: 'sesuaiMode', modeId: 'voucherMode', jalur: ['voucher', 'nilai'] },
  { id: 'voucherBatas', label: 'Batas potongan voucher persen (Rp, 0 = tanpa batas)', jenis: 'rupiah', jalur: ['voucher', 'batasSen'] },
  { id: 'bulatLangkah', label: 'Pembulatan harga ke kelipatan (Rp)', jenis: 'rupiah', min: 1, maks: 1_000_000, jalur: ['pembulatan', 'langkahSen'] },
  { id: 'bulatAkhiran', label: 'Akhiran harga (Rp, 0 = tidak dipakai)', jenis: 'rupiah', maks: 999, jalur: ['pembulatan', 'akhiranSen'], bantuan: 'Contoh 900 membuat harga berakhiran 900 (…1.900, …2.900).' },

  { kelompok: 'Peringatan untung' },
  { id: 'untungMin', label: 'Untung minimal aman per pesanan (Rp)', jenis: 'rupiah', jalur: ['peringatan', 'untungMinSen'], bantuan: 'Untung di bawah ini diberi peringatan kuning.' },
  { id: 'marginMin', label: 'Margin minimal aman (%)', jenis: 'persen', maks: 1_000_000, jalur: ['peringatan', 'marginMinPpm'], bantuan: 'Untung dibagi harga jual setelah voucher.' },
  { id: 'potonganMaks', label: 'Total potongan maksimal wajar (%)', jenis: 'persen', maks: 1_000_000, jalur: ['peringatan', 'potonganMaksPpm'], bantuan: 'Biaya Shopee + premi + PPh dibagi harga jual. Di atas ini diberi peringatan.' },
];

/* ===============================================================
   Akses jalur objek
=============================================================== */
function ambilJalur(obj, jalur) {
  return jalur.reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function setJalur(obj, jalur, nilai) {
  let o = obj;
  for (let i = 0; i < jalur.length - 1; i++) {
    if (typeof o[jalur[i]] !== 'object' || o[jalur[i]] === null) o[jalur[i]] = {};
    o = o[jalur[i]];
  }
  o[jalur[jalur.length - 1]] = nilai;
}

const salinan = (x) => JSON.parse(JSON.stringify(x));

/* ===============================================================
   Pengaturan <-> isian
=============================================================== */
function bidangTeks(spek) {
  return spek.filter((b) => b.id);
}

export function isianDariPengaturan(pengaturan) {
  const p = gabungPengaturan(pengaturan ?? {});
  const isian = {};
  for (const b of bidangTeks(SPEK_SETELAN)) {
    let nilai = b.id === 'tipeLabel'
      ? (p.tipeLabel ?? (p.tipeToko === 'mall' ? 'ml' : 'ns'))
      : ambilJalur(p, b.jalur);

    if (b.jenis === 'cek') isian[b.id] = Boolean(nilai);
    else if (b.jenis === 'persen') isian[b.id] = ppmKeTeks(nilai ?? 0);
    else if (b.jenis === 'rupiah') isian[b.id] = senKeTeks(nilai ?? 0);
    else if (b.jenis === 'sesuaiMode') {
      const mode = ambilJalur(p, SPEK_SETELAN.find((x) => x.id === b.modeId).jalur);
      isian[b.id] = mode === 'pct' ? ppmKeTeks(nilai ?? 0) : senKeTeks(nilai ?? 0);
    } else isian[b.id] = nilai === undefined || nilai === null ? '' : String(nilai);
  }
  return isian;
}

// Mengembalikan { ok: true, pengaturan } atau { ok: false, galat: [pesan, ...] }.
// `dasar` = pengaturan saat ini: bidang yang tidak ada di formulir tetap dipertahankan.
export function pengaturanDariIsian(isian, dasar = PENGATURAN_BAWAAN) {
  const p = salinan(gabungPengaturan(dasar));
  const galat = [];

  for (const b of bidangTeks(SPEK_SETELAN)) {
    const mentah = isian[b.id];
    let hasil;

    if (b.jenis === 'cek') hasil = benar(Boolean(mentah));
    else if (b.jenis === 'pilih') {
      hasil = b.opsi.some(([v]) => v === mentah) ? benar(mentah) : salah('pilihan tidak valid');
    } else if (b.jenis === 'tanggal') {
      const t = String(mentah ?? '').trim();
      hasil = t === '' || tanggalValid(t) ? benar(t) : salah('tanggal tidak valid');
    } else if (b.jenis === 'persen') hasil = teksKePpm(mentah, { maks: b.maks });
    else if (b.jenis === 'rupiah') hasil = teksKeSen(mentah, { min: b.min ?? 0, maks: b.maks });
    else if (b.jenis === 'sesuaiMode') {
      const mode = isian[b.modeId];
      if (mode === 'pct') hasil = teksKePpm(mentah);
      else if (mode === 'nom') hasil = teksKeSen(mentah);
      else hasil = benar(0); // voucher "Tanpa voucher"
    }

    if (!hasil.ok) galat.push(`${b.label}: ${hasil.galat}`);
    else setJalur(p, b.jalur, hasil.nilai);
  }

  if (galat.length > 0) return { ok: false, galat };

  // Aturan lintas bidang.
  if (p.diskonCoret.mode === 'pct' && p.diskonCoret.nilai >= 1_000_000) galat.push('Diskon coret harus di bawah 100%.');
  if (p.voucher.mode === 'pct' && p.voucher.nilai >= 1_000_000) galat.push('Voucher persen harus di bawah 100%.');
  if (galat.length > 0) return { ok: false, galat };

  // Turunan dari tipe toko.
  p.tipeLabel = isian.tipeLabel;
  p.tipeToko = isian.tipeLabel === 'ml' ? 'mall' : 'biasa';
  p.pembayaran = { ...p.pembayaran, ppm: isian.tipeLabel === 'ml' ? 18_000 : 0 };

  return { ok: true, pengaturan: p };
}

/* ===============================================================
   Produk <-> isian
=============================================================== */
const OPSI_IKUTI = [['', 'Ikuti pengaturan toko']];

export const SPEK_PRODUK = [
  { id: 'nama', label: 'Nama produk', jenis: 'teks' },
  { id: 'sku', label: 'SKU', jenis: 'teks' },
  { id: 'modal', label: 'Modal per 1 pcs (Rp)', jenis: 'rupiah', bantuan: 'Harga beli dari supplier untuk satu satuan.' },
  { id: 'isiPaket', label: 'Isi paket (pcs)', jenis: 'angka', bantuan: 'Untuk bundle: modal dikali jumlah ini, batas biaya XTRA ikut dikali.' },
  { id: 'kemitraan', label: 'Biaya Management Partner (Rp)', jenis: 'rupiah' },
  { id: 'packing', label: 'Biaya packing (Rp)', jenis: 'rupiah' },
  { id: 'target', label: 'Target untung (Rp)', jenis: 'rupiah' },
  { id: 'stok', label: 'Stok', jenis: 'angka' },
  { kelompok: 'Supplier (opsional)' },
  { id: 'supplier', label: 'Nama supplier', jenis: 'teks' },
  { id: 'linkSupplier', label: 'Link supplier', jenis: 'teks', bantuan: 'Diawali http:// atau https://. Perubahan modal dicatat otomatis di riwayat modal.' },
  { kelompok: 'Tarif khusus produk ini (opsional)' },
  { id: 'kategoriAdmin', label: 'Kategori administrasi', jenis: 'pilih', opsi: [...OPSI_IKUTI, ...OPSI_ADMIN] },
  { id: 'kategoriGo', label: 'Kategori Gratis Ongkir XTRA', jenis: 'pilih', opsi: [...OPSI_IKUTI, ...OPSI_GO] },
  { id: 'ukuran', label: 'Ukuran produk', jenis: 'pilih', opsi: [...OPSI_IKUTI, ['b', 'Biasa'], ['k', 'Khusus (besar atau berat)']] },
];

export function isianProdukKosong() {
  return {
    nama: '', sku: '', modal: '', isiPaket: '1', kemitraan: '0', packing: '0', target: '0', stok: '0',
    supplier: '', linkSupplier: '',
    kategoriAdmin: '', kategoriGo: '', ukuran: '',
  };
}

export function isianDariProduk(baris) {
  const o = baris.override ?? {};
  return {
    nama: baris.nama,
    sku: baris.sku,
    modal: senKeTeks(baris.modalSen),
    isiPaket: String(baris.isiPaket),
    kemitraan: senKeTeks(baris.kemitraanSen),
    packing: senKeTeks(baris.packingSen),
    target: senKeTeks(baris.targetUntungSen),
    stok: String(baris.stok),
    supplier: baris.supplier ?? '',
    linkSupplier: baris.linkSupplier ?? '',
    kategoriAdmin: o.kategoriAdmin ?? '',
    kategoriGo: o.kategoriGo ?? '',
    ukuran: o.ukuran ?? '',
  };
}

// Mengembalikan { ok: true, produk } atau { ok: false, galat: [pesan, ...] }.
export function produkDariIsian(isian) {
  const galat = [];
  const ambil = (label, hasil) => {
    if (!hasil.ok) { galat.push(`${label}: ${hasil.galat}`); return 0; }
    return hasil.nilai;
  };

  const nama = String(isian.nama ?? '').trim();
  const sku = String(isian.sku ?? '').trim();
  if (!nama) galat.push('Nama produk wajib diisi.');
  else if (nama.length > 200) galat.push('Nama produk maksimal 200 karakter.');
  if (!sku) galat.push('SKU wajib diisi.');
  else if (sku.length > 40) galat.push('SKU maksimal 40 karakter.');

  const hasilModal = teksKeSen(isian.modal);
  const modalSen = ambil('Modal', hasilModal);
  if (hasilModal.ok && modalSen <= 0) galat.push('Modal wajib diisi dan harus lebih dari 0.');

  const supplier = String(isian.supplier ?? '').trim();
  if (supplier.length > 100) galat.push('Nama supplier maksimal 100 karakter.');
  const linkSupplier = String(isian.linkSupplier ?? '').trim();
  if (linkSupplier.length > 500) galat.push('Link supplier maksimal 500 karakter.');
  else if (linkSupplier && !/^https?:\/\/\S+$/i.test(linkSupplier)) {
    galat.push('Link supplier harus diawali http:// atau https:// dan tanpa spasi.');
  }

  const produk = {
    nama,
    sku,
    supplier,
    linkSupplier,
    modalSen,
    isiPaket: ambil('Isi paket', teksKeBulat(isian.isiPaket, { min: 1, maks: 10_000 })),
    kemitraanSen: ambil('Biaya Management Partner', teksKeSen(isian.kemitraan)),
    packingSen: ambil('Biaya packing', teksKeSen(isian.packing)),
    targetUntungSen: ambil('Target untung', teksKeSen(isian.target)),
    stok: ambil('Stok', teksKeBulat(isian.stok, { min: 0, maks: 10_000_000 })),
    override: {},
  };

  for (const kunci of ['kategoriAdmin', 'kategoriGo', 'ukuran']) {
    const spek = SPEK_PRODUK.find((b) => b.id === kunci);
    const nilai = isian[kunci] ?? '';
    if (!spek.opsi.some(([v]) => v === nilai)) galat.push(`${spek.label}: pilihan tidak valid`);
    else if (nilai !== '') produk.override[kunci] = nilai;
  }

  return galat.length > 0 ? { ok: false, galat } : { ok: true, produk };
}
