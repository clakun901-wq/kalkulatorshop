// format.js — format tampilan uang, persen, dan tanggal Kalsara v6 (Fase 6)
//
// Modul MURNI (tanpa DOM, tanpa import) supaya bisa dipakai UI maupun diuji di Node.
// Uang = bilangan bulat SEN (rupiah x 100); persen = bilangan bulat PPM (1% = 10.000).
// Pembagian hanya terjadi di sini, saat angka ditampilkan.

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

// 123456 ppm -> "12,3" (satu desimal, nol di belakang koma dibuang, setengah dibulatkan menjauhi nol).
export function formatPersenPpm(ppm) {
  const tanda = ppm < 0 ? '-' : '';
  const sepersepuluh = Math.floor((Math.abs(ppm) + 500) / 1000);
  const bulat = Math.floor(sepersepuluh / 10);
  const desimal = sepersepuluh % 10;
  return `${tanda}${bulat}${desimal === 0 ? '' : `,${desimal}`}`;
}

// 65000 ppm -> "6,5" (sampai 4 desimal, untuk label tarif).
export function formatTarifPpm(ppm) {
  const bulat = Math.floor(ppm / 10_000);
  const sisa = ppm % 10_000;
  return sisa === 0 ? String(bulat) : `${bulat},${String(sisa).padStart(4, '0').replace(/0+$/, '')}`;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Waktu (ms sejak epoch) -> "12 Nov" menurut zona waktu perangkat.
export function formatTanggalPendek(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${BULAN[d.getMonth()]}`;
}
