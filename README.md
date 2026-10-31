# ChatBot Prema

Asisten AI **Mawar** untuk nomor **WhatsApp Business** Prema Konveksi.
Nomor ditautkan melalui QR di dashboard; aplikasi memakai Baileys dan berjalan
di PC yang terus menyala. Proyek ini terpisah dari PREMA OS.

AI menyusun jawaban dari informasi yang diisi toko. Pola jawaban dan pelatihan
kata kunci tidak lagi tersedia di dashboard atau API. Ketika memperbarui
instalasi lama, teks pola yang aktif dipindahkan ke Tanya-jawab, atau ke Promo
bila memiliki masa berlaku. Data lama tetap tersimpan di database.

Bot aktif Senin–Sabtu 17.30–07.30 dan Minggu sepanjang hari secara bawaan.
Jam aktif dapat diubah. Ketika CS membalas dari HP atau mengambil alih melalui
dashboard, bot berhenti membalas pelanggan tersebut.

## Mengubah bot dari sidebar

Dashboard: **http://127.0.0.1:3001/** di PC bot.

| Menu | Yang dapat diubah |
| --- | --- |
| Produk | Tambah barang, nama/sebutan produk, bahan, model, ukuran, minimal order, dan rincian yang perlu ditanyakan AI |
| Pengetahuan | Informasi toko dan tanya-jawab yang menjadi sumber jawaban AI |
| Sapaan & pesan | Kata pembuka, sapaan, pemberitahuan CS, serta petunjuk katalog dan size chart |
| Promo | Tambah atau ubah promo resmi, pilih produk, aktif/nonaktif, tanggal mulai dan selesai |
| Gaya bicara AI | Instruksi, gaya bahasa, contoh percakapan, model, koneksi Ollama, dan batas panggilan |
| Media | Unggah katalog, size chart, serta sinkronkan katalog WhatsApp Business |
| Pengaturan | Nama bot/CS, jam aktif/libur, masa pengambilalihan CS, rekap pagi, pesan otomatis WA Business, dan backup |

Ringkasan menampilkan kesiapan dan koneksi. Percakapan menampilkan riwayat dan
ringkasan kebutuhan pelanggan. Coba bot menguji percakapan dan skenario tanpa
mengirim ke WhatsApp. Statistik dan Log membantu memantau aktivitas.

Perubahan berlaku setelah **Simpan**, tanpa restart. Template sapaan tetap
dipakai; jawaban percakapan ditulis AI. AI hanya memakai pengetahuan toko,
rincian produk, dan promo yang aktif serta sesuai produknya. Harga produk,
penawaran final, negosiasi, dan keputusan khusus ditangani CS.

Promo nonaktif, belum mulai, atau kedaluwarsa tidak diberikan kepada AI.
Tanggal mengikuti zona waktu toko. AI boleh menjelaskan diskon yang tertulis
pada promo aktif; dilarang membuat diskon atau menghitung harga sendiri.

Size chart dikirim sebagai gambar bila toko mengunggah gambar, disertai
petunjuk pengukuran, sebelum meminta rincian ukuran. Jika produknya belum
diketahui, bot menanyakannya dahulu. Jika file belum tersedia, CS membantu.

## Menjalankan di Windows

1. Ekstrak folder proyek, jangan dijalankan dari dalam ZIP.
2. Klik **Mulai ChatBot Prema.bat**. Instalasi pertama memasang Node.js dan
   dependensi, lalu membuka dashboard.
3. Tautkan nomor WhatsApp Business melalui **Perangkat tertaut → Tautkan perangkat**,
   lalu scan QR dari dashboard.
4. Isi Pengetahuan dan Produk, atur koneksi di Gaya bicara AI, unggah Media,
   lalu coba percakapan lewat Coba bot.
5. Isi nomor penerima rekap dan folder backup di Pengaturan.

**Update ChatBot Prema.bat** mengambil pembaruan lalu menghentikan bot.
Setelah selesai, klik **Mulai ChatBot Prema.bat**. Pembaruan menjaga
data/, media/, logs/, dan .env. Satu database hanya boleh digunakan satu proses bot.

Ollama Cloud memakai OLLAMA_API_KEY; Ollama lokal memakai OLLAMA_HOST.
Keduanya dapat diatur melalui Gaya bicara AI, tanpa mengedit berkas.
AI yang gagal atau belum diatur tidak mengarang balasan pengganti; kendala
ditampilkan di dashboard. Sapaan dan pengiriman size chart tetap dapat berjalan.

## Pemulihan koneksi dan pengiriman

- Internet putus: bot terus mencoba menyambung ulang dengan jeda 2 detik sampai maksimal 1 menit. Permintaan versi dibatasi 10 detik; keep-alive yang gagal memicu koneksi baru. Sesi tidak dihapus karena gangguan internet.
- Balasan dan perubahan alur disimpan bersama ke SQLite sebelum dikirim. Balasan yang gagal dicoba lagi saat tersambung dan setiap 30 detik dengan ID yang sama, termasuk setelah aplikasi restart. Dashboard menunjukkan jumlah pesan yang masih menunggu dikirim.
- Balasan pelanggan tetap mengikuti jam aktif. Jika tertunda lebih dari 15 menit, balasan dibatalkan dan percakapan ditandai perlu CS; pesan lama tidak tiba-tiba dikirim pada malam berikutnya. Pengambilalihan CS membatalkan antrean pelanggan itu.
- Pesan asli untuk permintaan kirim ulang WhatsApp disimpan 7 hari, termasuk data enkripsi media. Ini memungkinkan pemulihan pesan yang tampil sebagai "Waiting for this message". Teks lama yang masih ada di riwayat juga dapat dipakai untuk kirim ulang.
- Sinkronisasi katalog yang timeout mempertahankan katalog terakhir dan mencoba lagi. File yang diunggah tetap dapat dikirim. Katalog produk otomatis dikirim saat produk mulai dibahas, tanpa bergantung pada isian lampiran dari AI.
- Permintaan size chart mengirim file yang diunggah, lalu petunjuk pengukuran. Size chart juga dikirim sebelum pertanyaan rincian ukuran. Jika produknya belum diketahui, bot menanyakannya; jika filenya belum ada, bot memberi tahu bahwa CS akan membantu.
- Rekap pagi menyimpan isi dan ID per penerima sampai semua penerima berhasil dikirimi. Gangguan pada satu penerima tidak membuat penerima sebelumnya dikirimi rekap baru berulang kali.

## Tugas harian dan pemulihan

### Saat bot ditinggal

- Pesan masuk disimpan sebelum debounce atau pemanggilan AI. Restart di tengah
  proses tidak menghilangkan permintaan pelanggan. Antrean dilanjutkan saat
  WhatsApp tersambung kembali.
- Timeout, gangguan jaringan, server AI 5xx, dan batas kuota dicoba ulang
  dengan jeda bertahap. Maksimal lima percobaan atau 15 menit; setelah itu
  kebutuhan pelanggan ditandai untuk CS. Balasan yang ditolak pemeriksaan
  keamanan tidak dikirim dan langsung ditandai untuk CS.
- Status percakapan, antrean keluar, dan penyelesaian antrean masuk disimpan
  dalam satu transaksi. Pengiriman yang terputus dilanjutkan dengan ID lama.
  Reset dan pengambilalihan CS membatalkan pekerjaan yang sudah tidak berlaku.
- Batas waktu terpisah menjaga proses AI, kirim WhatsApp, dan handshake agar
  tidak menggantung selamanya. Pekerjaan lama yang selesai terlambat tidak
  boleh menimpa hasil pemulihan yang baru.
- Antrean dihitung sebagai percobaan sebelum pekerjaan dimulai. Pesan yang
  memicu crash berulang akhirnya dipisahkan untuk CS, bukan membuat restart
  tanpa akhir. Pesan terlalu panjang tetap tersimpan di riwayat untuk CS.
- Sinkronisasi setelah offline yang terlalu lama dicatat sebagai kebutuhan
  CS; bot tidak mengirim sapaan terlambat untuk pesan lama.
- SQLite memakai WAL dan synchronous FULL untuk memperkuat penyimpanan
  transaksi dan kunci autentikasi ketika proses berhenti mendadak.

Pada auto-start Windows, launcher menjalankan pengawas HTTP terpisah dari
Node. Setelah masa awal 2 menit, empat pemeriksaan kesehatan yang gagal
berturut-turut memicu restart proses bot milik launcher tersebut. Pengawas
memeriksa hubungan proses induk dan lokasi aplikasi sebelum menghentikan Node;
aplikasi Node lain tidak ikut dihentikan. Loop launcher menyalakan kembali
bot setelah 10 detik.

Pengawas eksternal ini berlaku ketika dijalankan lewat **Mulai ChatBot Prema**
dan auto-start Windows. Menjalankan npm start secara manual tidak memasang
pengawas proses Windows. PC tetap perlu menyala dan memiliki akses jaringan.

### Pesan terenkripsi yang belum terbaca

Bot mencoba sesi nomor telepon jika sesi LID gagal karena pre-key tidak tersedia.
Untuk error enkripsi yang masih bertahan, bot memberi waktu pada retry WhatsApp,
lalu mengunggah pre-key baru dan meminta HP mengirim ulang. Kunci lama tidak
dikarang ulang atau dihapus. Sambung ulang dibatasi, dan pesan rusak tunggal
tidak memutus percakapan lain yang masih berjalan.

Dashboard menampilkan jumlah pesan yang sedang dipulihkan. Error mentah tetap
ada di Log teknis; popup ditunda selama pemulihan otomatis. Jika belum berhasil
setelah 5 menit, muncul peringatan, maksimal sekali per 10 menit. Antrean dan
batas percobaan disimpan di SQLite agar restart tidak mengulang rentetan popup.

Balasan ke pelanggan ditahan sementara ketika ada pesan dari HP sendiri yang
belum terbaca, agar bot tidak menimpa kemungkinan balasan CS. Setelah pesan
pulih, penanganan CS atau balasan bot dilanjutkan sesuai isi pesan tersebut.
Pemulihan tidak menghapus tautan perangkat. Jika HP utama offline, kirim ulang
bisa menunggu sampai HP kembali online; logout resmi tetap memerlukan QR baru.

- Rekap pelanggan ke WhatsApp CS: 07.30 Senin–Sabtu secara bawaan.
- Backup dan pembersihan chat: 03.00.
- Backup disimpan 14 hari; isi chat disimpan 90 hari secara bawaan.
- Tugas yang terlewat ketika PC mati dicoba saat aplikasi kembali berjalan.

Pilih folder backup di Google Drive, OneDrive, NAS, atau perangkat lain.
Untuk memulihkan: hentikan bot, salin backup chatbot-YYYY-MM-DD.sqlite ke
data/chatbot.sqlite, hapus berkas pendamping chatbot.sqlite-wal dan
chatbot.sqlite-shm, lalu nyalakan kembali.

## Pengembangan

Node.js 20+ dengan JavaScript ESM, Express, SQLite, Baileys, dan Ollama.

- npm install
- Salin .env.example menjadi .env
- npm start
- npm run dev untuk restart otomatis saat kode berubah
- npm test; pada PowerShell yang memblokir skrip, gunakan npm.cmd test

Pengujian menggunakan SQLite sementara dan transport WhatsApp simulasi.
Mesin alur naskah dan pengujian historisnya masih disimpan untuk regresi;
pengaturan produksi mengunci mode AI, tanpa endpoint pengelolaan pola.
