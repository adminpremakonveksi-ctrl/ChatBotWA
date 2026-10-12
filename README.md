# ChatBot Prema

Chatbot WhatsApp Prema Konveksi. Bot memperkenalkan diri sebagai **Mawar** dan
menjaga chat **di luar jam kerja** sembari menunggu CS online.

- Aktif Senin–Sabtu 17.30–07.30 dan Minggu 24 jam. Di luar itu bot diam total.
- Balasan selalu naskah tetap: bawaannya dari spesifikasi klien, bisa diubah tim di dashboard (Template balasan). AI tidak pernah mengarang kalimat.
- Bot tidak pernah menyebut harga. Bot hanya mengirim file katalog.
- Kalau pertanyaan tidak dikenali, atau CS membalas sendiri dari HP, bot berhenti
  di nomor itu dan CS yang melanjutkan.

Proyek ini berdiri sendiri: tidak ada koneksi apa pun ke PREMA OS.

## Untuk klien: dua tombol saja

| File | Gunanya |
| --- | --- |
| **`Mulai ChatBot Prema.bat`** | Klik pertama: memasang semuanya, lalu membuka dashboard. Klik berikutnya: langsung membuka dashboard. |
| **`Update ChatBot Prema.bat`** | Mengambil versi terbaru dari GitHub dan menyalakan ulang bot. Tautan WhatsApp, riwayat chat, dan gambar yang sudah diunggah tetap aman. |

Pemasangan pertama:

1. Ekstrak folder ini ke PC yang menyala terus, mis. `C:\ChatBot Prema`
   (jangan dijalankan dari dalam ZIP).
2. Klik dua kali **`Mulai ChatBot Prema.bat`**, setujui permintaan Administrator.
3. Dashboard terbuka. Scan QR sekali dari HP bot
   (WhatsApp > Perangkat tertaut > Tautkan perangkat).
4. Di dashboard: unggah katalog & size chart (**Media**), isi nomor rekap dan
   folder backup (**Pengaturan**).

Tidak ada file yang perlu diedit. Node.js, dependensi, dan database SQLite
dipasang/dibuat otomatis saat klik pertama (butuh internet). Windows mungkin
menampilkan "Windows protected your PC" untuk file hasil unduhan: klik
**More info > Run anyway**.

Setelah itu bot menyala sendiri setiap PC hidup, juga setelah mati listrik,
tanpa perlu login. Kalau crash, hidup lagi dalam 10 detik. Bot hanya
**membalas** di jam aktif. Nomor tidak perlu scan ulang setelah restart.

## Untuk developer: merilis fitur baru

1. Isi `scripts/repo.txt` sekali dengan alamat repo GitHub publik
   (mis. `https://github.com/pemilik/chatbot-prema main`).
2. Kerjakan fiturnya, `npm test`, lalu push ke branch itu.
3. Minta klien klik **`Update ChatBot Prema.bat`**.

Update membaca versi terbaru lewat GitHub API. Kalau sama dengan yang terpasang
(`data/versi.txt`), tidak ada yang diubah. Kalau beda, kode diunduh sebagai ZIP
(PC klien tidak perlu git), disalin ke folder bot kecuali `data/`, `media/`,
`logs/` dan `.env`, dependensi dipasang ulang kalau `package-lock.json` berubah,
lalu bot dinyalakan ulang dan dashboard terbuka. Di folder yang berupa git
checkout, update memakai `git pull --ff-only`.

Menu admin (hentikan, status, log, copot auto-start): klik kanan
`scripts\launcher.ps1` > Run with PowerShell.

Hanya boleh **satu proses bot per database**; launcher menolak menyalakan bot kedua.

## Konsol admin

Buka **http://127.0.0.1:3001/** di PC bot (menu "Buka halaman QR"). Ada mode terang/gelap dan tampilan HP.

| Halaman | Isinya |
| --- | --- |
| Ringkasan | status bot + hitung mundur jam aktif, timeline hari ini, angka utama, QR/nomor, pelanggan yang perlu CS, daftar kesiapan |
| Percakapan | daftar chat (cari, filter "perlu CS"), isi chat ala WhatsApp, posisi di alur, tombol "CS ambil alih" / "Kembalikan ke bot" |
| Template balasan | semua kalimat bot (bawaan = naskah klien), bisa diubah dengan pratinjau WhatsApp, isian `{nama}` `{produk}` `{cs}`, dan tombol kembalikan ke naskah asli |
| Coba bot | simulator berbentuk HP: ketik seperti pelanggan, lihat balasan dan maksud yang dikenali. Tidak ada yang terkirim |
| Latih bot | pesan pelanggan yang tidak dimengerti bot, dengan tombol **Ajarkan**; kata kunci dari tim langsung berlaku |
| Statistik | pesan per hari, jam ramai, pertanyaan terbanyak, alasan diserahkan ke CS |
| Media | **unggah** katalog (bisa beberapa halaman), size chart, katalog review, pamflet promo jersey; pratinjau & hapus |
| Pengaturan | nama bot/CS, jam aktif, teks promo, nomor rekap + tombol "Kirim rekap uji", folder backup (Google Drive/OneDrive terdeteksi otomatis) + "Backup sekarang" |

## Seberapa pintar bot ini

Balasan **selalu** naskah tetap dari spesifikasi; yang pintar hanya bagian mengenali maksud:

- **Beberapa pertanyaan sekaligus**: "mau bikin jersey, minimal berapa? lokasinya di mana?"
  dijawab semuanya, dan pertanyaan lanjutan bot ("mau bikin berapa?") selalu di akhir.
- **Tahan typo**: "hoddie", "lanyrd", "lokais", "portopolio" tetap dikenali (kata pendek tetap harus tepat).
- **Bisa diajari tim** lewat halaman Latih bot, tanpa mengubah kode.
- **AI opsional** (`ANTHROPIC_API_KEY`) untuk bahasa yang tidak tertangkap kata kunci; kalau AI gagal, kembali ke kata kunci.

## Tugas harian otomatis

| Tugas | Kapan | Pengaturan |
| --- | --- | --- |
| Rekap pelanggan semalam ke WhatsApp CS | 07.30, Senin–Sabtu | nomor di Pengaturan (kosong = mati) |
| Backup database | 03.00 | folder di Pengaturan, simpan 14 hari |
| Hapus isi chat lama | 03.00 | lebih dari 90 hari |

Kalau PC mati pada jamnya, tugas tetap jalan begitu PC menyala lagi.
**Pilih folder backup yang keluar dari PC ini** (folder Google
Drive/OneDrive, NAS, atau flashdisk). Kalau database hilang, nomor harus
di-scan ulang dan riwayat percakapan ikut hilang.

Memulihkan backup: hentikan bot, salin `chatbot-YYYY-MM-DD.sqlite` ke
`data/chatbot.sqlite` (hapus `chatbot.sqlite-wal` dan `-shm`), lalu nyalakan lagi.

## Menjalankan manual (pengembangan)

```bash
npm install
cp .env.example .env
npm start                 # halaman QR: http://127.0.0.1:3001/
```

Untuk mencoba di siang hari, isi `BOT_FORCE=always` di `.env`.

## Mengenali maksud pelanggan

Tanpa `ANTHROPIC_API_KEY`, bot mengenali maksud dari kata kunci
(`src/bot/classify-rules.js`). Cara ini gratis dan offline, tetapi tidak akan
pernah menangkap semua cara orang bertanya; yang tidak dikenali diserahkan ke CS.

Dengan `ANTHROPIC_API_KEY`, maksud dikenali oleh AI. AI hanya memberi label,
tidak pernah menulis balasan. Kalau AI gagal (internet putus, limit, dsb.), bot
otomatis kembali ke kata kunci.

## Isi media

Lihat [media/README.md](media/README.md). Katalog, size chart, dan katalog
review harus berupa file di folder itu, bukan link.

## Perintah

```bash
npm test                         # seluruh tes
npm run dev                      # jalan ulang otomatis saat kode berubah
curl http://127.0.0.1:3001/stats # jumlah pesan per hari
```

# ChatBotWA
