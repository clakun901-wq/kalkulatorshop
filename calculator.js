// calculator.js — mesin hitung harga Kalsara v6 (Fase 3)
//
// Modul MURNI: tanpa DOM, tanpa import, bisa dijalankan di Web Worker maupun Node.
// Port dari rumus fees()/calc() Kalsara v5.82, dengan dua perubahan arsitektur:
//
//  1. Integer Math. Uang = bilangan bulat SEN (rupiah x 100). Persentase = bilangan
//     bulat PPM (1% = 10.000, 100% = 1.000.000). Tidak ada parseFloat dan tidak ada
//     pecahan desimal di jalur hitung. Biaya persen dibulatkan ke RUPIAH PENUH
//     (setengah ke atas), sama seperti v5.82, lalu disimpan dalam sen.
//  2. Pipeline Pattern (Chain of Responsibility). Perhitungan maju (harga -> untung)
//     adalah rantai penangan. Aturan baru Shopee = menyisipkan satu penangan ke
//     PIPA_MAJU, tanpa menyentuh logika pencarian harga.
//
// Belum termasuk (sengaja, bukan Fase 3): voucher otomatis/kartu Promosi (vcBest/vcThr
// di v5.82). Voucher toko manual (persen/nominal) sudah ada.

export const VERSI_KALKULATOR = '6.0.0-fase3';

export const SEN_PER_RUPIAH = 100;
export const PPM_PENUH = 1_000_000; // 100%

/* ===============================================================
   Aritmetika bilangan bulat
=============================================================== */

// floor(a / b) untuk bilangan bulat aman, b > 0 (tanpa risiko pembulatan float).
function lantaiBagi(a, b) {
  let q = Math.floor(a / b);
  const sisa = a - q * b;
  if (sisa < 0) q -= 1;
  else if (sisa >= b) q += 1;
  return q;
}

function langitBagi(a, b) {
  return -lantaiBagi(-a, b);
}

// Biaya persen: round_rupiah(sen * ppm / 1.000.000), setengah ke atas, hasil dalam sen.
export function persenDari(sen, ppm) {
  if (sen <= 0 || ppm <= 0) return 0;
  const total = sen * ppm + 50_000_000;
  if (Number.isSafeInteger(total)) return lantaiBagi(total, 100_000_000) * SEN_PER_RUPIAH;
  return Number((BigInt(sen) * BigInt(ppm) + 50_000_000n) / 100_000_000n) * SEN_PER_RUPIAH;
}

// round(a * b / pembagi) setengah ke atas, a dan b >= 0 (untuk faktor tarif).
function kaliBagiBulat(a, b, pembagi) {
  if (a <= 0 || b <= 0) return 0;
  const setengah = Math.floor(pembagi / 2);
  const total = a * b + setengah;
  if (Number.isSafeInteger(total)) return lantaiBagi(total, pembagi);
  return Number((BigInt(a) * BigInt(b) + BigInt(setengah)) / BigInt(pembagi));
}

// ceil(a * b / pembagi), a dan b >= 0.
function kaliBagiLangit(a, b, pembagi) {
  const total = a * b;
  if (Number.isSafeInteger(total)) return langitBagi(total, pembagi);
  const t = BigInt(a) * BigInt(b);
  const p = BigInt(pembagi);
  return Number((t + p - 1n) / p);
}

/* ===============================================================
   Konversi aman antara teks/angka pengguna dan satuan internal
=============================================================== */

// "6,5" | "6.5" | 6.5  ->  65000 (ppm). Tanpa parseFloat.
export function persenKePpm(nilai) {
  const teks = (typeof nilai === 'number' ? nilai.toFixed(4) : String(nilai))
    .trim()
    .replace(',', '.');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(teks);
  if (!m) throw new Error(`Persentase tidak valid: ${nilai}`);
  const bulat = Number(m[1]) * 10_000;
  const pecahan = (m[2] ?? '').padEnd(5, '0');
  let ppm = bulat + Number(pecahan.slice(0, 4));
  if (Number(pecahan[4]) >= 5) ppm += 1;
  return ppm;
}

export function rupiahKeSen(rupiah) {
  return Math.round(rupiah * SEN_PER_RUPIAH);
}

/* ===============================================================
   Tabel tarif (disalin dari Kalsara v5.82; cocokkan dengan Seller Centre)
   Format: [tarif biasa/non-Mall, tarif Mall] untuk admin,
           [tarif biasa, tarif khusus] untuk Gratis Ongkir XTRA.
=============================================================== */
const ke = (tabel) =>
  Object.fromEntries(Object.entries(tabel).map(([k, v]) => [k, v.map(persenKePpm)]));

export const TABEL_ADMIN = ke({
  A: [10, 11.7], B: [9.5, 10.45], C: [9, 10.2], D: [8.25, 9.95], E: [6.75, 7.7],
  F: [6.5, 7.2], G: [5.25, 6.2], H: [4.25, 4.7], I: [2.5, 2.5],
});

export const TABEL_GRATIS_ONGKIR = ke({
  A: [1, 2.5], B: [2, 3.5], C: [3.5, 5], D: [5.5, 7],
  E: [6, 7.5], F: [6.5, 8], G: [7.5, 9], H: [8, 9.5],
});

// Tarif Gratis Ongkir XTRA yang berlaku mulai tanggal di bawah.
export const TABEL_GRATIS_ONGKIR_2 = ke({
  A: [1.5, 3.5], B: [5, 7], C: [6.5, 8.5], D: [8.5, 10.5],
  E: [9, 11], F: [9.5, 11.5], G: [10.5, 12], H: [11, 13],
});
export const TANGGAL_TABEL_ONGKIR_2 = '2026-12-01';

/* ===============================================================
   Pengaturan bawaan (setara DEF di v5.82), semuanya integer
=============================================================== */
export const PENGATURAN_BAWAAN = Object.freeze({
  tipeToko: 'biasa', // 'biasa' | 'mall'
  biayaProses: { aktif: false, nominalSen: 125_000 },
  pembayaran: { ppm: 0, batasSen: 5_000_000 },
  administrasi: { kategori: 'F', manualPpm: 65_000 }, // kategori 'man' memakai manualPpm
  gratisOngkirXtra: {
    kategori: 'D', // A-H | 'man' | 'none'
    ukuran: 'b', // 'b' biasa | 'k' khusus
    manualPpm: 0,
    faktorPpm: PPM_PENUH, // 1.000.000 = tarif penuh, 500.000 = toko baru setengah tarif
    faktorSampai: '', // 'YYYY-MM-DD'; lewat tanggal ini faktor kembali penuh
    potonganIklanPpm: 0,
    batasBiasaSen: 4_000_000,
    batasKhususSen: 6_000_000,
  },
  promoXtra: { ppm: 0, batasSen: 6_000_000 },
  videoXtra: { ppm: 0, batasSen: 2_000_000 },
  liveXtra: { ppm: 0, batasSen: 2_000_000 },
  premiPpm: 5_000,
  pajakPpm: 5_000,
  iklanPpm: 0,
  returPpm: 0,
  biayaLainSen: 0,
  diskonCoret: { aktif: true, mode: 'pct', nilai: 300_000 }, // pct: ppm | nom: sen
  voucher: { mode: 'none', nilai: 0, batasSen: 0 }, // pct: ppm | nom: sen
  pembulatan: { langkahSen: 10_000, akhiranSen: 0 },
  tabel: null, // { AD: { A: [ppm, ppm] }, GO: { A: [ppm, ppm] } } untuk menimpa tabel
});

const KELOMPOK = [
  'biayaProses', 'pembayaran', 'administrasi', 'gratisOngkirXtra',
  'promoXtra', 'videoXtra', 'liveXtra', 'diskonCoret', 'voucher', 'pembulatan',
];

export function gabungPengaturan(ubah = {}) {
  const hasil = { ...PENGATURAN_BAWAAN };
  for (const [k, v] of Object.entries(ubah ?? {})) {
    hasil[k] = KELOMPOK.includes(k) && v && typeof v === 'object'
      ? { ...PENGATURAN_BAWAAN[k], ...v }
      : v;
  }
  return hasil;
}

/* ===============================================================
   Validasi
=============================================================== */
const bulatTakNegatif = (n) => Number.isSafeInteger(n) && n >= 0;

function galat(kode, pesan) {
  return { ok: false, kode, galat: pesan };
}

function cekProduk(p) {
  if (!p || typeof p !== 'object') return galat('PRODUK_TIDAK_VALID', 'Data produk tidak valid.');
  for (const k of ['modalSen', 'kemitraanSen', 'packingSen', 'targetUntungSen']) {
    if (!bulatTakNegatif(p[k] ?? 0)) {
      return galat('ANGKA_TIDAK_VALID', `${k} harus bilangan bulat sen dan tidak negatif.`);
    }
  }
  if (!bulatTakNegatif(p.isiPaket ?? 0)) {
    return galat('ANGKA_TIDAK_VALID', 'isiPaket harus bilangan bulat dan tidak negatif.');
  }
  if (!(p.modalSen > 0)) return galat('MODAL_KOSONG', 'Modal belum diisi.');
  return null;
}

/* ===============================================================
   Tarif per produk (setara goRate/adRate/capG/rate di v5.82)
=============================================================== */
const ada = (v) => v !== null && v !== undefined;

function faktorGo(p, tanggal) {
  const g = p.gratisOngkirXtra;
  if (g.faktorSampai && tanggal > g.faktorSampai) return PPM_PENUH;
  return g.faktorPpm;
}

function tarifGo(kategori, p, tanggal) {
  const custom = p.tabel?.GO?.[kategori];
  if (tanggal >= TANGGAL_TABEL_ONGKIR_2 && !custom && TABEL_GRATIS_ONGKIR_2[kategori]) {
    return TABEL_GRATIS_ONGKIR_2[kategori];
  }
  return custom ?? TABEL_GRATIS_ONGKIR[kategori];
}

function ppmGratisOngkir(o, p, tanggal) {
  const g = p.gratisOngkirXtra;
  const faktor = faktorGo(p, tanggal);

  if (ada(o.gratisOngkirPpm)) return kaliBagiBulat(o.gratisOngkirPpm, faktor, PPM_PENUH);

  const kategori = tanggal >= TANGGAL_TABEL_ONGKIR_2 && o.kategoriGo2
    ? o.kategoriGo2
    : (o.kategoriGo || g.kategori);
  if (kategori === 'man') return kaliBagiBulat(g.manualPpm, faktor, PPM_PENUH);

  const tarif = tarifGo(kategori, p, tanggal);
  if (!tarif) return 0;
  const ukuran = o.ukuran || g.ukuran;
  const dasar = kaliBagiBulat(tarif[ukuran === 'k' ? 1 : 0], faktor, PPM_PENUH);
  return Math.max(dasar - g.potonganIklanPpm, 0);
}

function ppmAdmin(o, p) {
  if (ada(o.adminPpm)) return o.adminPpm;
  const kategori = o.kategoriAdmin || p.administrasi.kategori;
  const tarif = p.tabel?.AD?.[kategori] ?? TABEL_ADMIN[kategori];
  return tarif ? tarif[p.tipeToko === 'mall' ? 1 : 0] : p.administrasi.manualPpm;
}

function batasGo(khusus, p, tanggal) {
  const g = p.gratisOngkirXtra;
  if (tanggal >= TANGGAL_TABEL_ONGKIR_2) {
    if (khusus ? g.batasKhususSen === 6_000_000 : g.batasBiasaSen === 4_000_000) {
      return khusus ? 8_000_000 : 6_000_000;
    }
  }
  return khusus ? g.batasKhususSen : g.batasBiasaSen;
}

// Satu objek tarif (R) per produk; semua rate dalam ppm, semua batas dalam sen.
export function siapkanTarif(produk, pengaturan, tanggal) {
  const p = pengaturan;
  const o = produk.override ?? {};
  const q = produk.isiPaket > 0 ? produk.isiPaket : 1;
  const khusus = (o.ukuran || p.gratisOngkirXtra.ukuran) === 'k';
  const pilih = (kunci, dasar) => (ada(o[kunci]) ? o[kunci] : dasar);

  return {
    admin: ppmAdmin(o, p),
    gx: ppmGratisOngkir(o, p, tanggal),
    px: pilih('promoXtraPpm', p.promoXtra.ppm),
    vx: pilih('videoXtraPpm', p.videoXtra.ppm),
    lv: pilih('liveXtraPpm', p.liveXtra.ppm),
    pm: pilih('premiPpm', p.premiPpm),
    ads: pilih('iklanPpm', p.iklanPpm),
    rt: pilih('returPpm', p.returPpm),
    pb: p.pembayaran.ppm,
    pj: p.pajakPpm,
    dv: !p.diskonCoret.aktif && !ada(o.diskonCoret) ? 0 : pilih('diskonCoret', p.diskonCoret.nilai),
    dm: p.diskonCoret.mode,
    fx: p.biayaProses.aktif ? p.biayaProses.nominalSen : 0,
    og: p.biayaLainSen,
    cg: batasGo(khusus, p, tanggal) * q,
    cp: p.promoXtra.batasSen * q,
    cvx: p.videoXtra.batasSen * q,
    clv: p.liveXtra.batasSen * q,
    cpb: p.pembayaran.batasSen * q,
    q,
  };
}

/* ===============================================================
   Pipeline Pattern: Chain of Responsibility
   Setiap penangan: (ctx, lanjut) => lanjut({ ...ctx, hasilBaru })
=============================================================== */
export function rantai(...penangan) {
  return (ctxAwal) => {
    let i = -1;
    const lanjut = (ctx) => {
      i += 1;
      return i < penangan.length ? penangan[i](ctx, lanjut) : ctx;
    };
    return lanjut(ctxAwal);
  };
}

function voucherManual(L, v) {
  if (v.mode === 'pct') {
    const potongan = persenDari(L, v.nilai);
    return v.batasSen > 0 ? Math.min(potongan, v.batasSen) : potongan;
  }
  if (v.mode === 'nom') return Math.min(v.nilai, L);
  return 0;
}

const modalTotal = (produk) =>
  produk.modalSen * (produk.isiPaket > 0 ? produk.isiPaket : 1) +
  (produk.kemitraanSen ?? 0) + (produk.packingSen ?? 0);

// Urutan: harga listing -> voucher -> biaya platform -> premi -> pajak -> iklan ->
// retur -> biaya lain -> penerimaan -> untung. Sisipkan penangan baru di sini.
export const PIPA_MAJU = Object.freeze([
  function voucher(ctx, lanjut) {
    const v = voucherManual(ctx.L, ctx.pengaturan.voucher);
    return lanjut({ ...ctx, v, P: ctx.L - v });
  },
  function biayaPlatform(ctx, lanjut) {
    const { R, P } = ctx;
    const b = {
      fx: R.fx,
      ad: persenDari(P, R.admin),
      gx: Math.min(persenDari(P, R.gx), R.cg),
      px: Math.min(persenDari(P, R.px), R.cp),
      vx: Math.min(persenDari(P, R.vx), R.cvx),
      lv: Math.min(persenDari(P, R.lv), R.clv),
      pay: Math.min(persenDari(P, R.pb), R.cpb),
    };
    const sh = b.fx + b.ad + b.gx + b.px + b.vx + b.lv + b.pay;
    return lanjut({ ...ctx, b, sh });
  },
  function premi(ctx, lanjut) {
    return lanjut({ ...ctx, pm: persenDari(ctx.P, ctx.R.pm) });
  },
  function pajak(ctx, lanjut) {
    return lanjut({ ...ctx, tax: persenDari(ctx.P, ctx.R.pj) });
  },
  function iklan(ctx, lanjut) {
    return lanjut({ ...ctx, ads: persenDari(ctx.P, ctx.R.ads) });
  },
  function retur(ctx, lanjut) {
    return lanjut({ ...ctx, rt: persenDari(ctx.P, ctx.R.rt) });
  },
  function biayaLain(ctx, lanjut) {
    return lanjut({ ...ctx, og: ctx.R.og });
  },
  function penerimaan(ctx, lanjut) {
    const s = ctx.P - ctx.sh - ctx.pm - ctx.tax - ctx.ads - ctx.rt - ctx.og;
    return lanjut({ ...ctx, s });
  },
  function untung(ctx, lanjut) {
    return lanjut({ ...ctx, u: ctx.s - ctx.modal });
  },
]);

/* ===============================================================
   Pencarian harga untuk target untung
=============================================================== */
function bangunKonteks(produk, pengaturan, tanggal, pipa = PIPA_MAJU) {
  const R = siapkanTarif(produk, pengaturan, tanggal);
  const jalankan = rantai(...pipa);
  const modal = modalTotal(produk);
  const maju = (L) => jalankan({ L, produk, pengaturan, R, modal });

  const majuDariCoret = (M) => {
    let L;
    if (R.dm === 'nom') L = M - R.dv;
    else L = lantaiBagi(M * (PPM_PENUH - R.dv), PPM_PENUH * SEN_PER_RUPIAH) * SEN_PER_RUPIAH;
    const hasil = maju(Math.max(L, 0));
    hasil.M = M;
    return hasil;
  };

  return { R, modal, maju, majuDariCoret };
}

function keHasil(o, R) {
  return {
    ok: true,
    hargaCoretSen: o.M,
    hargaListingSen: o.L,
    voucherSen: o.v,
    hargaPembeliSen: o.P,
    biaya: {
      prosesSen: o.b.fx,
      adminSen: o.b.ad,
      gratisOngkirXtraSen: o.b.gx,
      promoXtraSen: o.b.px,
      videoXtraSen: o.b.vx,
      liveXtraSen: o.b.lv,
      pembayaranSen: o.b.pay,
      totalPlatformSen: o.sh,
    },
    premiSen: o.pm,
    pajakSen: o.tax,
    iklanSen: o.ads,
    returSen: o.rt,
    biayaLainSen: o.og,
    penerimaanSen: o.s,
    modalSen: o.modal,
    untungSen: o.u,
    tarif: R,
  };
}

// Hitung maju dari harga listing (harga setelah diskon coret, sebelum voucher).
export function hitungMaju(produk, listingSen, pengaturanParsial = {}, tanggal = '1970-01-01', pipa = PIPA_MAJU) {
  const salah = cekProduk(produk);
  if (salah) return salah;
  if (!bulatTakNegatif(listingSen)) return galat('ANGKA_TIDAK_VALID', 'Harga listing harus bilangan bulat sen.');
  const pengaturan = gabungPengaturan(pengaturanParsial);
  const { R, maju } = bangunKonteks(produk, pengaturan, tanggal, pipa);
  const o = maju(listingSen);
  o.M = listingSen;
  return keHasil(o, R);
}

// Cari harga coret terendah (di grid pembulatan) yang mencapai target untung.
export function hitungHarga(produk, pengaturanParsial = {}, tanggal = '1970-01-01', pipa = PIPA_MAJU) {
  const salah = cekProduk(produk);
  if (salah) return salah;

  const p = gabungPengaturan(pengaturanParsial);
  const { R, modal, maju, majuDariCoret } = bangunKonteks(produk, p, tanggal, pipa);
  const target = produk.targetUntungSen ?? 0;

  // 1. Perkiraan harga pembeli minimum: coba semua kombinasi "komponen kena batas
  //    atau tidak", ambil yang terendah (setara loop 1<<5 di v5.82).
  const persenTetap = R.admin + R.pm + R.pj + R.ads + R.rt;
  const K = modal + target + R.og;
  const komponen = [[R.gx, R.cg], [R.px, R.cp], [R.pb, R.cpb], [R.vx, R.cvx], [R.lv, R.clv]];
  let terbaik = Infinity;
  for (let i = 0; i < 1 << komponen.length; i++) {
    let rate = persenTetap;
    let batas = R.fx;
    komponen.forEach(([r, c], j) => {
      if ((i >> j) & 1) batas += c;
      else rate += r;
    });
    if (rate >= PPM_PENUH) return galat('TARIF_100', 'Total tarif 100% atau lebih');
    terbaik = Math.min(terbaik, kaliBagiLangit(K + batas, PPM_PENUH, PPM_PENUH - rate));
  }

  // 2. Naikkan sampai voucher manual tertutup.
  const v = p.voucher;
  if (v.mode === 'pct' && v.nilai >= PPM_PENUH) return galat('VOUCHER_100', 'Voucher 100% tidak valid');
  const P = terbaik;
  let L = P;
  for (let z = 0; z < 400; z++) {
    const L2 = P + voucherManual(L, v);
    if (!(L2 > L)) break;
    L = L2;
  }

  // 3. Harga coret awal sebelum pembulatan.
  let M0;
  if (R.dm === 'nom') M0 = L + R.dv;
  else {
    if (R.dv >= PPM_PENUH) return galat('DISKON_100', 'Diskon coret tidak valid');
    M0 = kaliBagiLangit(L, PPM_PENUH, PPM_PENUH - R.dv);
  }

  // 4. Grid pembulatan (langkah) dan akhiran harga.
  const akhiran = p.pembulatan.akhiranSen || 0;
  const langkah = akhiran > 0 ? 100_000 : (p.pembulatan.langkahSen > 0 ? p.pembulatan.langkahSen : SEN_PER_RUPIAH);
  const batasBawah = akhiran > 0 ? akhiran : langkah;
  let M = akhiran > 0
    ? Math.max(akhiran, langitBagi(M0 - akhiran, 100_000) * 100_000 + akhiran - 300_000)
    : Math.max(langkah, langitBagi(M0, langkah) * langkah - 3 * langkah);

  // 5. Pindai linear 64 langkah, lalu lompat eksponensial + binary search.
  const M0s = M;
  let o;
  let kena = false;
  for (let k = 0; k < 64; k++) {
    o = majuDariCoret(M);
    if (o.u >= target) { kena = true; break; }
    M += langkah;
  }

  if (!kena) {
    let lo = 63;
    let hi = -1;
    let g = 64;
    while (hi < 0) {
      if (g > 19_999) g = 19_999;
      const q0 = majuDariCoret(M0s + g * langkah);
      if (q0.u >= target) { hi = g; o = q0; }
      else {
        lo = g;
        if (g >= 19_999) break;
        g *= 2;
      }
    }
    if (hi < 0) return galat('DI_LUAR_BATAS', 'Target untung di luar batas pencarian harga');
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const qm = majuDariCoret(M0s + mid * langkah);
      if (qm.u >= target) { hi = mid; o = qm; }
      else lo = mid;
    }
    for (let j = Math.max(64, hi - 24); j < hi; j++) {
      const qj = majuDariCoret(M0s + j * langkah);
      if (qj.u >= target) { hi = j; break; }
    }
    M = M0s + hi * langkah;
    o = majuDariCoret(M);
  }

  // 6. Turunkan selama masih mencapai target.
  for (let z = 0; z < 50 && M - langkah >= batasBawah; z++) {
    const q = majuDariCoret(M - langkah);
    if (q.u >= target) { M -= langkah; o = q; }
    else break;
  }

  return keHasil(o, R);
}

// Harga listing terendah yang tidak rugi (untung >= 0), konservatif 5 rupiah ke atas.
export function hargaImpas(produk, pengaturanParsial = {}, tanggal = '1970-01-01', pipa = PIPA_MAJU) {
  const salah = cekProduk(produk);
  if (salah) return salah;

  const p = gabungPengaturan(pengaturanParsial);
  const { maju } = bangunKonteks(produk, p, tanggal, pipa);
  const aman = (rupiah) => {
    for (let k = 0; k <= 5; k++) {
      if (maju((rupiah + k) * SEN_PER_RUPIAH).u < 0) return false;
    }
    return true;
  };

  let hi = 1;
  while (!aman(hi)) {
    hi *= 2;
    if (hi > 1e9) return galat('TIDAK_ADA_IMPAS', 'Harga impas tidak ditemukan.');
  }
  let lo = 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (aman(mid)) hi = mid;
    else lo = mid;
  }
  while (hi > 1 && aman(hi - 1)) hi--;
  return { ok: true, hargaListingSen: hi * SEN_PER_RUPIAH };
}
