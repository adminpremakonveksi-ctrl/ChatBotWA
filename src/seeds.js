/**
 * Seed data: everything the bot starts with. Migrations (src/migrations.js)
 * copy it into the database once; from then on the team owns it and edits,
 * adds or deletes it in the console. Changing this file only affects new
 * installs (and the "Kembalikan ke bawaan" buttons), never a running client.
 *
 * Keywords are stored normalised (see src/text.js), so "blm ada" is "belum ada".
 * Generated from the earlier built-in lists and SPEK-CHATBOT.md texts.
 */

/** Products. catalog = has a price list (catalog is sent); otherwise priced by design (asks for a reference). */
export const SEED_PRODUCTS = [
    {
        "key": "jersey",
        "name": "Jersey",
        "catalog": true,
        "sizeChart": true,
        "position": 0,
        "keywords": [
            "jersey",
            "jersy",
            "jersi",
            "jesrey",
            "baju bola",
            "baju futsal",
            "kaos bola",
            "kaos futsal",
            "baju olahraga",
            "seragam bola",
            "seragam futsal",
            "baju voli",
            "baju volly",
            "baju badminton",
            "baju sepeda",
            "baju esport",
            "baju e-sport",
            "baju basket",
            "jersey basket",
            "jersey printing",
            "bahan jersey",
            "kerah jersey",
            "jersey bola",
            "jersey futsal"
        ]
    },
    {
        "key": "id-card-lanyard",
        "name": "ID Card & Lanyard",
        "catalog": true,
        "sizeChart": false,
        "position": 1,
        "keywords": [
            "id card",
            "idcard",
            "id-card",
            "name tag",
            "nametag",
            "lanyard",
            "lanyar",
            "tali id",
            "tali name tag",
            "kartu nama peserta",
            "kartu panitia",
            "cetak id card",
            "paket idcard",
            "paket id card"
        ]
    },
    {
        "key": "gantungan-kunci",
        "name": "Gantungan Kunci",
        "catalog": true,
        "sizeChart": false,
        "position": 2,
        "keywords": [
            "gantungan kunci",
            "gantungan",
            "ganci",
            "keychain",
            "key chain",
            "gantungan konci"
        ]
    },
    {
        "key": "bendera-printing",
        "name": "Bendera Printing",
        "catalog": true,
        "sizeChart": false,
        "position": 3,
        "keywords": [
            "bendera",
            "flag",
            "umbul",
            "umbul umbul",
            "panji",
            "banner bendera"
        ]
    },
    {
        "key": "kaos",
        "name": "Kaos",
        "catalog": false,
        "sizeChart": true,
        "position": 4,
        "keywords": [
            "kaos",
            "kaus",
            "t-shirt",
            "tshirt",
            "tee",
            "baju kaos",
            "kaos komunitas",
            "kaos sablon",
            "sablon",
            "kaos oblong",
            "kaos polos",
            "oversize",
            "boxy",
            "kaos kelas",
            "kaos angkatan",
            "kaos sekolah",
            "two tone",
            "two-tone",
            "twotone"
        ]
    },
    {
        "key": "pdl",
        "name": "PDL",
        "catalog": false,
        "sizeChart": true,
        "position": 5,
        "keywords": [
            "pdl",
            "pdh",
            "baju lapangan",
            "kemeja lapangan",
            "seragam lapangan",
            "baju dinas",
            "kemeja pdl",
            "pdl 2in1"
        ]
    },
    {
        "key": "kemeja",
        "name": "Kemeja",
        "catalog": false,
        "sizeChart": true,
        "position": 6,
        "keywords": [
            "kemeja",
            "hem",
            "baju kantor",
            "seragam kantor",
            "batik"
        ]
    },
    {
        "key": "polo",
        "name": "Polo Shirt",
        "catalog": false,
        "sizeChart": true,
        "position": 7,
        "keywords": [
            "polo",
            "poloshirt",
            "kaos kerah",
            "kaos berkerah",
            "polo shirt"
        ]
    },
    {
        "key": "rompi",
        "name": "Rompi",
        "catalog": false,
        "sizeChart": true,
        "position": 8,
        "keywords": [
            "rompi",
            "vest",
            "romp"
        ]
    },
    {
        "key": "jaket",
        "name": "Jaket",
        "catalog": false,
        "sizeChart": true,
        "position": 9,
        "keywords": [
            "jaket",
            "jacket",
            "jaket bomber",
            "bomber",
            "varsity",
            "windbreaker",
            "parasut",
            "jaket angkatan"
        ]
    },
    {
        "key": "hoodie",
        "name": "Hoodie",
        "catalog": false,
        "sizeChart": true,
        "position": 10,
        "keywords": [
            "hoodie",
            "hodie",
            "hoody",
            "sweater",
            "crewneck",
            "sweatshirt",
            "zipper hoodie"
        ]
    },
    {
        "key": "topi",
        "name": "Topi",
        "catalog": false,
        "sizeChart": false,
        "position": 11,
        "keywords": [
            "topi",
            "cap",
            "snapback",
            "trucker",
            "bucket hat"
        ]
    },
    {
        "key": "tote-bag",
        "name": "Tote Bag",
        "catalog": false,
        "sizeChart": false,
        "position": 12,
        "keywords": [
            "totebag",
            "tote bag",
            "tote",
            "tas kain",
            "goodie bag",
            "goodiebag",
            "tas spunbond"
        ]
    },
    {
        "key": "seragam-sekolah",
        "name": "Seragam",
        "catalog": false,
        "sizeChart": true,
        "position": 13,
        "keywords": [
            "seragam",
            "wearpack",
            "werpack",
            "baju kerja",
            "baju bengkel",
            "seragam kerja",
            "baju olahraga sekolah",
            "osis",
            "mpk",
            "pramuka",
            "paskibra",
            "paskib",
            "pks",
            "pmr",
            "seragam sekolah",
            "baju sekolah",
            "seragam osis",
            "baju osis",
            "baju pramuka"
        ]
    }
];

/** Keywords of the built-in flow answers, by intent. */
export const SEED_KEYWORDS = {
    "size_chart": [
        "size chart",
        "sizechart",
        "size cart",
        "sizecart",
        "tabel ukuran",
        "daftar ukuran",
        "ukuran",
        "ukurannya",
        "size",
        "sizenya",
        "size nya",
        "sizes",
        "lingkar dada",
        "panjang baju",
        "lebar baju"
    ],
    "design_reference": [
        "referensi desain",
        "referensi design",
        "contoh desain",
        "contoh design",
        "contoh produk",
        "contoh hasil",
        "contoh jersey",
        "contoh kaos",
        "template",
        "templete",
        "portofolio",
        "portfolio",
        "katalog desain",
        "katalog design",
        "pilihan desain",
        "pilihan design",
        "model desain",
        "model design",
        "lihat desain",
        "liat desain",
        "hasil produksi",
        "hasil jadinya",
        "desain apa saja",
        "desain apa aja",
        "design apa aja",
        "ada desain",
        "ada design",
        "ada contoh",
        "minta contoh",
        "minta katalog",
        "katalog",
        "catalog",
        "pricelist",
        "price list",
        "daftar harga"
    ],
    "no_reference": [
        "belum ada",
        "belum punya",
        "gak ada",
        "nggak ada",
        "enggak ada",
        "tidak ada",
        "belum kepikiran",
        "bingung",
        "terserah",
        "belum tau",
        "belum tahu",
        "masih bingung",
        "belum ada desain",
        "belum ada referensi",
        "belum"
    ],
    "has_reference": [
        "sudah ada",
        "udah ada",
        "sudah punya",
        "udah punya",
        "ada kok",
        "ini desainnya",
        "ini designnya",
        "kayak gini",
        "seperti ini",
        "seperti gambar",
        "kaya gini"
    ],
    "quantity": [],
    "greeting": [
        "halo",
        "hallo",
        "helo",
        "hai",
        "hi",
        "hello",
        "permisi",
        "assalamualaikum",
        "asalamualaikum",
        "assalamu alaikum",
        "salam",
        "selamat malam",
        "selamat pagi",
        "selamat siang",
        "selamat sore",
        "malam",
        "pagi",
        "siang",
        "sore",
        "p",
        "test",
        "tes",
        "kak",
        "min",
        "admin",
        "gan",
        "sis",
        "om"
    ]
};

/**
 * Built-in answers that are plain question -> answer: seeded as answer
 * patterns ("Pola jawaban"), fully editable and deletable. `builtin` keeps
 * the link to the AI label of the same meaning; `templates` names the
 * earlier editable templates whose team edits are carried over.
 */
export const SEED_PATTERNS = [
    {
        "builtin": "location",
        "name": "Lokasi",
        "keywords": [
            "lokasi",
            "lokasinya",
            "alamat",
            "alamatnya",
            "shareloc",
            "share lokasi",
            "sharelok",
            "serlok",
            "sherlok",
            "maps",
            "gmaps",
            "google maps",
            "titik lokasi",
            "dimana tempatnya",
            "di mana tempatnya",
            "tempatnya dimana",
            "tempatnya di mana",
            "tokonya dimana",
            "tokonya di mana",
            "kantornya dimana",
            "workshopnya",
            "bisa datang",
            "datang langsung",
            "mampir",
            "main ke tempat",
            "ke toko",
            "offline store",
            "jam buka",
            "buka jam berapa"
        ],
        "bubbles": [
            {
                "type": "text",
                "text": "Silahkan buat sharelocnya ya kak. Lokasi kami ada di Jl. H. Agus Salim, Purworejo, Jawa Tengah. Jam operasional mulai dari 8.30 sd 17.00 ya kak.\n\nnb. Setiap hari Minggu pelayanan offline libur."
            },
            {
                "type": "link",
                "url": "https://maps.app.goo.gl/VcEFAFZVhP2x6o91A"
            }
        ],
        "templates": [
            "location",
            "locationMap"
        ]
    },
    {
        "builtin": "shipping",
        "name": "Pengiriman",
        "keywords": [
            "kirim dari",
            "dikirim dari",
            "pengiriman dari",
            "ngirim dari",
            "ongkir",
            "ongkos kirim",
            "ekspedisi",
            "luar kota",
            "luar pulau",
            "luar jawa",
            "bisa kirim",
            "bisa dikirim",
            "kirim ke",
            "dikirim ke",
            "pengiriman ke",
            "kirimnya dari",
            "produksi dimana",
            "produksi di mana",
            "lokasi produksi",
            "posisi dimana",
            "posisi di mana",
            "jauh gak",
            "dikirim pakai apa"
        ],
        "bubbles": [
            {
                "type": "text",
                "text": "Pengiriman dari Purworejo, Jawa Tengah ya kak, namun jangan khawatir, kami melayani pengiriman keluar kota melalui rekanan ekspedisi. Kami sudah memiliki pelanggan dari Sabang - Merauke kak, jadi kami sudah terbiasa menghandle pengiriman ke luar daerah dengan ongkos kirim ekonomis mulai dari Rp 1.000/piece. 😇"
            }
        ],
        "templates": [
            "shipping"
        ]
    },
    {
        "builtin": "trust",
        "name": "Ragu / takut ditipu",
        "keywords": [
            "penipu",
            "penipuan",
            "nipu",
            "tipu",
            "ketipu",
            "scam",
            "abal",
            "amanah",
            "terpercaya",
            "aman gak",
            "aman nggak",
            "aman tidak",
            "aman kan",
            "beneran",
            "bisa dipercaya",
            "takut",
            "ragu",
            "khawatir",
            "was was",
            "legit",
            "testimoni",
            "testi",
            "review",
            "bukti",
            "garansi",
            "trusted",
            "resmi gak",
            "rekber"
        ],
        "bubbles": [
            {
                "type": "text",
                "text": "Aman kakk, kami sudah vendor nasional kok. Kakak bisa cek portofolio kami kak, kami memiliki pelanggan dari Sabang sampai Merauke, jadi kakak tidak perlu khawatir. Setiap produk yang kami produksi juga bergaransi, misal ada ketidaksesuaian bisa digaransikan tanpa biaya tambahan. 😁"
            },
            {
                "type": "slot",
                "slot": "katalog-review"
            }
        ],
        "templates": [
            "trust"
        ]
    },
    {
        "builtin": "moq",
        "name": "Minimal order",
        "keywords": [
            "minimal",
            "minimum",
            "min order",
            "minorder",
            "min pesan",
            "moq",
            "paling sedikit",
            "paling dikit",
            "minim order",
            "bisa satuan",
            "satuan",
            "eceran",
            "ecer",
            "cuma 1",
            "cuma satu",
            "cuma 2",
            "cuma 3",
            "hanya 1",
            "hanya satu",
            "1 pcs aja",
            "1 aja",
            "satu aja",
            "sedikit aja",
            "dikit aja",
            "bisa sedikit"
        ],
        "bubbles": [
            {
                "type": "text",
                "text": "Untuk minimum pemesanan, tiap produk berbeda ya kak 😊\n\n• Kaos: bisa mulai 1 pcs, khusus bahan Cotton Combed 30s dengan pilihan warna marun, navy, army, putih, atau hitam. Kalau pesan lebih dari 12 pcs, warna dan jenis bahan bisa request.\n• Bendera Printing: bisa mulai dari 1 pcs."
            },
            {
                "type": "text",
                "text": "Untuk produk lainnya:\n\n• PDL, Rompi, Jersey, serta Paket ID Card & Lanyard: minimal 6 pcs\n• Produk selain yang disebutkan di atas: minimal 12 pcs\n\nKalau kakak sudah tahu mau bikin produk apa dan jumlahnya berapa, boleh langsung diinfokan ya kak 😄"
            }
        ],
        "templates": [
            "moq1",
            "moq2"
        ]
    }
];

/** A few team-style examples so "Latih bot" is not empty on a fresh install. */
export const SEED_STARTER_KEYWORDS = [
    {
        "phrase": "contoh foto",
        "intent": "design_reference"
    },
    {
        "phrase": "baju tim",
        "intent": "product",
        "product": "jersey"
    },
    {
        "phrase": "kaos panitia",
        "intent": "product",
        "product": "kaos"
    },
    {
        "phrase": "kaos kelas",
        "intent": "product",
        "product": "kaos"
    }
];
