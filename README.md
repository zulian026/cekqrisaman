# CekQRISAman

Bongkar isi kode QRIS sebelum membayar: nama penerima asli, nominal yang terkunci pada QR dinamis,
identitas penerbit, dan validasi checksum CRC — **100% diproses di browser pengunjung**.
Tidak ada server, tidak ada database, tidak ada upload foto.

## Kenapa alat ini ada

Stiker QRIS palsu yang ditempel di atas QR asli (quishing) sedang marak di Indonesia.
Logo dan tulisan pada stiker bisa dipalsukan, tetapi isi payload EMV di dalam kode QR
memuat nama penerima yang sebenarnya — dan checksum CRC16 yang ketahuan bila payload diedit.

## Stack

- Astro 5 + TypeScript, output statis murni
- Tailwind CSS 4
- Decoder QR: BarcodeDetector API (jalur cepat, Chrome Android) + `zxing-wasm` (fallback WebAssembly)
- Parser QRIS/EMVCo + CRC-16/CCITT-FALSE + risk engine berbasis aturan — `src/lib/qris.ts`, tanpa dependensi
- PWA: manifest + service worker cache-first (`public/sw.js`), bisa bekerja offline setelah kunjungan pertama

## Menjalankan

```bash
npm install
npm run dev      # pengembangan
npm test         # unit test parser (vektor CRC dari implementasi independen)
npm run build    # hasil statis di dist/
```

## Deploy (gratis)

Cloudflare Pages: hubungkan repo, build command `npm run build`, output directory `dist`.
Bisa juga dihosting di GitHub Pages / Netlify / server statis mana pun.

## Batas alat

Alat ini memeriksa struktur dan keutuhan payload QR, bukan reputasi penjual.
QR yang strukturnya valid tetap harus dicocokkan nama penerimanya di aplikasi pembayaran
sebelum memasukkan PIN.
