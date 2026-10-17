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
   (sekarang: `https://github.com/adminpremakonveksi-ctrl/ChatBotWA main`).
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
| Pola jawaban | pola buatan tim (mis. "Ukuran"): kata kunci + jawaban bergelembung (teks dengan variasi `---`, foto, produk katalog WA, link), jadwal berlaku, lanjut atau serahkan ke CS |
| Latih bot | pesan pelanggan yang tidak dimengerti bot, dengan tombol **Ajarkan** (ke jawaban bawaan atau ke pola); kata kunci dari tim langsung berlaku |
| Statistik | pesan per hari, jam ramai, pertanyaan terbanyak, corong percakapan, pola terpakai, alasan diserahkan ke CS |
| Media | katalog WhatsApp Business (sinkron otomatis, pemetaan item ke produk), link katalog, **unggah** gambar katalog/size chart/review/pamflet promo |
| Pengaturan | nama bot/CS, jam aktif, **mode libur** (tanggal bot berjaga 24 jam), nomor rekap + tombol "Kirim rekap uji", folder backup (Google Drive/OneDrive terdeteksi otomatis) + "Backup sekarang" |

## Seberapa pintar bot ini

Balasan **selalu** naskah tetap dari spesifikasi; yang pintar hanya bagian mengenali maksud:

- **Beberapa pertanyaan sekaligus**: "mau bikin jersey, minimal berapa? lokasinya di mana?"
  dijawab semuanya, dan pertanyaan lanjutan bot ("mau bikin berapa?") selalu di akhir.
- **Tahan typo**: "hoddie", "lanyrd", "lokais", "portopolio" tetap dikenali (kata pendek tetap harus tepat).
- **Paham singkatan chat**: brp, gmn, dmn, bs, gk, blm, pesen, klo, sz, dst.
- **Bisa diajari tim** lewat halaman Latih bot, dan **pola jawaban** buatan tim dipakai sebelum jawaban bawaan.
- **Katalog WhatsApp Business**: produk yang cocok dikirim sebagai link produk (maks. 3, promo didahulukan).
- **Anti-ulang**: kalimat yang sama paling banyak 2x per pelanggan dalam 10 menit; lebih dari itu diserahkan ke CS.
- **AI opsional: Ollama** (Ollama Cloud dengan `OLLAMA_API_KEY`, atau Ollama lokal dengan `OLLAMA_HOST`), hanya untuk pesan yang tidak tertangkap kata kunci; kalau AI gagal, kembali ke kata kunci.
- **Tidak gampang menyerah**: pesan yang tidak dipahami dibalas "Maaf kak, belum paham…" dulu; baru diserahkan ke CS setelah 3x berturut-turut (atur di Pengaturan), atau kalau pelanggan minta bicara dengan admin/CS.
- **Bahasa Jawa dan Sunda** dimengerti: "pinten regane", "lokasine ten pundi", "kulo Slamet saking Kutoarjo".
- **Pertanyaan lanjutan per produk** ("kemeja jenis apa? ukurannya apa saja?"), jawabannya muncul di Percakapan dan rekap pagi.
- **Salam otomatis WhatsApp Business** dikenali, tidak dikira CS yang membalas.
- **Setiap error tampil** sebagai kotak merah berisi detail mentahnya, untuk difoto dan dikirim ke developer.

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

Bot selalu mengenali maksud dari kata kunci dulu (`src/bot/classify-rules.js`):
gratis, offline, instan, dan diuji untuk lima gaya chat (singkat/typo, santai,
standar, Jawa/Sunda, formal) di `test/levels.test.js`.

Kalau Ollama diatur (`OLLAMA_API_KEY` untuk Ollama Cloud, atau `OLLAMA_HOST`
untuk Ollama lokal; model di `OLLAMA_MODEL`, bawaan `gemma4:31b`), pesan yang
**tidak** dikenali kata kunci ditanyakan ke AI. AI hanya memberi label, tidak
pernah menulis balasan; label di luar daftar ditolak. Kalau AI gagal (internet
putus, limit, dsb.), bot tetap memakai hasil kata kunci.

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
