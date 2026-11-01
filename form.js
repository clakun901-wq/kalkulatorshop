// form.js — pembangun formulir dari spesifikasi (Fase 5)
//
// Membuat elemen formulir dari daftar bidang di isian.js (tanpa innerHTML).
// Dipakai untuk formulir Setelan toko dan dialog Produk.

import { h } from './ui.js';

// spek: daftar bidang (lihat isian.js). awalan: pembeda id elemen (mis. "s", "p").
// Mengembalikan { akar, ambil(), isi(isian) }.
export function bangunFormulir(spek, awalan) {
  const akar = document.createDocumentFragment();
  const kendali = new Map();
  let wadah = akar;

  for (const b of spek) {
    if (b.kelompok) {
      wadah = h('fieldset', { class: 'kelompok' }, h('legend', { text: b.kelompok }));
      akar.append(wadah);
      continue;
    }

    const idEl = `${awalan}-${b.id}`;
    let el;

    if (b.jenis === 'pilih') {
      el = h('select', { id: idEl }, ...b.opsi.map(([nilai, teks]) => h('option', { value: nilai, text: teks })));
    } else if (b.jenis === 'cek') {
      el = h('input', { id: idEl, type: 'checkbox' });
    } else if (b.jenis === 'tanggal') {
      el = h('input', { id: idEl, type: 'date' });
    } else {
      const mode = b.jenis === 'teks' ? 'text' : (b.jenis === 'persen' || b.jenis === 'sesuaiMode' ? 'decimal' : 'numeric');
      el = h('input', { id: idEl, type: 'text', inputmode: mode, autocomplete: 'off' });
    }
    kendali.set(b.id, el);

    const label = h('label', { for: idEl, text: b.label });
    const bantuan = b.bantuan ? h('small', { text: b.bantuan }) : null;
    wadah.append(
      b.jenis === 'cek'
        ? h('div', { class: 'bidang cek' }, el, label, bantuan)
        : h('div', { class: 'bidang' }, label, el, bantuan)
    );
  }

  return {
    akar,
    ambil() {
      const isian = {};
      for (const [id, el] of kendali) isian[id] = el.type === 'checkbox' ? el.checked : el.value;
      return isian;
    },
    isi(isian) {
      for (const [id, el] of kendali) {
        const nilai = isian[id];
        if (el.type === 'checkbox') el.checked = Boolean(nilai);
        else el.value = nilai === undefined || nilai === null ? '' : String(nilai);
      }
    },
  };
}
