// laporan-ui.js — tampilan tab Laporan Kalsara v6 (Fase 8)
//
// Semua pembaruan DOM lewat effect Signals + h() (tanpa innerHTML). Data diambil dari
// db.worker.js (hanya membaca), jadi utas utama tidak memegang ribuan baris penjualan.

import { signal, effect, batch, h, formatRupiah } from './ui.js';
import { formatPersenPpm, formatTanggalPendek } from './format.js';
import { db } from './db.js';
import { PERIODE, rentangPeriode, marginPpm, bangunCsv, namaBerkasCsv } from './laporan.js';

const BATAS_DAFTAR = 25;
const BATAS_PRODUK = 10;
const angka = (n) => n.toLocaleString('id-ID');
const dua = (n) => String(n).padStart(2, '0');
const teksUntung = (sen) => `${sen < 0 ? 'Rugi' : 'Untung'} ${formatRupiah(Math.abs(sen))}`;

export function pasangLaporan({ tampilkanPesan }) {
  const $ = (id) => document.getElementById(id);
  const elPeriode = $('periode-laporan');
  const elUrut = $('urut-laporan');
  const elRingkas = $('ringkas-laporan');
  const elProduk = $('produk-laporan');
  const elDaftar = $('daftar-penjualan');
  const elInfo = $('info-halaman-laporan');
  const btnSebelum = $('btn-sebelumnya-laporan');
  const btnBerikut = $('btn-berikutnya-laporan');
  const btnEkspor = $('btn-ekspor');

  elPeriode.replaceChildren(...PERIODE.map(([nilai, teks]) => h('option', { value: nilai, text: teks })));

  const periode = signal('hari');
  const urut = signal('untung');
  const halaman = signal(0);
  const ringkas = signal(null); // { jumlah, omzetSen, untungSen, jumlahRugi } atau null sebelum dimuat
  const produk = signal([]);
  const daftar = signal({ baris: [], total: 0 });
  const sibuk = signal(false);
  let nomor = 0;

  async function muat() {
    const saya = ++nomor;
    const r = rentangPeriode(periode.peek());
    const [rk, pr, dp] = await Promise.all([
      db.laporanRingkas(r),
      db.laporanProduk({ ...r, batas: BATAS_PRODUK, urut: urut.peek() }),
      db.daftarPenjualan({ ...r, batas: BATAS_DAFTAR, offset: halaman.peek() * BATAS_DAFTAR }),
    ]);
    if (saya !== nomor) return;
    const terakhir = Math.max(0, Math.ceil(dp.total / BATAS_DAFTAR) - 1);
    if (halaman.peek() > terakhir) { halaman.value = terakhir; return muat(); }
    batch(() => { ringkas.value = rk; produk.value = pr; daftar.value = dp; });
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
    elRingkas.replaceChildren(
      butir('Terjual', `${angka(r.jumlah)} pcs`),
      butir('Omzet', formatRupiah(r.omzetSen)),
      butir(r.untungSen < 0 ? 'Rugi bersih' : 'Untung', formatRupiah(Math.abs(r.untungSen)), r.untungSen < 0 ? 'rugi' : 'untung'),
      butir('Margin rata-rata', margin === null ? '-' : `${formatPersenPpm(margin)}%`),
      r.jumlahRugi > 0 ? butir('Penjualan rugi', `${angka(r.jumlahRugi)} kali`, 'rugi') : null,
    );
  });

  effect(() => {
    const daftarProduk = produk.value;
    if (daftarProduk.length === 0) { elProduk.replaceChildren(); return; }
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
    const { baris, total } = daftar.value;
    if (baris.length === 0) {
      elDaftar.replaceChildren(ringkas.value ? h('li', { class: 'kosong', text: 'Tidak ada penjualan untuk ditampilkan.' }) : null);
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

  /* ---------------- Aksi ---------------- */
  elPeriode.addEventListener('change', () => {
    periode.value = elPeriode.value;
    halaman.value = 0;
    muatAman();
  });
  elUrut.addEventListener('change', () => {
    urut.value = elUrut.value === 'terjual' ? 'terjual' : 'untung';
    muatAman();
  });
  btnSebelum.addEventListener('click', () => { if (halaman.peek() > 0) { halaman.value -= 1; muatAman(); } });
  btnBerikut.addEventListener('click', () => { halaman.value += 1; muatAman(); });

  btnEkspor.addEventListener('click', async () => {
    if (sibuk.peek()) return;
    sibuk.value = true;
    try {
      const baris = await db.semuaPenjualan(rentangPeriode(periode.peek()));
      if (baris.length === 0) { tampilkanPesan('Belum ada penjualan pada periode ini.'); return; }
      const blob = new Blob(['\uFEFF', bangunCsv(baris)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const tautan = h('a', { href: url, download: namaBerkasCsv(periode.peek()) });
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

  return { muat };
}
