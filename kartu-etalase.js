// kartu-etalase.js — Web Component <etalase-card> (Fase 7)
//
// Satu kartu = satu produk yang tampil di tab Etalase, terisolasi dengan Shadow DOM.
// Tidak ada innerHTML. DOM dibangun sekali; tiap effect hanya menyentuh bagiannya sendiri.
//
// Properti:
//   item    = { id, sku, nama, stok: signal(pcs), hitung: signal }
//             hitung = { tahap: 'menunggu' | 'ok' | 'galat', diskonSen, untungSen, nada, galat }
//   konteks = { versiGembok: signal(angka), terbuka(id) -> boolean }
// Peristiwa keluar (bubbles, composed):
//   gembok-ketuk {id}, penjualan-catat {id}, stok-tambah {id}, stok-atur {id, stok},
//   stok-tidak-valid {id}, buka-di-hitung {id, sku}
// Kartu TIDAK memutuskan apa pun soal gembok: ia hanya menampilkan dan melapor. app.js yang
// memeriksa gembok (sumber kebenaran tunggal) sebelum mengubah stok atau mencatat penjualan.

import { effect, h, formatRupiah } from './ui.js';
import { formatPersenPpm } from './format.js';
import { statusStok, LABEL_STATUS, bacaStok } from './etalase.js';

const gaya = new CSSStyleSheet();
gaya.replaceSync(`
  *, *::before, *::after { box-sizing: border-box; }
  :host { display: block; contain: content; }
  [hidden] { display: none !important; }
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
  .nama-tombol {
    min-height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .nama-tombol:focus-visible { outline: 3px solid var(--warna-aksen, #12456e); outline-offset: 2px; }
  .sku { margin: -6px 0 0; font-size: 0.8125rem; color: var(--warna-teks-redup, #5a6b78); }
  .status-hitung { margin: 0; font-size: 0.875rem; color: var(--warna-teks-redup, #5a6b78); }
  .status-hitung[data-status="galat"] { color: var(--warna-habis, #b3261e); }
  .harga2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .harga2 > div { min-width: 0; }
  .label { display: block; font-size: 0.75rem; color: var(--warna-teks-redup, #5a6b78); }
  .nilai { display: block; font-size: 1.125rem; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .nilai[data-nada="ok"] { color: var(--warna-aman, #1f7a4d); }
  .nilai[data-nada="bad"] { color: var(--warna-habis, #b3261e); }
  .margin { font-size: 0.75rem; font-weight: 400; color: var(--warna-teks-redup, #5a6b78); }

  .baris-stok { display: grid; gap: 8px; }
  .kepala-stok { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .gembok {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--warna-garis, #d5dde3);
    border-radius: var(--radius-kontrol, 6px);
    background: transparent;
    color: var(--warna-teks-redup, #5a6b78);
    cursor: pointer;
  }
  .gembok[aria-pressed="true"] { border-color: var(--warna-menipis, #a66300); color: var(--warna-menipis, #a66300); }
  .gembok:focus-visible, .kontrol button:focus-visible, .kolom-stok:focus-visible {
    outline: 3px solid var(--warna-aksen, #12456e);
    outline-offset: 2px;
  }
  .judul-stok { font-size: 0.875rem; }
  .lencana {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid currentColor;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--warna-aman, #1f7a4d);
  }
  .lencana[data-status="menipis"] { color: var(--warna-menipis, #a66300); }
  .lencana[data-status="hampir"], .lencana[data-status="habis"] { color: var(--warna-habis, #b3261e); }
  .kontrol { display: flex; gap: 6px; align-items: center; }
  .kontrol button {
    min-width: 52px;
    min-height: 48px;
    padding: 0;
    font: inherit;
    font-size: 1.25rem;
    border: 1px solid var(--warna-garis, #d5dde3);
    border-radius: var(--radius-kontrol, 6px);
    background: transparent;
    color: var(--warna-teks, #14212b);
    cursor: pointer;
  }
  .kontrol button.jual { border-color: var(--warna-aksen, #12456e); color: var(--warna-aksen, #12456e); }
  .kontrol button[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
  .kolom-stok {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 8px;
    font: inherit;
    font-size: 1.125rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--warna-teks, #14212b);
    background: var(--warna-latar, #f3f6f8);
    border: 1px solid var(--warna-garis, #d5dde3);
    border-radius: var(--radius-kontrol, 6px);
  }
  .kolom-stok[readonly] { background: transparent; border-color: transparent; }
  .petunjuk { margin: 0; font-size: 0.75rem; color: var(--warna-teks-redup, #5a6b78); }
`);

const NS_SVG = 'http://www.w3.org/2000/svg';

// Ikon gembok tanpa innerHTML: tubuh + pegangan (tertutup / terbuka).
function ikonGembok(terbuka) {
  const svg = document.createElementNS(NS_SVG, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  const tubuh = document.createElementNS(NS_SVG, 'rect');
  for (const [k, v] of Object.entries({ x: '5', y: '11', width: '14', height: '9', rx: '2' })) tubuh.setAttribute(k, v);
  const pegangan = document.createElementNS(NS_SVG, 'path');
  pegangan.setAttribute('d', terbuka ? 'M8 11V8a4 4 0 0 1 7.5-1.5' : 'M8 11V8a4 4 0 0 1 8 0v3');
  svg.append(tubuh, pegangan);
  return svg;
}

export class EtalaseCard extends HTMLElement {
  #item = null;
  #konteks = null;
  #bersih = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).adoptedStyleSheets = [gaya];
  }

  set item(nilai) {
    this.#item = nilai;
    this.#cobaPasang();
  }

  get item() {
    return this.#item;
  }

  set konteks(nilai) {
    this.#konteks = nilai;
    this.#cobaPasang();
  }

  connectedCallback() {
    this.#cobaPasang();
  }

  disconnectedCallback() {
    this.#lepas();
  }

  #cobaPasang() {
    if (this.isConnected && this.#item && this.#konteks) this.#pasang();
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
    const p = this.#item;
    const k = this.#konteks;
    const kirim = (nama, detail = {}) => this.#kirim(nama, { id: p.id, ...detail });

    /* ---- Kepala ---- */
    const tombolNama = h('button', {
      type: 'button',
      class: 'nama-tombol',
      text: p.nama,
      'aria-label': `Buka ${p.nama} di tab Hitung`,
      onClick: () => kirim('buka-di-hitung', { sku: p.sku }),
    });
    const elSku = h('p', { class: 'sku', text: `SKU ${p.sku}` });

    /* ---- Harga dan untung ---- */
    const elStatus = h('p', { class: 'status-hitung', text: 'Menghitung…' });
    const elHarga = h('b', { class: 'nilai' });
    const elUntung = h('b', { class: 'nilai' });
    const elMargin = h('span', { class: 'margin' });
    const blokHarga = h('div', { class: 'harga2', hidden: '' },
      h('div', {}, h('span', { class: 'label', text: 'Harga jual (diskon coret)' }), elHarga),
      h('div', {}, h('span', { class: 'label', text: 'Untung per terjual' }), elUntung, elMargin),
    );

    /* ---- Stok ---- */
    const tombolGembok = h('button', { type: 'button', class: 'gembok', onClick: () => kirim('gembok-ketuk') });
    const elLencana = h('span', { class: 'lencana' });
    const kolomStok = h('input', {
      type: 'text',
      class: 'kolom-stok',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-label': `Stok ${p.nama}`,
    });
    const tombolJual = h('button', {
      type: 'button',
      class: 'jual',
      text: '−',
      'aria-label': 'Terjual 1: kurangi stok dan catat penjualan',
      onClick: () => kirim('penjualan-catat'),
    });
    const tombolTambah = h('button', {
      type: 'button',
      text: '+',
      'aria-label': 'Tambah stok 1',
      onClick: () => kirim('stok-tambah'),
    });
    const elPetunjuk = h('p', { class: 'petunjuk', text: 'Ketuk gembok untuk membuka tombol stok selama 10 detik.' });

    // Angka stok diketik: sah bila bilangan bulat >= 0; selain itu dikembalikan ke nilai tersimpan.
    kolomStok.addEventListener('change', () => {
      const stok = bacaStok(kolomStok.value);
      if (stok === null) {
        kolomStok.value = String(p.stok.peek());
        kirim('stok-tidak-valid');
        return;
      }
      kirim('stok-atur', { stok });
    });
    kolomStok.addEventListener('keydown', (e) => { if (e.key === 'Enter') kolomStok.blur(); });
    // Kolom yang terkunci tetap bisa difokuskan (untuk pembaca layar) tetapi tidak bisa diketik;
    // mengetuknya melapor sebagai ketukan stok terkunci.
    kolomStok.addEventListener('click', () => { if (kolomStok.readOnly) kirim('gembok-ketuk', { dariKolom: true }); });

    const kartu = h('article', { class: 'kartu' },
      tombolNama,
      elSku,
      elStatus,
      blokHarga,
      h('div', { class: 'baris-stok' },
        h('div', { class: 'kepala-stok' }, tombolGembok, h('span', { class: 'judul-stok', text: 'Stok' }), elLencana),
        h('div', { class: 'kontrol' }, tombolJual, kolomStok, tombolTambah),
        elPetunjuk,
      ),
    );
    this.shadowRoot.replaceChildren(kartu);

    /* ---- Effect ---- */
    this.#bersih.push(effect(() => {
      const hasil = p.hitung.value;
      elStatus.dataset.status = hasil.tahap;
      if (hasil.tahap === 'ok') {
        elStatus.hidden = true;
        blokHarga.hidden = false;
        elHarga.textContent = formatRupiah(hasil.diskonSen);
        elUntung.textContent = formatRupiah(hasil.untungSen);
        elUntung.dataset.nada = hasil.nada;
        elMargin.textContent = ` Margin ${formatPersenPpm(hasil.marginPpm)}%`;
      } else {
        blokHarga.hidden = true;
        elStatus.hidden = false;
        elStatus.textContent = hasil.tahap === 'galat'
          ? `${hasil.galat} Penjualan tidak bisa dicatat sampai harga terhitung.`
          : 'Menghitung…';
      }
    }));

    this.#bersih.push(effect(() => {
      const stok = p.stok.value;
      const status = statusStok(stok);
      elLencana.textContent = LABEL_STATUS[status];
      elLencana.dataset.status = status;
      tombolJual.setAttribute('aria-disabled', String(stok <= 0 || !k.terbuka(p.id)));
      // Jangan menimpa angka yang sedang diketik.
      if (this.shadowRoot.activeElement !== kolomStok) kolomStok.value = String(stok);
    }));

    this.#bersih.push(effect(() => {
      k.versiGembok.value; // berlangganan: tiap gembok berubah, bagian ini dirender ulang
      const buka = k.terbuka(p.id);
      tombolGembok.replaceChildren(ikonGembok(buka));
      tombolGembok.setAttribute('aria-pressed', String(buka));
      tombolGembok.setAttribute('aria-label', buka ? 'Kunci stok' : 'Buka kunci stok');
      kolomStok.readOnly = !buka;
      const stok = p.stok.peek();
      tombolJual.setAttribute('aria-disabled', String(!buka || stok <= 0));
      tombolTambah.setAttribute('aria-disabled', String(!buka));
      elPetunjuk.textContent = buka
        ? 'Terbuka 10 detik. Tombol − mengurangi stok dan mencatat 1 penjualan.'
        : 'Ketuk gembok untuk membuka tombol stok selama 10 detik.';
    }));
  }
}

if (!customElements.get('etalase-card')) {
  customElements.define('etalase-card', EtalaseCard);
}
