// ui.js — lapisan antarmuka Kalsara v6 (Fase 1; kartu diperluas di Fase 6)
// Berisi: re-export Signals, helper pembuat elemen, format uang (Integer Math),
// dan Web Component <product-card>. Tidak ada innerHTML di seluruh file ini.

import {
  signal,
  computed,
  effect,
  batch,
} from 'https://cdn.jsdelivr.net/npm/@preact/signals-core@1.8.0/+esm';

export { signal, computed, effect, batch };

/* ---------------------------------------------------------------
   Helper: pembuat elemen (pengganti innerHTML)
   Semua teks lewat textContent, jadi aman dari injeksi HTML.
---------------------------------------------------------------- */
export function h(tag, props = {}, ...anak) {
  const el = document.createElement(tag);
  for (const [kunci, nilai] of Object.entries(props)) {
    if (nilai === undefined || nilai === null) continue;
    if (kunci === 'class') el.className = nilai;
    else if (kunci === 'text') el.textContent = nilai;
    else if (kunci.startsWith('on') && typeof nilai === 'function') {
      el.addEventListener(kunci.slice(2).toLowerCase(), nilai);
    } else el.setAttribute(kunci, nilai);
  }
  for (const a of anak) {
    if (a === undefined || a === null) continue;
    el.append(a);
  }
  return el;
}

import { formatRupiah, formatPersenPpm } from './format.js';

export { formatRupiah };

/* ---------------------------------------------------------------
   Gaya kartu: satu CSSStyleSheet dipakai bersama semua instance,
   jadi 1.000 kartu tidak membuat 1.000 salinan CSS.
---------------------------------------------------------------- */
const gayaKartu = new CSSStyleSheet();
gayaKartu.replaceSync(`
  *, *::before, *::after { box-sizing: border-box; }
  :host {
    display: block;
    contain: content;
  }
  .kartu {
    display: grid;
    gap: 10px;
    padding: 14px;
    background: var(--warna-permukaan, #fff);
    border: 1px solid var(--warna-garis, #d5dde3);
    border-radius: var(--radius-kartu, 10px);
    color: var(--warna-teks, #14212b);
    font-family: var(--font, system-ui, sans-serif);
  }
  .nama {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .sku {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--warna-teks-redup, #5a6b78);
  }
  .redup { color: var(--warna-teks-redup, #5a6b78); }
  [hidden] { display: none !important; }

  /* Harga */
  .harga2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .harga2 > div { min-width: 0; }
  .label-harga {
    display: block;
    font-size: 0.75rem;
    color: var(--warna-teks-redup, #5a6b78);
  }
  .harga {
    display: block;
    font-size: 1.1875rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .status-hitung {
    margin: 0;
    font-size: 0.875rem;
    color: var(--warna-teks-redup, #5a6b78);
  }
  .status-hitung[data-status="galat"] { color: var(--warna-habis, #b3261e); }

  /* Untung bersih */
  .untung {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-kontrol, 6px);
    border: 1px solid var(--warna-garis, #d5dde3);
    font-weight: 600;
  }
  .untung small { display: block; font-weight: 400; font-size: 0.75rem; color: var(--warna-teks-redup, #5a6b78); }
  .untung b { font-size: 1.125rem; font-variant-numeric: tabular-nums; }
  .untung[data-nada="ok"]  { border-color: var(--warna-aman, #1f7a4d); }
  .untung[data-nada="ok"] b { color: var(--warna-aman, #1f7a4d); }
  .untung[data-nada="bad"] { border-color: var(--warna-habis, #b3261e); }
  .untung[data-nada="bad"] b { color: var(--warna-habis, #b3261e); }

  /* Peringatan */
  .peringatan { display: grid; gap: 6px; }
  .peringatan p {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-kontrol, 6px);
    border: 1px solid var(--warna-menipis, #a66300);
    color: var(--warna-menipis, #a66300);
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .peringatan p[data-tingkat="r"] {
    border-color: var(--warna-habis, #b3261e);
    color: var(--warna-habis, #b3261e);
  }

  /* Grafik */
  .grafik-judul { margin: 0 0 4px; font-size: 0.75rem; color: var(--warna-teks-redup, #5a6b78); }
  .batang {
    display: flex;
    height: 10px;
    overflow: hidden;
    border-radius: 5px;
    background: var(--warna-garis, #d5dde3);
  }
  .batang i { display: block; height: 100%; }
  .batang .modal { background: var(--warna-grafik-modal, #6b8196); }
  .batang .potongan { background: var(--warna-grafik-potongan, #d19a2e); }
  .batang .laba { background: var(--warna-grafik-untung, #1f7a4d); }
  .legenda {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin-top: 6px;
    font-size: 0.75rem;
    color: var(--warna-teks-redup, #5a6b78);
  }
  .legenda s {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 5px;
    border-radius: 50%;
    text-decoration: none;
  }
  .legenda .modal s { background: var(--warna-grafik-modal, #6b8196); }
  .legenda .potongan s { background: var(--warna-grafik-potongan, #d19a2e); }
  .legenda .laba s { background: var(--warna-grafik-untung, #1f7a4d); }

  /* Target untung */
  .target { display: grid; gap: 6px; }
  .target-baris {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.875rem;
  }
  .target-baris b { font-variant-numeric: tabular-nums; }
  .chip { display: flex; gap: 6px; }
  .chip button { flex: 1; min-width: 0; padding: 0 6px; font-size: 0.8125rem; font-weight: 600; }

  /* Bagian lipat */
  details {
    border-top: 1px dashed var(--warna-garis, #d5dde3);
  }
  summary {
    display: flex;
    align-items: center;
    min-height: 44px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--warna-aksen, #12456e);
    cursor: pointer;
  }
  summary::after { content: '▸'; margin-left: auto; padding-left: 8px; }
  details[open] > summary::after { content: '▾'; }
  summary:focus-visible { outline: 3px solid var(--warna-aksen, #12456e); outline-offset: 2px; }
  .isi-lipat { display: grid; gap: 6px; padding-bottom: 8px; }
  .rw {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.8125rem;
  }
  .rw span { min-width: 0; overflow-wrap: anywhere; }
  .rw b { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rw[data-gaya="tebal"] { font-weight: 600; }
  .rw[data-gaya="ok"] b { color: var(--warna-aman, #1f7a4d); }
  .rw[data-gaya="bad"] b { color: var(--warna-habis, #b3261e); }
  .rw small { color: var(--warna-teks-redup, #5a6b78); }
  .petunjuk { margin: 0; font-size: 0.75rem; color: var(--warna-teks-redup, #5a6b78); }
  .kolom-isi {
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    font: inherit;
    font-size: 1rem;
    color: var(--warna-teks, #14212b);
    background: var(--warna-latar, #f3f6f8);
    border: 1px solid var(--warna-garis, #d5dde3);
    border-radius: var(--radius-kontrol, 6px);
  }
  .kolom-isi:focus-visible { outline: 3px solid var(--warna-aksen, #12456e); outline-offset: 2px; }
  a { color: var(--warna-aksen, #12456e); overflow-wrap: anywhere; }

  /* Aksi */
  .aksi { display: flex; justify-content: flex-end; }
  button {
    min-height: 44px;
    padding: 0 14px;
    font: inherit;
    font-size: 0.875rem;
    border: 1px solid var(--warna-aksen, #12456e);
    border-radius: var(--radius-kontrol, 6px);
    background: transparent;
    color: var(--warna-aksen, #12456e);
    cursor: pointer;
  }
  button:focus-visible { outline: 3px solid var(--warna-aksen, #12456e); outline-offset: 2px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .baris-stok {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .stok {
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    color: var(--warna-aman, #1f7a4d);
  }
  .stok[data-status="menipis"] { color: var(--warna-menipis, #a66300); }
  .stok[data-status="habis"]   { color: var(--warna-habis, #b3261e); }
  .kontrol { display: flex; gap: 6px; }
  .kontrol button {
    min-width: 44px;
    padding: 0;
    font-size: 1.125rem;
    border-color: var(--warna-garis, #d5dde3);
    color: var(--warna-teks, #14212b);
  }
`);

/* ---------------------------------------------------------------
   <product-card>
   Properti `produk` berisi:
     { id, sku, nama, supplier, linkSupplier,
       stok: signal, target: signal(sen),
       hitung: signal, rincian: signal, pesaing: signal, riwayat: signal }
   `hitung` = { tahap: 'menunggu' | 'ok' | 'galat', ... } (hasil worker kalkulator):
     ok    -> awalSen (harga listing awal), diskonSen (harga diskon coret), untungSen,
              marginPpm, nada ('ok' | 'bad'), peringatan: { tingkat, pesan[] }, grafik
     galat -> galat
   Peristiwa keluar (bubbles, composed): stok-ubah, produk-ubah, target-ubah,
   rincian-buka, pesaing-hitung, riwayat-buka.
   DOM dibangun sekali; setelah itu tiap effect hanya menyentuh bagiannya sendiri.
---------------------------------------------------------------- */
const AMBANG_MENIPIS = 5;
const JEDA_PESAING_MS = 300;

function barisEl(b) {
  const nilai = b.teks ?? formatRupiah(b.sen);
  const label = h('span', { text: b.label });
  if (b.catatan) label.append(' ', h('small', { text: `(${b.catatan})` }));
  const el = h('div', { class: 'rw' }, label, h('b', { text: nilai }));
  if (b.gaya) el.dataset.gaya = b.gaya;
  return el;
}

function linkAman(teks) {
  return /^https?:\/\/\S+$/i.test(teks ?? '');
}

export class ProductCard extends HTMLElement {
  #produk = null;
  #bersih = [];

  constructor() {
    super();
    const akar = this.attachShadow({ mode: 'open' });
    akar.adoptedStyleSheets = [gayaKartu];
  }

  set produk(nilai) {
    this.#produk = nilai;
    if (this.isConnected) this.#pasang();
  }

  get produk() {
    return this.#produk;
  }

  connectedCallback() {
    if (this.#produk) this.#pasang();
  }

  disconnectedCallback() {
    this.#lepas();
  }

  #lepas() {
    for (const hentikan of this.#bersih) hentikan();
    this.#bersih = [];
  }

  #kirim(nama, detail) {
    this.dispatchEvent(new CustomEvent(nama, { bubbles: true, composed: true, detail }));
  }

  #pasang() {
    this.#lepas();
    const p = this.#produk;
    const akar = this.shadowRoot;
    const kirim = (nama, detail = {}) => this.#kirim(nama, { id: p.id, ...detail });

    /* ---- Kepala ---- */
    const elNama = h('h3', { class: 'nama', text: p.nama });
    const elSku = h('p', { class: 'sku', text: `SKU ${p.sku}` });

    /* ---- Hasil hitung ---- */
    const elStatus = h('p', { class: 'status-hitung', text: 'Menghitung…' });
    const elAwal = h('b', { class: 'harga' });
    const elDiskon = h('b', { class: 'harga' });
    const elUntungNilai = h('b');
    const elMargin = h('small');
    const elUntung = h('div', { class: 'untung' },
      h('span', {}, 'Untung bersih', elMargin),
      elUntungNilai,
    );
    const elPeringatan = h('div', { class: 'peringatan', role: 'status' });
    const elBatang = {
      modal: h('i', { class: 'modal' }),
      potongan: h('i', { class: 'potongan' }),
      laba: h('i', { class: 'laba' }),
    };
    const elLegenda = {
      modal: h('span', { class: 'modal' }, h('s')),
      potongan: h('span', { class: 'potongan' }, h('s')),
      laba: h('span', { class: 'laba' }, h('s')),
    };
    const teksLegenda = { modal: document.createTextNode(''), potongan: document.createTextNode(''), laba: document.createTextNode('') };
    for (const k of Object.keys(elLegenda)) elLegenda[k].append(teksLegenda[k]);
    const elGrafik = h('div', { class: 'grafik' },
      h('p', { class: 'grafik-judul', text: 'Ke mana harga jual pergi' }),
      h('div', { class: 'batang', 'aria-hidden': 'true' }, elBatang.modal, elBatang.potongan, elBatang.laba),
      h('div', { class: 'legenda' }, elLegenda.modal, elLegenda.potongan, elLegenda.laba),
    );
    const elHasil = h('div', { class: 'hasil', hidden: '' },
      h('div', { class: 'harga2' },
        h('div', {}, h('span', { class: 'label-harga', text: 'Harga listing awal' }), elAwal),
        h('div', {}, h('span', { class: 'label-harga', text: 'Harga diskon coret' }), elDiskon),
      ),
    );
    elHasil.style.display = 'grid';
    elHasil.style.gap = '10px';
    elHasil.append(elUntung, elPeringatan, elGrafik);

    /* ---- Target untung ---- */
    const elTarget = h('b');
    const tombolTarget = (teks, label, detail) => h('button', {
      type: 'button',
      class: 'sekunder',
      'aria-label': label,
      text: teks,
      onClick: () => kirim('target-ubah', detail),
    });
    const blokTarget = h('div', { class: 'target' },
      h('div', { class: 'target-baris' }, h('span', { class: 'redup', text: 'Target untung' }), elTarget),
      h('div', { class: 'chip' },
        tombolTarget('+1.000', 'Tambah target untung 1.000', { tambahSen: 100_000 }),
        tombolTarget('+5.000', 'Tambah target untung 5.000', { tambahSen: 500_000 }),
        tombolTarget('Reset', 'Kosongkan target untung', { reset: true }),
      ),
    );

    /* ---- Rincian biaya ---- */
    const elIsiRincian = h('div', { class: 'isi-lipat' });
    const detRincian = h('details', {}, h('summary', { text: 'Lihat rincian biaya' }), elIsiRincian);
    detRincian.addEventListener('toggle', () => { if (detRincian.open) kirim('rincian-buka'); });

    /* ---- Cek harga pesaing ---- */
    const kolomPesaing = h('input', {
      type: 'text',
      class: 'kolom-isi',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: '0',
      'aria-label': 'Harga diskon coret yang ingin dicek (Rp)',
    });
    const elHasilPesaing = h('div', { class: 'isi-lipat' });
    const detPesaing = h('details', {},
      h('summary', { text: 'Cek harga pesaing (hitung terbalik)' }),
      h('div', { class: 'isi-lipat' },
        h('p', { class: 'petunjuk', text: 'Masukkan harga diskon coret yang ingin dicek, misalnya harga pesaing. Hasilnya untung Anda di harga itu.' }),
        kolomPesaing,
      ),
      elHasilPesaing,
    );
    let waktuPesaing = 0;
    kolomPesaing.addEventListener('input', () => {
      clearTimeout(waktuPesaing);
      waktuPesaing = setTimeout(() => kirim('pesaing-hitung', { teks: kolomPesaing.value }), JEDA_PESAING_MS);
    });
    this.#bersih.push(() => clearTimeout(waktuPesaing));

    /* ---- Supplier dan riwayat modal ---- */
    const elInfoSupplier = h('div', { class: 'isi-lipat' });
    const elRiwayat = h('div', { class: 'isi-lipat' });
    const detSupplier = h('details', {},
      h('summary', { text: 'Supplier dan riwayat modal' }),
      elInfoSupplier,
      elRiwayat,
    );
    detSupplier.addEventListener('toggle', () => { if (detSupplier.open) kirim('riwayat-buka'); });

    /* ---- Stok dan aksi ---- */
    const elStok = h('span', { class: 'stok' });
    const tombolKurang = h('button', {
      type: 'button',
      'aria-label': 'Kurangi stok',
      text: '−',
      onClick: () => kirim('stok-ubah', { selisih: -1 }),
    });
    const tombolTambah = h('button', {
      type: 'button',
      'aria-label': 'Tambah stok',
      text: '+',
      onClick: () => kirim('stok-ubah', { selisih: 1 }),
    });
    const tombolUbah = h('button', {
      type: 'button',
      text: 'Ubah produk',
      onClick: () => kirim('produk-ubah'),
    });

    const kartu = h('article', { class: 'kartu' },
      elNama,
      elSku,
      elStatus,
      elHasil,
      blokTarget,
      detRincian,
      detPesaing,
      detSupplier,
      h('div', { class: 'baris-stok' },
        elStok,
        h('div', { class: 'kontrol' }, tombolKurang, tombolTambah),
      ),
      h('div', { class: 'aksi' }, tombolUbah),
    );
    akar.replaceChildren(kartu);

    /* ---- Effect: tiap effect hanya melacak signal yang dibacanya ---- */
    this.#bersih.push(effect(() => {
      const hasil = p.hitung.value;
      elStatus.dataset.status = hasil.tahap;
      if (hasil.tahap === 'ok') {
        elStatus.hidden = true;
        elHasil.hidden = false;
        elAwal.textContent = formatRupiah(hasil.awalSen);
        elDiskon.textContent = formatRupiah(hasil.diskonSen);
        elUntung.dataset.nada = hasil.nada;
        elUntungNilai.textContent = formatRupiah(hasil.untungSen);
        elMargin.textContent = `Margin ${formatPersenPpm(hasil.marginPpm)}%`;
        elPeringatan.replaceChildren(...hasil.peringatan.pesan.map((teks, i) => {
          const el = h('p', { text: `⚠ ${teks}` });
          el.dataset.tingkat = i === 0 ? hasil.peringatan.tingkat : 'y';
          return el;
        }));
        const g = hasil.grafik;
        elGrafik.hidden = g === null;
        if (g) {
          elBatang.modal.style.width = `${g.lebarModal / 10}%`;
          elBatang.potongan.style.width = `${g.lebarPotongan / 10}%`;
          elBatang.laba.style.width = `${g.lebarUntung / 10}%`;
          teksLegenda.modal.data = `Modal ${g.modalPersen}%`;
          teksLegenda.potongan.data = `Potongan ${g.potonganPersen}%`;
          teksLegenda.laba.data = `Untung ${g.untungPersen}%`;
        }
      } else {
        elHasil.hidden = true;
        elStatus.hidden = false;
        elStatus.textContent = hasil.tahap === 'galat' ? hasil.galat : 'Menghitung…';
      }
    }));

    this.#bersih.push(effect(() => {
      elTarget.textContent = formatRupiah(p.target.value);
    }));

    this.#bersih.push(effect(() => {
      const r = p.rincian.value;
      if (r === null) {
        elIsiRincian.replaceChildren(h('p', { class: 'petunjuk', text: 'Buka bagian ini untuk melihat rincian.' }));
      } else if (r.tahap === 'memuat') {
        elIsiRincian.replaceChildren(h('p', { class: 'petunjuk', text: 'Menghitung rincian…' }));
      } else if (r.tahap === 'galat') {
        elIsiRincian.replaceChildren(h('p', { class: 'petunjuk', text: r.galat }));
      } else {
        elIsiRincian.replaceChildren(...r.baris.map(barisEl));
      }
    }));

    this.#bersih.push(effect(() => {
      const r = p.pesaing.value;
      if (r === null) {
        elHasilPesaing.replaceChildren();
      } else if (r.tahap === 'galat') {
        elHasilPesaing.replaceChildren(h('p', { class: 'petunjuk', text: r.galat }));
      } else {
        const anak = [h('div', { class: 'rw' }, h('span', { text: 'Harga jual yang dicek' }), h('b', { text: formatRupiah(r.hargaSen) })),
          ...r.baris.map(barisEl)];
        if (r.selisihImpasSen !== null) {
          const d = r.selisihImpasSen;
          anak.push(barisEl({
            label: 'Selisih dari harga impas',
            teks: d >= 0 ? `${formatRupiah(d)} di atas` : `${formatRupiah(-d)} di bawah`,
          }));
        }
        for (const [i, teks] of r.peringatan.pesan.entries()) {
          const el = h('p', { text: `⚠ ${teks}` });
          el.dataset.tingkat = i === 0 ? r.peringatan.tingkat : 'y';
          anak.push(h('div', { class: 'peringatan' }, el));
        }
        elHasilPesaing.replaceChildren(...anak);
      }
    }));

    this.#bersih.push(effect(() => {
      const riwayat = p.riwayat.value;
      const info = [];
      info.push(barisEl({ label: 'Supplier', teks: p.supplier || '-' }));
      if (linkAman(p.linkSupplier)) {
        info.push(h('a', { href: p.linkSupplier, target: '_blank', rel: 'noopener noreferrer', text: 'Buka link supplier' }));
      }
      if (!p.supplier && !p.linkSupplier) {
        info.push(h('p', { class: 'petunjuk', text: 'Belum diisi. Isi lewat tombol "Ubah produk".' }));
      }
      elInfoSupplier.replaceChildren(...info);

      if (riwayat === null) {
        elRiwayat.replaceChildren();
      } else if (riwayat.length === 0) {
        elRiwayat.replaceChildren(h('p', { class: 'petunjuk', text: 'Belum ada perubahan modal.' }));
      } else {
        elRiwayat.replaceChildren(
          h('p', { class: 'petunjuk', text: 'Riwayat modal (terbaru di atas)' }),
          ...riwayat.map((r) => h('div', { class: 'rw' }, h('span', { text: r.teks }))),
        );
      }
    }));

    this.#bersih.push(effect(() => {
      const stok = p.stok.value;
      elStok.textContent = stok === 0 ? 'Stok habis' : `Stok ${stok}`;
      elStok.dataset.status =
        stok === 0 ? 'habis' : stok <= AMBANG_MENIPIS ? 'menipis' : 'aman';
      tombolKurang.disabled = stok === 0;
    }));
  }
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}
