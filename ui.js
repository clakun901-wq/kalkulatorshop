// ui.js — lapisan antarmuka Kalsara v6 (Fase 1)
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

/* ---------------------------------------------------------------
   Integer Math: uang disimpan sebagai bilangan bulat "sen" (x100).
   Dibagi 100 hanya saat ditampilkan.
---------------------------------------------------------------- */
const formatBulat = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const formatDesimal = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatRupiah(sen) {
  const bulat = Math.trunc(sen);
  const nilai = bulat / 100; // pembagian hanya untuk tampilan
  return bulat % 100 === 0 ? formatBulat.format(nilai) : formatDesimal.format(nilai);
}

/* ---------------------------------------------------------------
   Gaya kartu: satu CSSStyleSheet dipakai bersama semua instance,
   jadi 1.000 kartu tidak membuat 1.000 salinan CSS.
---------------------------------------------------------------- */
const gayaKartu = new CSSStyleSheet();
gayaKartu.replaceSync(`
  :host {
    display: block;
    contain: content;
  }
  .kartu {
    display: grid;
    gap: 8px;
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
  .harga {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .label-harga {
    margin: 0;
    font-size: 0.75rem;
    color: var(--warna-teks-redup, #5a6b78);
  }
  .harga[data-status="galat"] {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--warna-habis, #b3261e);
  }
  .harga[data-status="menunggu"] {
    font-weight: 400;
    color: var(--warna-teks-redup, #5a6b78);
  }
  .untung {
    margin: 0;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    color: var(--warna-teks-redup, #5a6b78);
  }
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
  .kontrol {
    display: flex;
    gap: 6px;
  }
  .kontrol button {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    font: inherit;
    font-size: 1.125rem;
    border: 1px solid var(--warna-garis, #d5dde3);
    border-radius: var(--radius-kontrol, 6px);
    background: transparent;
    color: var(--warna-teks, #14212b);
    cursor: pointer;
  }
  .kontrol button:focus-visible {
    outline: 3px solid var(--warna-aksen, #12456e);
    outline-offset: 2px;
  }
`);

/* ---------------------------------------------------------------
   <product-card>
   Properti `produk` berisi { id, sku, nama, stok: signal, hitung: signal }.
   `hitung` = { tahap: 'menunggu' | 'ok' | 'galat', hargaSen, untungSen, galat }
   (hasil dari worker kalkulator).
   DOM dibangun sekali; setelah itu tiap effect hanya menyentuh
   satu node teks, sehingga perubahan stok tidak merender ulang kartu.
---------------------------------------------------------------- */
const AMBANG_MENIPIS = 5;

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

  #pasang() {
    this.#lepas();
    const p = this.#produk;
    const akar = this.shadowRoot;

    const elNama = h('h3', { class: 'nama' });
    const elSku = h('p', { class: 'sku' });
    const elLabelHarga = h('p', { class: 'label-harga', text: 'Harga jual ideal' });
    const elHarga = h('p', { class: 'harga' });
    const elUntung = h('p', { class: 'untung' });
    const elStok = h('span', { class: 'stok' });

    const ubahStok = (selisih) => {
      this.dispatchEvent(new CustomEvent('stok-ubah', {
        bubbles: true,
        composed: true,
        detail: { id: p.id, selisih },
      }));
    };

    const tombolKurang = h('button', {
      type: 'button',
      'aria-label': 'Kurangi stok',
      text: '−',
      onClick: () => ubahStok(-1),
    });
    const tombolTambah = h('button', {
      type: 'button',
      'aria-label': 'Tambah stok',
      text: '+',
      onClick: () => ubahStok(1),
    });

    const kartu = h('article', { class: 'kartu' },
      elNama,
      elSku,
      elLabelHarga,
      elHarga,
      elUntung,
      h('div', { class: 'baris-stok' },
        elStok,
        h('div', { class: 'kontrol' }, tombolKurang, tombolTambah),
      ),
    );

    akar.replaceChildren(kartu);

    // Setiap effect hanya melacak signal yang dibacanya.
    elNama.textContent = p.nama;
    elSku.textContent = `SKU ${p.sku}`;

    this.#bersih.push(effect(() => {
      const hasil = p.hitung.value;
      elHarga.dataset.status = hasil.tahap;
      if (hasil.tahap === 'ok') {
        elHarga.textContent = formatRupiah(hasil.hargaSen);
        elUntung.textContent = `Untung ${formatRupiah(hasil.untungSen)}`;
      } else if (hasil.tahap === 'galat') {
        elHarga.textContent = hasil.galat;
        elUntung.textContent = '';
      } else {
        elHarga.textContent = 'Menghitung…';
        elUntung.textContent = '';
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
