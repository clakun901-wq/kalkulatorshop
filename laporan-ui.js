// laporan-ui.js — tampilan tab Laporan Kalsara v6 (Fase 8)
//
// Semua pembaruan DOM lewat effect Signals + h() (tanpa innerHTML). Data diambil dari
// db.worker.js, jadi utas utama tidak memegang ribuan baris penjualan.
// Satu-satunya yang MENULIS adalah "Hapus catatan lama" (dua langkah + gembok).

import { signal, effect, batch, h, formatRupiah } from './ui.js';
import { formatPersenPpm, formatTanggalPendek } from './format.js';
import { db } from './db.js';
import { LAMA_GEMBOK_MS, awalHari } from './etalase.js';
import {
  PERIODE, rentangPeriode, rentangTanggal, bacaTanggal, teksTanggal, marginPpm, bangunCsv, namaBerkasCsv,
  hariJendela, hariSisa, teksSisa, HARI_JENDELA_MAKS,
} from './laporan.js';

const BATAS_DAFTAR = 25;
const BATAS_PRODUK = 10;
const angka = (n) => n.toLocaleString('id-ID');
const dua = (n) => String(n).padStart(2, '0');
const teksUntung = (sen) => `${sen < 0 ? 'Rugi' : 'Untung'} ${formatRupiah(Math.abs(sen))}`;

export function pasangLaporan({ tampilkanPesan }) {
  const $ = (id) => document.getElementById(id);
  const elPeriode = $('periode-laporan');
  const elUrut = $('urut-laporan');
  const elBebas = $('tanggal-bebas');
  const elDari = $('tanggal-dari');
  const elSampai = $('tanggal-sampai');
  const elRingkas = $('ringkas-laporan');
  const elProduk = $('produk-laporan');
  const elPerkiraan = $('perkiraan-stok');
  const elDaftar = $('daftar-penjualan');
  const elInfo = $('info-halaman-laporan');
  const btnSebelum = $('btn-sebelumnya-laporan');
  const btnBerikut = $('btn-berikutnya-laporan');
  const btnEkspor = $('btn-ekspor');
  const btnGembok = $('btn-gembok-laporan');
  const elTanggalHapus = $('tanggal-hapus');
  const btnHapus = $('btn-hapus-lama');
  const elKonfirmasi = $('konfirmasi-hapus');
  const elTeksKonfirmasi = $('teks-konfirmasi');
  const btnYa = $('btn-ya-hapus');
  const btnBatal = $('btn-batal-hapus');

  elPeriode.replaceChildren(
    ...PERIODE.map(([nilai, teks]) => h('option', { value: nilai, text: teks })),
    h('option', { value: 'kustom', text: 'Pilih tanggal' }),
  );
  elTanggalHapus.max = teksTanggal(Date.now());

  const periode = signal('hari');
  const urut = signal('untung');
  const halaman = signal(0);
  const ringkas = signal(null); // { jumlah, omzetSen, untungSen, jumlahRugi } atau null sebelum dimuat
  const produk = signal([]);
  const perkiraan = signal(null); // { hari, baris: [{ sku, nama, stok, terjual, sisa }] } atau null
  const daftar = signal({ baris: [], total: 0 });
  const sibuk = signal(false);
  const gembokTerbuka = signal(false);
  const konfirmasi = signal(null); // { sebelum, jumlah, untungSen, tanggal } atau null
  let nomor = 0;

  // Rentang yang sedang dipilih; melempar galat bila tanggal bebas belum valid.
  function rentangSaatIni() {
    return periode.peek() === 'kustom' ? rentangTanggal(elDari.value, elSampai.value) : rentangPeriode(periode.peek());
  }

  async function muat() {
    const saya = ++nomor;
    const r = rentangSaatIni();
    const sekarang = Date.now();
    const jendela = rentangPeriode('30hari', sekarang);
    const [rk, pr, dp, laju] = await Promise.all([
      db.laporanRingkas(r),
      db.laporanProduk({ ...r, batas: BATAS_PRODUK, urut: urut.peek() }),
      db.daftarPenjualan({ ...r, batas: BATAS_DAFTAR, offset: halaman.peek() * BATAS_DAFTAR }),
      db.lajuPenjualan({ ...jendela, batas: BATAS_PRODUK }),
    ]);
    if (saya !== nomor) return;
    const terakhir = Math.max(0, Math.ceil(dp.total / BATAS_DAFTAR) - 1);
    if (halaman.peek() > terakhir) { halaman.value = terakhir; return muat(); }
    const hari = hariJendela(sekarang, laju.pertama);
    const barisPerkiraan = laju.produk.map((p) => ({ ...p, sisa: hariSisa(p.stok, p.terjual, hari) }));
    batch(() => { ringkas.value = rk; produk.value = pr; daftar.value = dp; perkiraan.value = { hari, baris: barisPerkiraan }; });
  }
  const muatAman = () => muat().catch((e) => tampilkanPesan(e?.message ?? String(e), 'galat'));

  /* ---------------- Render ---------------- */
  effect(() => {
    const r = ringkas.value;
    if (!r) { elRingkas.replaceChildren(); return; }
    if (r.jumlah === 0) {
      elRingkas.replaceChildren(h('li', { class: 'kosong', text: 'Belum ada penjualan tercatat pada periode ini.' }));
      return;
    }
    const margin = marginPpm(r.untungSen, r.omzetSen);
    const butir = (label, nilai, kelas = '') => h('li', {}, h('span', { class: 'label', text: label }), h('strong', { class: kelas, text: nilai }));
    const baris = [
      butir('Terjual', `${angka(r.jumlah)} pcs`),
      butir('Omzet', formatRupiah(r.omzetSen)),
      butir(r.untungSen < 0 ? 'Rugi bersih' : 'Untung', formatRupiah(Math.abs(r.untungSen)), r.untungSen < 0 ? 'rugi' : 'untung'),
      butir('Margin rata-rata', margin === null ? '-' : `${formatPersenPpm(margin)}%`),
    ];
    if (r.jumlahRugi > 0) baris.push(butir('Penjualan rugi', `${angka(r.jumlahRugi)} kali`, 'rugi'));
    elRingkas.replaceChildren(...baris);
  });

  effect(() => {
    const daftarProduk = produk.value;
    elProduk.replaceChildren(...daftarProduk.map((p, i) => h('li', { class: 'baris-laporan' },
      h('div', { class: 'utama' },
        h('span', { class: 'urutan', text: `${i + 1}.` }),
        h('span', { class: 'nama', text: p.nama }),
      ),
      h('div', { class: 'rinci' },
        h('span', { text: `SKU ${p.sku}` }),
        h('span', { text: `Terjual ${angka(p.terjual)}` }),
        h('span', { class: p.untungSen < 0 ? 'rugi' : 'untung', text: teksUntung(p.untungSen) }),
        h('span', { text: p.stok === null ? 'Produk sudah dihapus' : `Stok ${angka(p.stok)}` }),
      ),
    )));
  });

  effect(() => {
    const p = perkiraan.value;
    if (!p) { elPerkiraan.replaceChildren(); return; }
    if (p.baris.length === 0) {
      elPerkiraan.replaceChildren(h('li', { class: 'kosong', text: `Belum ada penjualan dalam ${HARI_JENDELA_MAKS} hari terakhir, jadi belum ada yang bisa diperkirakan.` }));
      return;
    }
    elPerkiraan.replaceChildren(...p.baris.map((b) => h('li', { class: 'baris-laporan' },
      h('div', { class: 'utama' }, h('span', { class: 'nama', text: b.nama })),
      h('div', { class: 'rinci' },
        h('span', { text: `SKU ${b.sku}` }),
        h('span', { text: `Stok ${angka(b.stok)}` }),
        h('span', { text: `Terjual ${angka(b.terjual)} dalam ${p.hari} hari` }),
        h('span', { class: b.sisa !== null && b.sisa <= 7 ? 'rugi' : '', text: b.stok <= 0 ? 'Stok habis' : `Habis ± ${teksSisa(b.sisa)}` }),
      ),
    )));
  });

  effect(() => {
    const { baris, total } = daftar.value;
    if (baris.length === 0) {
      elDaftar.replaceChildren(...(ringkas.value ? [h('li', { class: 'kosong', text: 'Tidak ada penjualan untuk ditampilkan.' })] : []));
    } else {
      elDaftar.replaceChildren(...baris.map((b) => {
        const d = new Date(b.dicatatPada);
        return h('li', { class: 'baris-laporan' },
          h('div', { class: 'utama' }, h('span', { class: 'nama', text: b.nama })),
          h('div', { class: 'rinci' },
            h('span', { text: `${formatTanggalPendek(b.dicatatPada)} ${dua(d.getHours())}:${dua(d.getMinutes())}` }),
            h('span', { text: `SKU ${b.sku}` }),
            h('span', { text: formatRupiah(b.hargaSen) }),
            h('span', { class: b.untungSen < 0 ? 'rugi' : 'untung', text: teksUntung(b.untungSen) }),
          ),
        );
      }));
    }
    const nomorHalaman = halaman.value + 1;
    const jumlahHalaman = Math.max(1, Math.ceil(total / BATAS_DAFTAR));
    elInfo.textContent = ringkas.value ? `Halaman ${nomorHalaman} dari ${jumlahHalaman} · ${angka(total)} penjualan` : '';
    btnSebelum.disabled = halaman.value === 0;
    btnBerikut.disabled = nomorHalaman >= jumlahHalaman;
  });

  effect(() => {
    btnEkspor.disabled = sibuk.value || !ringkas.value || ringkas.value.jumlah === 0;
  });

  effect(() => {
    const terbuka = gembokTerbuka.value;
    btnGembok.textContent = terbuka ? 'Gembok terbuka' : 'Buka gembok';
    btnGembok.setAttribute('aria-pressed', String(terbuka));
    // aria-disabled (bukan disabled) supaya ketukan tetap sampai dan bisa memberi pesan "Terkunci".
    btnHapus.setAttribute('aria-disabled', String(!terbuka || sibuk.value));
    const k = konfirmasi.value;
    elKonfirmasi.hidden = k === null;
    if (k) {
      elTeksKonfirmasi.textContent =
        `${angka(k.jumlah)} catatan sebelum ${k.tanggal} (${k.untungSen < 0 ? 'rugi' : 'untung'} total ${formatRupiah(Math.abs(k.untungSen))}) ` +
        'akan dihapus permanen. Stok produk tidak berubah.';
    }
    btnYa.disabled = sibuk.value;
  });

  /* ---------------- Aksi: periode, urutan, halaman ---------------- */
  elPeriode.addEventListener('change', () => {
    periode.value = elPeriode.value;
    halaman.value = 0;
    elBebas.hidden = periode.peek() !== 'kustom';
    if (periode.peek() === 'kustom') {
      const hariIni = teksTanggal(Date.now());
      if (!elDari.value) elDari.value = hariIni;
      if (!elSampai.value) elSampai.value = hariIni;
    }
    muatAman();
  });
  const bacaTanggalBebas = () => { halaman.value = 0; muatAman(); };
  elDari.addEventListener('change', bacaTanggalBebas);
  elSampai.addEventListener('change', bacaTanggalBebas);
  elUrut.addEventListener('change', () => {
    urut.value = elUrut.value === 'terjual' ? 'terjual' : 'untung';
    muatAman();
  });
  btnSebelum.addEventListener('click', () => { if (halaman.peek() > 0) { halaman.value -= 1; muatAman(); } });
  btnBerikut.addEventListener('click', () => { halaman.value += 1; muatAman(); });

  /* ---------------- Aksi: ekspor ---------------- */
  btnEkspor.addEventListener('click', async () => {
    if (sibuk.peek()) return;
    sibuk.value = true;
    try {
      const baris = await db.semuaPenjualan(rentangSaatIni());
      if (baris.length === 0) { tampilkanPesan('Belum ada penjualan pada periode ini.'); return; }
      const blob = new Blob(['\uFEFF', bangunCsv(baris)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const nama = namaBerkasCsv(periode.peek(), Date.now(), { dari: elDari.value, sampai: elSampai.value });
      const tautan = h('a', { href: url, download: nama });
      document.body.append(tautan);
      tautan.click();
      tautan.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      tampilkanPesan(`${angka(baris.length)} penjualan diekspor ke berkas CSV.`);
    } catch (e) {
      tampilkanPesan(e?.message ?? String(e), 'galat');
    } finally {
      sibuk.value = false;
    }
  });

  /* ---------------- Aksi: hapus catatan lama ---------------- */
  let waktuGembok = 0;
  function kunci() {
    clearTimeout(waktuGembok);
    batch(() => { gembokTerbuka.value = false; konfirmasi.value = null; });
  }
  btnGembok.addEventListener('click', () => {
    if (gembokTerbuka.peek()) { kunci(); return; }
    gembokTerbuka.value = true;
    clearTimeout(waktuGembok);
    waktuGembok = setTimeout(() => { if (!konfirmasi.peek()) gembokTerbuka.value = false; }, LAMA_GEMBOK_MS);
  });

  btnHapus.addEventListener('click', async () => {
    if (!gembokTerbuka.peek()) { tampilkanPesan('Terkunci. Ketuk gembok dulu untuk membuka tombol hapus.', 'galat'); return; }
    if (sibuk.peek()) return;
    const sebelum = bacaTanggal(elTanggalHapus.value);
    if (sebelum === null) { tampilkanPesan('Pilih tanggal batas dulu.', 'galat'); return; }
    if (sebelum > awalHari(Date.now())) { tampilkanPesan('Tanggal batas tidak boleh di masa depan.', 'galat'); return; }
    sibuk.value = true;
    try {
      const { jumlah, untungSen } = await db.hitungPenjualanSebelum(sebelum);
      if (jumlah === 0) { tampilkanPesan('Tidak ada catatan sebelum tanggal itu.'); return; }
      // Konfirmasi tidak ikut terkunci waktu: pengguna perlu waktu membaca. Batal atau pindah tab membatalkannya.
      clearTimeout(waktuGembok);
      konfirmasi.value = { sebelum, jumlah, untungSen, tanggal: elTanggalHapus.value };
    } catch (e) {
      tampilkanPesan(e?.message ?? String(e), 'galat');
    } finally {
      sibuk.value = false;
    }
  });

  btnBatal.addEventListener('click', kunci);

  btnYa.addEventListener('click', async () => {
    const k = konfirmasi.peek();
    if (!k || sibuk.peek()) return;
    sibuk.value = true;
    try {
      const { dihapus } = await db.hapusPenjualanSebelum(k.sebelum, k.jumlah);
      kunci();
      tampilkanPesan(`${angka(dihapus)} catatan penjualan lama dihapus.`);
      halaman.value = 0;
      await muat();
    } catch (e) {
      kunci();
      tampilkanPesan(e?.message ?? String(e), 'galat');
    } finally {
      sibuk.value = false;
    }
  });

  return { muat, kunci };
}
