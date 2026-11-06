# Bukti pengujian perbaikan multi-device

Tanggal: 7 November 2026. Lingkungan: Windows, Node.js v25.0.0.

Perintah: `npm.cmd test`

Hasil akhir: **335 tes lulus, 0 gagal, 0 dilewati, 0 dibatalkan**, sekitar 10,62 detik. Output lengkap tersimpan di [test-results.txt](test-results.txt). `git diff --check` juga lulus.

## Skenario yang dibuktikan

| Simulasi | Hasil yang diperiksa |
| --- | --- |
| Enkripsi Signal asli secara lokal | HP utama serta admin perangkat 59 dan 66 mengenkripsi pesan menggunakan sesi terpisah; bot mendekripsi pesan dan pesan lanjutan dengan benar |
| Replay ciphertext | Pengiriman ulang melalui cache menghasilkan isi yang sama tanpa memakai kunci dua kali |
| Empat perangkat | Bot perangkat 12 memperbarui sesi HP utama dan dua admin pada alamat masing-masing, tanpa kehilangan nomor perangkat |
| Pengirim tidak diketahui | Tidak dianggap HP utama, tidak meminta QR, tidak memicu reconnect akun |
| Status pemulihan versi lama | Flag lama dan hitungan pembaruan yang belum terverifikasi tidak memicu relink |
| Metadata pengirim terlambat | Pengiriman ulang memperjelas perangkat admin tanpa mereset umur atau jumlah percobaan pesan |
| Antrean pemulihan penuh | Pesan perangkat toko diserahkan ke CS sebelum dikeluarkan dari antrean |
| Alarm lama | Pesan yang sudah dikeluarkan dari pemulihan tidak meninggalkan permintaan scan ulang permanen |
| Pembaruan sesi gagal | Operasi yang gagal tidak dihitung sebagai perbaikan berhasil |
| Cooldown setelah restart | Pembaruan sesi admin tidak diulang sebelum jeda sepuluh menit |
| Pembaruan admin menggantung | Deadline dua puluh detik melepas pekerjaan tanpa memutus perangkat lain; permintaan kirim ulang berikutnya dapat berjalan |
| Admin berhasil terbaca | Tidak dianggap sebagai bukti HP utama sudah pulih |
| HP utama pulih lalu restart | Timestamp keberhasilan tetap tersimpan; pesan lama tidak menghidupkan alarm HP utama kembali |
| Duplikat setelah restart | ID yang sudah terbaca tidak masuk pemulihan lagi dan tidak menahan pelanggan |
| Admin membalas saat bot mengetik | Antrean dibatalkan dan tidak ada pesan yang mencapai transport WhatsApp |
| Pesan admin belum terbaca saat bot mengetik | Pengiriman ditahan; setelah tiga menit chat diserahkan ke CS dan antreannya dibatalkan; pelanggan lain tidak ikut diserahkan |
| Smoke test aplikasi | HTTP health dan dashboard merespons; sesi simulasi tersambung; input pelanggan dibalas; echo bot tidak dianggap CS; balasan admin menghentikan bot; status terlihat lewat API percakapan |
| Kode tanpa komentar | Parser memeriksa JavaScript aplikasi dan tes, script dashboard, HTML/CSS dashboard, PowerShell, dan batch |

## Berkas pengujian

- [multidevice.test.js](../test/multidevice.test.js): 15 simulasi multi-device dan enkripsi.
- [runtime.test.js](../test/runtime.test.js): alur HTTP dan transport WhatsApp simulasi.
- [comment-free.test.js](../test/comment-free.test.js): pemeriksaan komentar dan sintaks script Windows.
- Seluruh tes regresi lama tetap dijalankan, termasuk pemulihan setelah proses dihentikan mendadak, retry, media, penjagaan jawaban AI, backup, dan watchdog Windows.

## Batas pembuktian

Pengujian memakai SQLite in-memory atau berkas sementara dan transport simulasi. Konfigurasi tes mengarahkan dotenv ke lokasi sementara sehingga .env produksi tidak dimuat. DB dan log produksi workspace tidak dipakai. Tidak ada akun WhatsApp yang ditautkan, tidak ada pesan dikirim ke pelanggan nyata, dan Ollama produksi tidak dipanggil.

Enkripsi Signal diuji secara nyata di proses lokal, tetapi pengantaran WhatsApp dan respons server pemulihan disimulasikan. Keberhasilan di PC klien perlu diperiksa setelah pembaruan dipasang dengan pemilik dan dua admin tetap tertaut. Pesan lama yang kuncinya sudah tidak tersedia belum tentu dapat dipulihkan.
