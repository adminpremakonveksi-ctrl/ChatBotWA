# Audit lanjutan alur chat dan katalog

Tanggal: 9 November 2026.

Cakupan: seluruh titik sendMessage/relayMessage milik aplikasi, retry perangkat sendiri, penyimpanan payload, antrean keluar, echo pesan, notifikasi perangkat, reconnect, pemetaan LID, katalog/media, dan jalur kirim teks manual. Dashboard/runtime, watchdog, pemulihan proses, AI, serta alur lain tetap diperiksa oleh suite regresi.

## Temuan tambahan dan perbaikan

| Temuan | Perbaikan dan bukti |
| --- | --- |
| Relay Baileys yang terpasang membandingkan participant LID perangkat sendiri dengan ID nomor telepon | Uji menjalankan fungsi relay dari node_modules melalui VM dengan transport dan penyimpanan kunci simulasi. Baseline kehilangan deviceSentMessage dan recipient; pada chat PN, alamat enkripsi juga memakai user LID sebagai nomor telepon. Perbaikan memakai alias nomor akun terautentikasi dengan device number yang sama. Enam kombinasi teks/gambar/PDF dan tujuan PN/LID menghasilkan pembungkus, alamat, serta isi pesan yang benar. node_modules tidak diubah. |
| Retry perlu memperbarui alamat sesi yang benar-benar dipakai saat enkripsi | Participant tetap memakai alias PN agar dikenali sebagai perangkat sendiri. Sesi yang diperbarui memakai LID untuk chat LID, PN untuk chat PN. |
| Permintaan retry sendiri perlu ACK ke alamat asli | Handler khusus hanya menangani retry dari LID akun sendiri ke chat langsung. Node asal tidak dimodifikasi; ACK tetap menuju LID asal. Receipt pelanggan, PN, grup, dan event biasa tetap melalui handler semula. |
| Retry bersamaan dapat saling memperbarui sesi satu admin | Antrean per perangkat dan penggabungan request bersamaan mencegah pembaruan paralel. Ada batas lima percobaan per ID/perangkat dan deadline jaringan. |
| sendText melewati antrean dan penyimpanan baru | Kirim teks manual kini mencatat ID dahulu dan memakai antrean serta sender yang sama. |
| Echo dapat menimpa protobuf asli atau membungkus ulang salinan | Penyimpanan original bersifat immutable per session/message ID. Wrapper deviceSentMessage dilepas hanya untuk penyimpanan; payload saat dikirim tetap mengikuti protokol. |
| Lookup retry hanya memeriksa ID tanpa chat | Lookup juga memeriksa percakapan asal, menerima alias PN/LID yang telah dipelajari, dan menolak percakapan lain. |
| Retensi dapat menghapus payload yang masih mengantre | Pembersihan melewati original yang masih direferensikan antrean keluar. Setelah selesai, retensi normal berlaku. |
| Cache perangkat tidak dibatalkan saat notifikasi devices | Cache per koneksi memakai TTL lima menit. Perubahan perangkat membatalkan cache pengguna terkait; untuk akun toko, kedua alias ikut dibatalkan. |
| Pemrosesan catch-up lama memanggil isBotActive tanpa impor | Impor diperbaiki. Tes memastikan pesan lama masuk tindak lanjut CS dan pesan baru berikutnya dalam batch tetap diproses. |
| Event creds.update dari socket lama dapat mengubah pemetaan identitas | Guard generasi/socket aktif ditambahkan. Tes memastikan pemetaan tidak berubah setelah socket dihentikan. |

## Hasil akhir

Perintah: `npm.cmd test`.

**361 tes lulus, 0 gagal, 0 dilewati, 0 dibatalkan**, sekitar 12,09 detik. [Output lengkap](delivery-audit-test-results.txt). Pemeriksaan `git diff --check` lulus.

Tes tambahan berada di outgoing-sync.test.js, own-device-retry.test.js, baileys-fixes.test.js, dan reliability.test.js. baileys-relay-fixture.js menjalankan kode relay Baileys yang benar-benar terpasang, dengan network dan operasi kunci simulasi. Enkripsi Signal asli juga tetap diuji oleh suite multi-device yang sudah ada.

## Batas audit

Tidak membaca DB, sesi, .env, atau log produksi workspace sebagai bukti kondisi customer. Data pengujian terisolasi. Tidak ada akun WhatsApp nyata yang ditautkan atau pesan dikirim kepada pelanggan nyata.

Temuan di atas terbukti dari kode dan simulasi. Tetap verifikasi di PC customer bahwa teks, tautan, gambar, dan PDF terlihat di pelanggan, HP pemilik, serta kedua admin setelah pembaruan dipasang. Pesan lama tanpa payload asli belum tentu dapat dipulihkan. Perubahan belum otomatis dipasang di PC customer.
