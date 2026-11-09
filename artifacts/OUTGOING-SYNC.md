# Pengujian pemulihan salinan pesan keluar

Tanggal: 9 November 2026.

Keluhan customer: pelanggan menerima pesan atau katalog, tetapi salinannya kadang tidak terlihat di HP/Web pemilik atau admin. Tidak ada DB, sesi, .env, atau log produksi workspace yang dipakai untuk mendiagnosis customer.

## Temuan kode

Sebelum perbaikan, pesan asli untuk retry baru disimpan setelah socket.sendMessage selesai. Jika permintaan kirim ulang dari perangkat lain datang saat pengiriman masih berjalan atau proses gagal sebelum kembali, protobuf media belum tersedia. Riwayat teks saja tidak menyimpan mediaKey dan hash katalog.

Tiga tes awal yang memeriksa penyimpanan sebelum send selesai, kegagalan pengiriman, dan pengiriman paralel gagal pada kode sebelum perbaikan. Ini membuktikan celah pada kode, bukan memastikan seluruh keluhan customer disebabkan celah tersebut.

## Perbaikan

- Simpan protobuf asli melalui hook Baileys patchMessageBeforeSending sebelum enkripsi dan relay.
- Pertahankan pembungkus deviceSentMessage saat dikirim ke perangkat akun sendiri, tetapi simpan isi pesan aslinya untuk retry.
- Pisahkan konteks tiap pengiriman menggunakan AsyncLocalStorage agar dua pelanggan tidak saling menimpa data.
- Jika protobuf sudah disiapkan, ulangi pengiriman dengan relayMessage memakai ID dan kunci media yang sama, tanpa mengunggah ulang media dan mengganti payload untuk ID tersebut.
- Refresh daftar perangkat pada relay ulang.
- Periksa lagi pembatalan CS ketika media selesai disiapkan, sebelum enkripsi.

## Hasil simulasi

Perintah: `node --test test/outgoing-sync.test.js`.

| Skenario | Hasil |
| --- | --- |
| HP utama dan dua admin meminta katalog sebelum sendMessage kembali | Ketiganya dapat mengambil protobuf katalog dan mediaKey yang benar |
| Pengiriman gagal setelah media disiapkan | Data tetap tersedia; percobaan berikutnya menggunakan ID dan mediaKey yang sama |
| Dua pelanggan dikirimi katalog secara paralel | Setiap ID mengambil katalog yang benar |
| Teks biasa dan tautan katalog diminta sebelum pengiriman selesai | Isi pesan tersedia untuk retry |
| Pengirim baru setelah restart mengulangi PDF yang sudah disiapkan | PDF menggunakan kunci lama tanpa unggahan baru |
| CS mengambil alih saat persiapan media | Pengiriman dibatalkan sebelum enkripsi dan tidak ada payload batal yang disimpan |

Keenam tes khusus lulus. Seluruh regresi melalui `npm.cmd test`: **341 tes lulus, 0 gagal, 0 dilewati**, sekitar 11,93 detik. Lihat [output lengkap](outgoing-sync-test-results.txt).

## Batas pembuktian

SQLite pengujian bersifat in-memory, dan transport WhatsApp disimulasikan. Tes membuktikan urutan penyimpanan, isi payload, penggunaan ulang kunci, isolasi pengiriman, dan pembatalan. Tes tidak membuktikan bahwa WhatsApp nyata sudah menyinkronkan perangkat customer.

Pasang pembaruan di PC customer, lalu verifikasi pesan teks, tautan katalog, gambar, dan PDF pada pelanggan serta HP/Web pemilik dan dua admin. Pesan lama yang payload aslinya tidak pernah tersimpan belum tentu bisa dipulihkan oleh perbaikan ini. Tidak ada pesan nyata dikirim selama pengujian.
