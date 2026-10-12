# Folder media

**Biasanya tidak perlu dibuka:** unggah file dari konsol, halaman **Media**.
Folder ini hanya tempat penyimpanannya.

File yang dikirim bot. Nama file menentukan kapan file dikirim. Format yang
diterima: `.pdf` (dikirim sebagai dokumen) dan `.jpg` `.jpeg` `.png` `.webp`
(dikirim sebagai gambar).

File dibaca ulang setiap kali akan dikirim, jadi mengganti katalog **tidak perlu
restart bot**.

```
media/
├── katalog/
│   ├── jersey.pdf              katalog jersey
│   ├── id-card-lanyard.pdf
│   ├── gantungan-kunci.pdf
│   ├── bendera-printing.pdf
│   └── umum.pdf                dipakai kalau produknya belum diketahui
├── size-chart/
│   ├── kaos.jpg                size chart reguler
│   ├── kaos-boxy.jpg           varian boxy (opsional)
│   ├── kaos-oversize.jpg       varian oversize (opsional)
│   ├── jersey.jpg
│   ├── pdl.jpg
│   └── ...                     satu file per produk
└── katalog-review.jpg          dikirim saat pelanggan ragu / takut ditipu
```

Kalau satu katalog terdiri dari beberapa halaman gambar, buat **folder** dengan
nama yang sama, misalnya `katalog/jersey/01.jpg`, `katalog/jersey/02.jpg`.
Semua isinya dikirim berurutan sesuai nama file.

Nama produk yang dipakai (lihat `src/bot/products.js`):
`jersey`, `id-card-lanyard`, `gantungan-kunci`, `bendera-printing`, `kaos`,
`pdl`, `kemeja`, `polo`, `rompi`, `jaket`, `hoodie`, `topi`, `tote-bag`,
`seragam-sekolah`.

## Kalau file tidak ada

- **Katalog** tidak ada: alur tetap jalan, bot hanya melewati pengiriman file.
- **Size chart** tidak ada: bot tidak bisa menjawab, jadi percakapan
  **diserahkan ke CS** (aturan wajib 1).
- **Katalog review** tidak ada: bot hanya mengirim teks jawabannya.

Sumber gambar size chart:
https://drive.google.com/drive/folders/1BhBIn6NsQ4d59DbTEq7Z-46TYk9vD7st
(link Drive tidak bisa dikirim sebagai gambar WhatsApp. Unduh filenya ke sini.)
