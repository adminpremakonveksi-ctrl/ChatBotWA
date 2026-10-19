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

/**
 * Seeds added after the first release, each brought to existing installs by
 * the migration named here. A fresh install gets them too: they are merged
 * into the lists above, so the first seeding and "Kembalikan ke bawaan"
 * include them.
 *
 * To teach every client something new: add an entry with a new migration id,
 * and a migration that calls syncSeeds(db, '<id>') (see migrations.js).
 * Never change an entry that has shipped.
 */
export const SEED_ADDITIONS = [
    {
        migration: '005_smarter_seeds',
        keywords: {
            // "Mau nanya2 dulu": wants to ask first; the bot invites the question instead of closing the chat.
            ask_first: [
                'mau tanya', 'mau nanya', 'mau tanya tanya', 'mau nanya nanya', 'tanya dulu', 'nanya dulu', 'tanya tanya dulu',
                'nanya nanya dulu', 'boleh tanya', 'boleh nanya', 'izin tanya', 'ijin tanya', 'izin bertanya', 'ijin bertanya',
                'numpang tanya', 'mau bertanya', 'ingin bertanya', 'pengen tanya', 'pengen nanya', 'cuma tanya', 'cuma nanya',
                'sekedar tanya', 'sekadar tanya', 'tanya aja', 'nanya aja', 'tanya tanya aja', 'nanya nanya aja', 'lihat lihat dulu',
                'liat liat dulu', 'masih survey', 'masih survei', 'survey dulu', 'survei dulu', 'cari info', 'nyari info',
                'mau info', 'minta info', 'butuh info', 'mau konsultasi', 'konsul dulu', 'belum mau pesan', 'belum mau order',
                'belum jadi pesan', 'masih rencana', 'baru rencana', 'masih tanya tanya',
             'tanya', 'nanya', 'bertanya', 'konsultasi',
             'menanyakan', 'ditanyakan', 'pertanyaan',
            ],
            // "ok", "makasih kak" on their own: nothing to answer, so the bot does not hand over for them.
            ack: [
                'ok', 'oke', 'okey', 'okay', 'okeh', 'okee', 'siap', 'sip', 'baik', 'baiklah', 'noted', 'iya', 'iyah', 'ya', 'yap', 'yup',
                'nggih', 'njih', 'enggih', 'oh', 'oo', 'oalah', 'owh', 'mantap', 'mantab', 'mantul', 'makasih', 'terima kasih',
                'terimakasih', 'trimakasih', 'matur nuwun', 'maturnuwun', 'suwun', 'thanks', 'thank you', 'thankyou', 'ditunggu',
                'saya tunggu', 'aku tunggu', 'tak tunggu', 'sama sama', 'paham', 'mengerti', 'dimengerti', 'deh', 'dong',
            ],
            // "harganya berapa?": with no product, ask which; with one, its catalog or [4].
            price: [
                'harga', 'kisaran harga', 'range harga', 'biaya', 'tarif', 'ongkos produksi', 'budget', 'bujet', 'murah',
                'mahal', 'diskon', 'potongan harga', 'per pcs berapa', 'satu pcs berapa', 'per biji berapa', 'habis berapa', 'kena berapa',
            ],
            greeting: ['hay', 'hy', 'hey', 'misi', 'punten', 'kulonuwun', 'sugeng', 'pp', 'ping'],
            no_reference: [
                'belum ada gambaran', 'belum ada bayangan', 'belum kebayang', 'blank', 'gak tau', 'nggak tau', 'ga tau', 'tidak tahu',
                'kurang tahu', 'bebas', 'ikut aja', 'ngikut', 'dibantu desain', 'dibuatin desain', 'dibikinin desain',
                'minta dibuatkan desain', 'bisa bantu desain', 'desain dari sana', 'desain dari prema', 'belum ada logo',
            ],
            has_reference: [
                'sudah ada desain', 'udah ada desain', 'desain sendiri', 'sudah jadi', 'udah jadi', 'filenya ada',
                'file nya ada', 'ada gambarnya', 'nanti saya kirim', 'nanti aku kirim', 'saya kirim', 'aku kirim', 'seperti contoh',
                'kayak contoh', 'mirip', 'warna', 'logo', 'tulisan', 'nomor punggung', 'nama punggung',
            ],
            quantity: ['selusin', 'sekodi', 'satu tim', 'satu kelas', 'satu angkatan', 'satu kantor', 'sekelas', 'setim', 'seangkatan'],
            size_chart: ['ukuran apa saja', 'ukuran apa aja', 'size apa aja', 'size apa saja', 'ada size', 'ada ukuran', 'xxl', 'xxxl', 'jumbo', 'big size', 'ukuran anak', 'size anak'],
            design_reference: ['contoh model', 'model apa aja', 'model apa saja', 'pilihan model', 'lihat contoh', 'liat contoh', 'foto produk', 'foto hasil', 'hasil sablon', 'galeri', 'jualan apa', 'jual apa'],
        },
        products: {
            jersey: ['jersey sepeda', 'jersey voli', 'jersey badminton', 'jersey esport', 'jersey kantor', 'jersey komunitas', 'seragam tim', 'kostum bola', 'kostum futsal'],
            kaos: ['kaos event', 'kaos acara', 'kaos keluarga', 'kaos reuni', 'kaos lari', 'kaos couple', 'kaos dakwah', 'kaos lengan panjang'],
            pdl: ['pdl angkatan', 'pdh angkatan', 'baju organisasi', 'kemeja organisasi'],
            jaket: ['jaket komunitas', 'jaket kampus', 'jaket motor'],
            hoodie: ['hoodie angkatan', 'hoodie komunitas', 'switer', 'sweter'],
            'id-card-lanyard': ['tali lanyard', 'gantungan id card', 'kartu identitas'],
            'bendera-printing': ['bendera printing', 'bendera custom', 'bendera komunitas', 'bendera kampus'],
            'tote-bag': ['tas belanja', 'tas seminar'],
        },
        patterns: {
            location: ['lokasi toko', 'alamat toko', 'alamat lengkap', 'posisi toko', 'patokan', 'rute', 'purworejo mana', 'bisa ke tempat', 'boleh datang', 'kunjungan', 'jam operasional', 'jam kerja', 'buka sampai', 'tutup jam', 'minggu buka', 'tempat dimana', 'toko dimana', 'alamat dimana', 'dimana alamat', 'dimana lokasi', 'dimana toko', 'dimana tempat', 'daerah mana'],
            shipping: ['bisa cod', 'cod', 'jne', 'jnt', 'j&t', 'sicepat', 'kargo', 'cargo', 'kirim luar negeri', 'sampai berapa hari', 'estimasi pengiriman', 'kirim ke luar', 'pengiriman', 'dikirim dari mana', 'kirimnya dari mana', 'dari mana kirim', 'antar ke', 'diantar', 'dikirim pakai'],
            trust: ['aman ga', 'beneran ada', 'toko asli', 'asli gak', 'pernah order', 'feedback', 'ulasan', 'rating', 'takut kecewa', 'kualitas', 'ditipu', 'dibohongi', 'bohong', 'tertipu'],
            moq: ['minimal pesan', 'minimal order', 'minimal berapa', 'min berapa', 'paling sedikit berapa', 'bisa 1', 'bisa satu', 'bisa 2', 'bisa dua', 'pesan 1', 'order 1', 'beli 1', 'beli satu', 'gak banyak', 'nggak banyak', 'sedikit saja', 'pesan sedikit', 'order sedikit', 'beli sedikit', 'sedikit bisa', 'pesan satuan', 'order satuan', 'jumlah minimal', 'minimal jumlah', 'pesan satu', 'order satu', 'beli satu', 'pesan dua', 'satu bisa', 'satu saja'],
        },
    },
];

// More ways of saying the same things, across the five chat levels (short,
// casual, standard, Javanese/Sundanese, formal). Same migration as above.
// Javanese words are written as customers type them; normalise() turns them
// into Indonesian, so the stored keyword is the Indonesian form.
SEED_ADDITIONS.push({
    migration: '005_smarter_seeds',
    keywords: {
        greeting: [
            'met malam', 'met pagi', 'met siang', 'met sore', 'malem', 'malem kak', 'slmt malam', 'assalamualaikum wr wb', 'asw',
            'ass', 'samlekom', 'shalom', 'om swastiastu', 'halo admin', 'halo min', 'hai kak', 'hallo kak', 'helo kak', 'misi kak',
            'sugeng enjing', 'sugeng siang', 'sugeng sonten', 'sugeng dalu', 'wilujeng enjing', 'wilujeng wengi', 'sampurasun', 'rampes',
            'kulonuwun mas', 'nuwun sewu', 'test', 'tes',
        ],
        size_chart: [
            'size chartnya', 'size chat', 'sizechat', 'tabel size', 'list ukuran', 'list size', 'pilihan ukuran', 'pilihan size',
            'ukuran tersedia', 'size tersedia', 'size ready', 'ukuran ready', 'ukuran paling besar', 'ukuran paling kecil', 'size terbesar',
            'size terkecil', 'ukuran s', 'ukuran m', 'ukuran l', 'ukuran xl', 'ukuran 3xl', 'ukuran 4xl', 'ukuran 5xl', '3xl', '4xl', '5xl',
            'size dewasa', 'ukuran dewasa', 'ukuran cewek', 'ukuran cowok', 'size cewek', 'size cowok', 'ukuran wanita', 'ukuran pria',
            'lebar dada', 'panjang lengan', 'ld berapa', 'pb berapa', 'muat badan', 'badan gede', 'badan besar', 'kegedean', 'kekecilan',
            'pas di badan', 'cara ukur', 'cara mengukur', 'ukuranipun', 'ukurane pinten', 'ukurane nopo mawon', 'size e',
        ],
        design_reference: [
            'contoh jadinya', 'contoh yang sudah jadi', 'hasil jadi', 'hasil karya',  'project sebelumnya', 'proyek sebelumnya',
            'orderan sebelumnya', 'pesanan sebelumnya', 'yang pernah dibuat', 'yang pernah dibikin', 'pernah bikin apa aja', 'desain desain',
            'desain terbaru', 'model terbaru', 'model kekinian', 'desain kekinian', 'inspirasi desain', 'ide desain', 'mockup', 'mock up',
            'katalognya', 'catalognya', 'e katalog', 'brosur', 'pamflet', 'list produk', 'daftar produk', 'produk apa aja', 'produk apa saja',
            'bisa bikin apa aja', 'bisa bikin apa saja', 'jual apa aja', 'melayani apa saja', 'menerima pembuatan apa', 'telegram',
            'conto desain', 'contone', 'conto', 'nyuwun conto', 'pirsani contone',
        ],
        no_reference: [
            'belum ada konsep', 'belum ada ide', 'belum punya ide', 'belum punya konsep', 'belum punya gambaran', 'belum nemu',
            'belum dapat', 'belum dapet', 'nggak punya', 'gak punya', 'tidak punya', 'nol', 'kosong', 'masih kosong', 'masih mikir',
            'masih dipikir', 'nanti dipikir', 'mau dibuatkan', 'tolong buatkan', 'tolong desainkan', 'desainkan', 'bantu buatkan',
            'minta didesainkan', 'minta dibantu', 'dibantu saja', 'dibantu aja', 'serahkan ke kakak', 'pilihkan', 'rekomendasi kakak',
            'saran kakak', 'yang bagus menurut kakak', 'yang penting bagus', 'yang simple aja', 'simpel aja', 'polos aja',
            'dereng gadhah', 'durung nduwe', 'mboten gadhah', 'ora nduwe', 'dereng kepikiran', 'durung kepikiran', 'bingung mas',
            'teu acan', 'teu gaduh', 'acan aya',
        ],
        has_reference: [
            'gambar', 'foto', 'screenshot', 'ss', 'pdf', 'cdr', 'corel', 'psd', 'png', 'jpg', 'vektor', 'vector', 'pantone', 'motif',
            'konsep', 'tema', 'kombinasi', 'gradasi', 'sablon depan', 'sablon belakang', 'bordir', 'printing', 'polos depan', 'nama dan nomor',
            'ini contohnya', 'ini contoh', 'ini referensinya', 'ini gambarnya', 'nih kak', 'begini kak', 'kaya gini kak', 'model begini',
            'kados niki', 'koyo ngene', 'kaya ngene', 'niki desaine', 'iki desaine', 'sampun gadhah', 'wis nduwe',
        ],
        quantity: [
                  'ratusan', 'puluhan', 'dua lusin', 'tiga lusin',
            'setengah lusin', 'satu lusin', 'satu angkatan', 'satu sekolah', 'satu desa', 'satu rt', 'satu rw', 'satu komunitas', 'satu divisi',
            'semua anggota', 'semua karyawan', 'semua siswa', 'buat satu tim', 'buat sekelas',   
            'sakkelas', 'sak kelas', 'sak angkatan', 'sak tim',
        ],
        ask_first: [
            'tanya dikit', 'nanya dikit', 'tanya sedikit', 'nanya sedikit', 'tanya bentar', 'nanya bentar', 'tanya sebentar', 'boleh nanya ga',
            'boleh tanya ga', 'mau minta info', 'mau cari info', 'lagi cari info', 'lagi nyari', 'lagi cari vendor', 'cari vendor', 'nyari vendor',
            'bandingin', 'membandingkan', 'perbandingan', 'masih bandingin', 'masih pikir pikir', 'pikir pikir dulu', 'mau diskusi',
            'diskusi dulu', 'rapat dulu', 'tanya teman dulu', 'tanya ketua dulu', 'nunggu keputusan', 'belum fix', 'belum pasti',
            'mau tanya tanya', 'kepo', 'penasaran', 'badhe nyuwun pirsa', 'badhe tanglet', 'arep takon', 'tak takon', 'takon sik',
            'takon riyin', 'nyuwun informasi', 'hoyong naros', 'bade naros', 'naros heula', 'wawancara',
        ],
        ack: [
            'oke kak', 'ok kak', 'okey kak', 'siap kak', 'sip kak', 'baik kak', 'iya kak', 'ya kak', 'oke min', 'siap min', 'oke deh kak',
            'oke siap kak', 'oke sip', 'oke noted', 'noted kak', 'wokey', 'okelah', 'ok lah', 'yaudah', 'ya sudah', 'yasudah', 'udah cukup',
            'cukup kak', 'sudah jelas', 'jelas kak', 'paham kak', 'mengerti kak', 'oke paham', 'siap paham', 'mantap kak', 'keren kak',
            'thank', 'thanks kak', 'tengkyu', 'makasi', 'makaci', 'makasih banyak', 'terima kasih banyak', 'terimakasih banyak',
            'nuhun', 'hatur nuhun', 'mangga', 'monggo', 'sendiko dawuh', 'siap mas', 'siap mbak', 'sami sami', 'sami-sami', 'ok mas',
            'injih mas', 'nggih mas', 'nggih mbak', 'mantep', 'joss', 'sae', 'wis cukup',
        ],
        price: [
            'harga jual', 'harga jasa', 'harga sablon', 'harga bordir', 'harga bahan', 'harga paket', 'harga promo', 'harga terbaru',
            'harga per pcs', 'harga perpcs', 'harga satuannya', 'harga totalnya', 'total biaya', 'estimasi biaya', 'estimasi harga',
            'perkiraan harga', 'penawaran harga', 'minta penawaran', 'quotation',  'anggaran',   'ongkosnya',
            'bayarnya berapa', 'total berapa', 'jadi berapa', 'semua berapa', 'kena berapaan', 'mulai dari berapa', 'mulai berapa',
            'paling murah', 'termurah', 'yang murah', 'kemahalan', 'nego', 'bisa nego', 'bisa kurang', 'bisa dikurangi', 'harga pelajar',
            'harga mahasiswa', 'hargane', 'reginipun', 'regi pinten', 'rego piro', 'pira regane', 'sabaraha hargana', 'hargana',
        ],
    },
    products: {
        jersey: ['jersey tim', 'jersey sekolah', 'jersey kampus', 'jersey kelas', 'jersey custom', 'jersey printing full', 'jersey full print', 'baju bal', 'klambi bal', 'kaos bal', 'seragam voli', 'seragam basket', 'seragam badminton', 'kostum tim'],
        kaos: ['kaos custom', 'kaos desain sendiri', 'kaos komunitas motor', 'kaos organisasi', 'kaos kantor', 'kaos promosi', 'kaos kampanye', 'kaos partai', 'kaos 17an', 'kaos tujuh belasan', 'kaos agustusan', 'kaos jalan sehat', 'kaos fun run', 'kaos sekolah', 'kaos ospek', 'kaos mpls', 'kaos pengajian', 'kaos tpq', 'klambi kaos', 'kaos lengan pendek'],
        pdl: ['baju pdl', 'seragam pdl', 'pdl himpunan', 'pdh himpunan', 'pdl bem', 'baju himpunan', 'baju bem', 'seragam lapangan kampus'],
        kemeja: ['kemeja kantor', 'kemeja seragam', 'kemeja kerja', 'kemeja batik', 'seragam batik', 'hem kantor', 'kemeja lengan panjang', 'kemeja lengan pendek'],
        polo: ['polo kantor', 'polo seragam', 'kaos polo kantor', 'polo komunitas', 'polo bordir'],
        jaket: ['jaket organisasi', 'jaket himpunan', 'jaket bem', 'jaket kerja', 'jaket kantor', 'jaket couch', 'jaket coach', 'jaket parka', 'jaket varsity'],
        hoodie: ['hoodie kelas', 'hoodie kampus', 'hoodie custom', 'hoodie sablon', 'hoodie bordir', 'jumper', 'sweter angkatan'],
        topi: ['topi komunitas', 'topi bordir', 'topi sablon', 'topi baseball', 'topi rimba', 'topi custom', 'kupluk'],
        rompi: ['rompi kerja', 'rompi organisasi', 'rompi relawan', 'rompi proyek', 'rompi safety'],
        'tote-bag': ['tas kanvas', 'tas souvenir', 'tas custom', 'goodie bag seminar', 'tas sablon'],
        'id-card-lanyard': ['tali id card', 'tali nametag', 'id card panitia', 'id card karyawan', 'id card peserta', 'kartu peserta'],
        'gantungan-kunci': ['gantungan kunci custom', 'souvenir gantungan', 'ganci akrilik', 'gantungan akrilik'],
        'bendera-printing': ['bendera organisasi', 'bendera sekolah', 'bendera partai', 'bendera merah putih', 'bendera umbul umbul', 'umbul-umbul'],
        'seragam-sekolah': ['seragam kelas', 'seragam pramuka', 'seragam paskibra', 'seragam pmr', 'baju paskibra', 'baju pmr', 'seragam mpk', 'seragam olahraga'],
    },
    patterns: {
        location: [
            'lokasinya dmn', 'alamatnya dmn', 'tempatnya dmn', 'kantornya di mana', 'workshop', 'konveksinya dimana', 'konveksi dimana',
            'produksinya dimana', 'gudangnya dimana', 'tokonya buka', 'buka hari apa', 'buka jam', 'jam berapa buka', 'jam berapa tutup',
            'hari minggu buka', 'minggu libur', 'libur hari apa', 'sabtu buka', 'bisa diambil', 'ambil sendiri', 'ambil di tempat',
            'ambil langsung', 'pickup', 'pick up', 'datang ke toko', 'datang ke konveksi', 'ke lokasi', 'ke workshop', 'survei tempat',
            'lihat bahan langsung', 'cek bahan langsung', 'pegang bahan', 'kirim lokasi', 'kirim shareloc', 'minta lokasi', 'minta alamat',
            'minta maps', 'link maps', 'google map', 'titik', 'purworejo sebelah mana', 'agus salim', 'dekat mana', 'deket mana',
            'lokasine', 'alamate', 'panggenanipun', 'nggone ning endi', 'wonten pundi', 'dimana kak',
        ],
        shipping: [
            'ongkirnya', 'ongkir berapa', 'ongkos kirimnya', 'biaya kirim', 'biaya pengiriman', 'kirim pakai', 'kirim lewat', 'via apa',
            'pakai ekspedisi apa', 'ekspedisinya apa', 'jnt cargo', 'jne trucking', 'lion parcel', 'anteraja', 'ninja',  'gosend',
            'grab express', 'paxel', 'travel',  'dakota', 'indah cargo', 'kirim ke rumah', 'diantar ke rumah', 'sampai rumah',
            'sampai alamat', 'bisa antar', 'bisa diantar', 'antar jemput', 'free ongkir', 'gratis ongkir', 'subsidi ongkir',
            'luar provinsi', 'luar negeri', 'antar kota', 'antar pulau', 'sumatra', 'sumatera', 'kalimantan', 'sulawesi', 'papua', 'ntt', 'ntb',
            'berapa lama sampai', 'berapa hari sampai', 'nyampe berapa hari', 'lama pengiriman',  'packing', 'dikintun pundi',
            'saged dikintun', 'iso dikirim', 'kintun mriki', 'dikirim mriki', 'dikirim ke sini', 'kirim ke sini',
        ],
        trust: [
            'beneran kan', 'asli kan', 'resmi', 'legal', 'terdaftar', 'punya izin',    'badan usaha', 'sudah lama berdiri',
            'berdiri sejak', 'berapa tahun', 'pengalaman', 'jam terbang', 'sudah berapa lama',    
            'kepuasan', 'puas', 'kecewa', 'zonk', 'ga sesuai', 'tidak sesuai', 'nggak sesuai', 'beda sama foto', 'retur', 'refund', 'uang kembali',
            'jaminan', 'dijamin', 'bisa dipertanggungjawabkan', 'kepercayaan', 'percaya', 'yakin', 'meyakinkan', 'kredibel', 'kredibilitas',
            'track record', 'rekam jejak', 'bukti pengiriman', 'bukti order', 'bukti transfer', 'google review', 'bintang', 'instagramnya',
            'ig resmi', 'akun resmi', 'shopee', 'tokopedia', 'marketplace', 'rekening bersama', 'bayar setelah barang', 'bayar di tempat',
            'apus apus', 'ngapusi', 'diapusi', 'tenan to', 'temenan', 'saestu', 'amanah mboten', 'percados', 'leres',
        ],
        moq: [
            'min pesan berapa', 'minimal pemesanan', 'minimum pemesanan', 'minimum order', 'min beli', 'minimal beli', 'minimal produksi',
            'minimum produksi', 'jumlah minimum', 'jumlah minimal', 'paling sedikit', 'paling dikit', 'syarat minimal', 'ketentuan minimal',
            'harus berapa', 'harus banyak', 'wajib berapa', 'bisa satuan kah', 'terima satuan', 'menerima satuan', 'satuan bisa',
            'cuma 5', 'cuma 6', 'cuma 10', 'hanya 5', 'hanya 6', 'hanya 10', 'cuma butuh', 'hanya butuh', 'cuma perlu', 'butuh sedikit',
            'jumlah sedikit', 'jumlahnya sedikit', 'dikit doang', 'sedikit doang', 'ga banyak', 'tidak banyak', 'sak pcs', 'sakpcs', 'siji wae',
            'setunggal mawon', 'sekedhik mawon', 'minimale', 'minimal pinten', 'paling sithik', 'paling sekedhik', 'sabaraha minimal',
        ],
    },
});

// Third round: phrasings seen in real chats and from the Ollama tests.
SEED_ADDITIONS.push({
    migration: '007_more_variations',
    keywords: {
        // Asks for a person: the one quick way to CS.
        human: [
            'mau ngobrol sama admin', 'ngobrol sama admin', 'sama admin aja', 'sama cs aja', 'bicara dengan cs', 'bicara dengan admin',
            'ngobrol sama cs', 'chat sama admin', 'minta nomor cs', 'minta nomor admin', 'nomor cs', 'nomor admin', 'nomor wa admin',
            'minta dihubungi', 'tolong hubungi', 'telpon aja', 'bisa telpon', 'bisa ditelpon', 'bisa telepon', 'bisa ditelepon',
            'video call', 'sama orang aja', 'dengan manusia', 'sama manusia', 'bukan bot', 'jangan bot', 'admin asli', 'cs asli',
            'tolong admin', 'panggil admin', 'panggilkan admin', 'hubungi admin', 'minta admin', 'mau sama admin', 'mau sama cs',
            'langsung ke admin', 'langsung ke cs', 'oper ke admin', 'sambungkan ke admin', 'badhe kalih admin', 'kalih admin mawon',
        ],
        greeting: ['selamat pagi kak', 'selamat malam kak', 'malam min', 'pagi min', 'assalamualaikum kak', 'halo prema', 'halo konveksi', 'permisi kak', 'permisi min'],
        price: [
            'harga borongan', 'harga grosiran', 'harga partai', 'potongan', 'diskon kalau banyak', 'murah kalau banyak', 'harga khusus',
            'harga kaos', 'harga jersey', 'harga jaket', 'harga hoodie', 'harga kemeja', 'harga pdh', 'harga pdl', 'harga topi',
            'cek harga', 'info harga', 'tanya harga',
        ],
        ask_first: [
            'mau konsul', 'konsultasi dulu', 'mau tanya2', 'tanya2 dulu', 'tanya tanya kak', 'nanya nanya kak', 'ada yang mau ditanyakan',
            'mau nanya sesuatu', 'mau tanya sesuatu', 'boleh minta waktunya', 'minta info dulu', 'cari referensi dulu', 'cuma mau tau',
            'sekedar info', 'sekadar info', 'buat perbandingan', 'masih nimbang', 'masih menimbang', 'lagi survei harga',
        ],
        ack: [
            'oke kak siap', 'siap kak terima kasih', 'baik kak terima kasih', 'okee kak', 'okeyy', 'sipp kak', 'mantap kak makasih',
            'baik terima kasih', 'baiklah kak', 'iya kak siap', 'iya kak makasih', 'ok noted', 'noted thanks', 'oke ditunggu',
            'siap ditunggu', 'saya tunggu kabarnya', 'ditunggu kabarnya', 'ditunggu infonya', 'oke nanti saya kabari', 'nanti saya kabari',
            'nanti dikabari', 'nanti saya hubungi lagi', 'nanti saya chat lagi', 'kabar kabar ya',
        ],
        size_chart: ['ukuran lengkap', 'detail ukuran', 'ukuran badan', 'lingkar badan', 'ukuran baju', 'ukuran kaos', 'ukuran jersey', 'ukuran kemeja', 'standar ukuran', 'ukuran standar', 'all size', 'allsize'],
        design_reference: ['contoh kaos', 'contoh jaket', 'contoh hoodie', 'contoh kemeja', 'contoh pdh', 'contoh pdl', 'hasil jahitan', 'foto asli', 'real pict', 'real picture', 'foto real', 'katalog jersey', 'katalog kaos'],
        no_reference: ['belum ada sama sekali', 'masih nol', 'serah kakak', 'terserah admin', 'bebas kak', 'ngikut aja', 'ikut kakak', 'dibuatkan saja', 'buatkan saja', 'tolong dibuatkan'],
        quantity: ['satu organisasi', 'satu himpunan', 'satu jurusan', 'satu fakultas', 'satu divisi', 'satu keluarga', 'satu rombongan', 'seluruh karyawan', 'seluruh anggota', 'seluruh siswa'],
    },
    products: {
        'jas-almamater': ['jas alumni', 'jas wisuda', 'jas organisasi kampus', 'almet'],
        kemeja: ['kemeja seragam kantor', 'kemeja dinas', 'kemeja pria', 'kemeja wanita', 'hem seragam'],
        kaos: ['kaos seragam', 'kaos sablon dtf', 'kaos dtf', 'kaos plastisol', 'kaos rubber', 'kaos combed'],
        jersey: ['jersey printing', 'jersey sublim', 'jersey sublimasi', 'jersey full printing'],
    },
    patterns: {
        location: ['alamatnya mana', 'lokasinya mana', 'tokonya mana', 'posisinya dimana', 'ada toko offline', 'toko offline', 'bisa cod di tempat', 'datang ke tempat', 'mampir ke toko', 'mau ke toko', 'mau ke tempat', 'jam berapa bisa ke sana', 'buka jam berapa'],
        shipping: ['kirim ke luar kota', 'kirim antar provinsi', 'bisa kirim ke', 'kirim pakai ekspedisi', 'ongkir ke', 'ongkos kirim ke', 'berapa ongkirnya', 'pengiriman berapa lama', 'kirim berapa hari', 'sampai berapa lama'],
        trust: ['sudah terpercaya', 'pernah kena tipu', 'takut ketipu', 'takut zonk', 'ada jaminan', 'garansinya', 'bergaransi', 'kalau rusak', 'kalau cacat', 'kalau tidak sesuai', 'ada testimoni', 'review pelanggan'],
        moq: ['minimal pemesanannya', 'minimal ordernya', 'minimum ordernya', 'min ordernya', 'satu pcs bisa', 'satu biji bisa', 'pesan sedikit bisa', 'sedikit bisa ga', 'minimal berapa pcs', 'paling sedikit berapa pcs'],
    },
});

// Fourth round, from testing odd messages (migration 008). `remove` takes out
// seeded phrases that proved to catch the wrong thing on installs that have them.
SEED_ADDITIONS.push({
    migration: '008_odd_messages',
    keywords: {
        human: [
            'tolong telpon saya', 'telpon saya', 'telepon saya', 'hubungi saya', 'call saya', 'wa saya', 'chat saya', 'langsung telpon',
            'lama banget', 'lama sekali', 'lambat banget', 'lemot', 'kok lama', 'kok ga dibalas', 'kok gak dibales', 'gak dibales', 'dicuekin',
            'goblok', 'bodoh', 'tolol', 'bego', 'anjir', 'anjing', 'bangsat', 'kampret', 'payah', 'ga becus', 'gak becus', 'cepetan', 'buruan',
            'kecewa banget', 'mau komplain', 'komplain', 'keluhan', 'nggak puas', 'gak puas',
        ],
        about_bot: [
            'kamu bot', 'ini bot', 'bot ya', 'bot kah', 'robot ya', 'ini robot', 'kamu robot', 'dibalas bot', 'dibalas robot', 'balasan otomatis',
            'kamu manusia', 'ini manusia', 'manusia bukan', 'orang beneran', 'orang asli', 'kamu ai', 'pakai ai', 'chatbot ya', 'ini chatbot',
        ],
        price: ['how much', 'berapa duit', 'berapa duwit'],
        // Clear questions only CS can answer: noted for CS, the chat goes on.
        cs_question: [
            'bisa dp', 'dp dulu', 'dp nya', 'dp berapa', 'pakai dp', 'sistem dp', 'down payment', 'uang muka', 'bayar dulu',
            'cara bayar', 'cara pembayaran', 'metode pembayaran', 'pembayarannya', 'bayarnya gimana', 'bayar pakai', 'bisa transfer',
            'transfer ke', 'rekening', 'norek', 'no rek', 'nomor rekening', 'qris', 'bisa cicil', 'dicicil', 'bayar tempo', 'bisa tempo',
            'lama pengerjaan', 'pengerjaannya', 'proses pengerjaan', 'berapa lama jadi', 'berapa hari jadi', 'kapan jadi', 'kapan selesai',
            'kapan bisa diambil', 'estimasi pengerjaan', 'estimasi jadi', 'proses berapa lama', 'produksi berapa lama', 'deadline', 'bisa kejar',
            'urgent', 'kilat', 'express', 'status pesanan', 'pesanan saya', 'orderan saya', 'sudah sampai mana', 'resi saya', 'nomor resi',
            'nota', 'invoice', 'faktur', 'kwitansi', 'revisi', 'direvisi', 'revisi desain', 'ganti desain', 'tukar ukuran', 'barang rusak', 'barangnya rusak',
            'jahitan lepas', 'warna luntur', 'salah ukuran', 'salah kirim',
        ],
    },
    remove: {
        patterns: { location: ['kantore', 'omahe'], moq: ['pcs aja'] },
    },
});


// Every addition is part of the full seed lists too.
for (const add of SEED_ADDITIONS) {
    for (const [intent, phrases] of Object.entries(add.keywords ?? {})) {
        SEED_KEYWORDS[intent] = [...new Set([...(SEED_KEYWORDS[intent] ?? []), ...phrases])];
    }
    for (const [key, phrases] of Object.entries(add.products ?? {})) {
        const product = SEED_PRODUCTS.find((p) => p.key === key);
        if (product) product.keywords = [...new Set([...product.keywords, ...phrases])];
    }
    for (const [builtin, phrases] of Object.entries(add.patterns ?? {})) {
        const pattern = SEED_PATTERNS.find((p) => p.builtin === builtin);
        if (pattern) pattern.keywords = [...new Set([...pattern.keywords, ...phrases])];
    }
    for (const [builtin, phrases] of Object.entries(add.remove?.patterns ?? {})) {
        const pattern = SEED_PATTERNS.find((p) => p.builtin === builtin);
        if (pattern) pattern.keywords = pattern.keywords.filter((k) => !phrases.includes(k));
    }
}

/**
 * Follow-up questions per product, asked one by one after the product is
 * known (catalog products: after the catalog), so CS gets a usable order
 * instead of only "kemeja 2000 pcs". Editable per product in the console.
 * Products with a size chart also get the size question.
 */
export const SIZE_QUESTION = 'Untuk ukurannya apa saja kak, dan masing-masing berapa pcs? Misal S 10, M 20, L 15 😉';

export const SEED_QUESTIONS = {
    jersey: ['Jersey-nya untuk olahraga apa kak? Misal futsal, voli, basket, badminton, esport 😊'],
    kaos: ['Kaosnya mau lengan pendek atau lengan panjang kak? Sablonnya di bagian mana saja? 😊'],
    pdl: ['PDL/PDH-nya mau model apa kak? Misal PDL 2in1, PDH lengan panjang atau lengan pendek 😊'],
    kemeja: ['Kemejanya mau jenis apa kak? Misal PDH, kemeja kerja, kemeja batik, lengan pendek atau lengan panjang 😊'],
    polo: ['Polo shirt-nya mau lengan pendek atau lengan panjang kak? Logonya disablon atau dibordir? 😊'],
    jaket: ['Jaketnya mau model apa kak? Misal bomber, varsity, parasut, coach 😊'],
    hoodie: ['Hoodie-nya mau model apa kak? Pakai resleting (zipper) atau tidak? 😊'],
    topi: ['Topinya mau model apa kak? Misal baseball, trucker, snapback, bucket hat 😊'],
    'jas-almamater': ['Jas almamaternya warna apa kak? Logonya dibordir atau disablon? 😊'],
};

/** Products added after the first release (migration 006). */
export const SEED_NEW_PRODUCTS = [
    {
        key: 'jas-almamater',
        name: 'Jas Almamater',
        catalog: false,
        sizeChart: true,
        keywords: ['jas almamater', 'almamater', 'jas kampus', 'jas angkatan', 'jas organisasi', 'jas himpunan', 'jas bem', 'blazer'],
    },
];

/** The questions a seeded product starts with. */
export const seedQuestions = (product) => [...(SEED_QUESTIONS[product.key] ?? []), ...(product.sizeChart ? [SIZE_QUESTION] : [])];

/**
 * Every word list the bot reads (dictionary, fillers, cities, units, ...),
 * stored in the database by migration 009 (table word_lists) and edited in
 * the console (Latih bot > Kamus). pairs: [word, meaning]; otherwise words.
 * The logic that uses them stays in code; the vocabulary is data.
 */
export const SEED_WORDS = {
    "singkatan": {
        "label": "Singkatan chat",
        "help": "Ditulis ulang sebelum dicocokkan: \"brp\" dibaca \"berapa\". Hanya singkatan yang artinya pasti.",
        "pairs": true,
        "words": [
            [
                "brp",
                "berapa"
            ],
            [
                "brapa",
                "berapa"
            ],
            [
                "berapaan",
                "berapa"
            ],
            [
                "brpa",
                "berapa"
            ],
            [
                "gmn",
                "gimana"
            ],
            [
                "gmna",
                "gimana"
            ],
            [
                "gimn",
                "gimana"
            ],
            [
                "bgmn",
                "bagaimana"
            ],
            [
                "bgmna",
                "bagaimana"
            ],
            [
                "dmn",
                "dimana"
            ],
            [
                "dmna",
                "dimana"
            ],
            [
                "dimn",
                "dimana"
            ],
            [
                "mana2",
                "mana"
            ],
            [
                "bs",
                "bisa"
            ],
            [
                "bsa",
                "bisa"
            ],
            [
                "bisaa",
                "bisa"
            ],
            [
                "gk",
                "gak"
            ],
            [
                "ggk",
                "gak"
            ],
            [
                "g",
                "gak"
            ],
            [
                "ga",
                "gak"
            ],
            [
                "nggk",
                "nggak"
            ],
            [
                "engga",
                "nggak"
            ],
            [
                "ngga",
                "nggak"
            ],
            [
                "kaga",
                "gak"
            ],
            [
                "tdk",
                "tidak"
            ],
            [
                "tak",
                "tidak"
            ],
            [
                "blm",
                "belum"
            ],
            [
                "blom",
                "belum"
            ],
            [
                "belom",
                "belum"
            ],
            [
                "udh",
                "udah"
            ],
            [
                "udah",
                "udah"
            ],
            [
                "dah",
                "udah"
            ],
            [
                "sdh",
                "sudah"
            ],
            [
                "sudh",
                "sudah"
            ],
            [
                "klo",
                "kalau"
            ],
            [
                "kalo",
                "kalau"
            ],
            [
                "kl",
                "kalau"
            ],
            [
                "kalu",
                "kalau"
            ],
            [
                "yg",
                "yang"
            ],
            [
                "dgn",
                "dengan"
            ],
            [
                "utk",
                "untuk"
            ],
            [
                "untk",
                "untuk"
            ],
            [
                "tp",
                "tapi"
            ],
            [
                "jg",
                "juga"
            ],
            [
                "sm",
                "sama"
            ],
            [
                "aja",
                "aja"
            ],
            [
                "aj",
                "aja"
            ],
            [
                "ajh",
                "aja"
            ],
            [
                "pesen",
                "pesan"
            ],
            [
                "psn",
                "pesan"
            ],
            [
                "mesen",
                "pesan"
            ],
            [
                "bkin",
                "bikin"
            ],
            [
                "bikinin",
                "bikin"
            ],
            [
                "bkn",
                "bikin"
            ],
            [
                "mau",
                "mau"
            ],
            [
                "mo",
                "mau"
            ],
            [
                "pgn",
                "pengen"
            ],
            [
                "pngn",
                "pengen"
            ],
            [
                "mnta",
                "minta"
            ],
            [
                "mnt",
                "minta"
            ],
            [
                "tny",
                "tanya"
            ],
            [
                "tnya",
                "tanya"
            ],
            [
                "nnya",
                "nanya"
            ],
            [
                "hrg",
                "harga"
            ],
            [
                "hrga",
                "harga"
            ],
            [
                "harganya",
                "harga"
            ],
            [
                "ongkos",
                "ongkos"
            ],
            [
                "okr",
                "ongkir"
            ],
            [
                "lok",
                "lokasi"
            ],
            [
                "loc",
                "lokasi"
            ],
            [
                "almt",
                "alamat"
            ],
            [
                "alamt",
                "alamat"
            ],
            [
                "pcs",
                "pcs"
            ],
            [
                "psc",
                "pcs"
            ],
            [
                "pc",
                "pcs"
            ],
            [
                "biji",
                "pcs"
            ],
            [
                "sz",
                "size"
            ],
            [
                "siz",
                "size"
            ],
            [
                "ukrn",
                "ukuran"
            ],
            [
                "ukr",
                "ukuran"
            ],
            [
                "mksh",
                "makasih"
            ],
            [
                "mks",
                "makasih"
            ],
            [
                "trims",
                "makasih"
            ],
            [
                "thx",
                "makasih"
            ],
            [
                "tq",
                "makasih"
            ],
            [
                "kk",
                "kak"
            ],
            [
                "kakk",
                "kak"
            ],
            [
                "ka",
                "kak"
            ],
            [
                "kaka",
                "kak"
            ],
            [
                "riyin",
                "dulu"
            ],
            [
                "disik",
                "dulu"
            ],
            [
                "dhisik",
                "dulu"
            ],
            [
                "dlu",
                "dulu"
            ],
            [
                "sya",
                "saya"
            ],
            [
                "saia",
                "saya"
            ],
            [
                "aq",
                "aku"
            ],
            [
                "tw",
                "tau"
            ],
            [
                "pieces",
                "pcs"
            ],
            [
                "piece",
                "pcs"
            ],
            [
                "rb",
                "ribu"
            ],
            [
                "rbu",
                "ribu"
            ]
        ]
    },
    "bahasa_daerah": {
        "label": "Bahasa Jawa / Sunda",
        "help": "Diterjemahkan ke bahasa Indonesia sebelum dicocokkan: \"pinten\" dibaca \"berapa\". Kata kunci cukup ditulis dalam bahasa Indonesia.",
        "pairs": true,
        "words": [
            [
                "pinten",
                "berapa"
            ],
            [
                "piro",
                "berapa"
            ],
            [
                "pira",
                "berapa"
            ],
            [
                "pirang",
                "berapa"
            ],
            [
                "sabaraha",
                "berapa"
            ],
            [
                "pripun",
                "gimana"
            ],
            [
                "piye",
                "gimana"
            ],
            [
                "kepiye",
                "gimana"
            ],
            [
                "kepripun",
                "gimana"
            ],
            [
                "kumaha",
                "gimana"
            ],
            [
                "nopo",
                "apa"
            ],
            [
                "napa",
                "apa"
            ],
            [
                "opo",
                "apa"
            ],
            [
                "naon",
                "apa"
            ],
            [
                "pundi",
                "mana"
            ],
            [
                "endi",
                "mana"
            ],
            [
                "ngendi",
                "mana"
            ],
            [
                "pundhi",
                "mana"
            ],
            [
                "wonten",
                "ada"
            ],
            [
                "onten",
                "ada"
            ],
            [
                "enten",
                "ada"
            ],
            [
                "ono",
                "ada"
            ],
            [
                "aya",
                "ada"
            ],
            [
                "mboten",
                "tidak"
            ],
            [
                "mpun",
                "sudah"
            ],
            [
                "ora",
                "tidak"
            ],
            [
                "teu",
                "tidak"
            ],
            [
                "ndak",
                "tidak"
            ],
            [
                "gag",
                "gak"
            ],
            [
                "dereng",
                "belum"
            ],
            [
                "durung",
                "belum"
            ],
            [
                "acan",
                "belum"
            ],
            [
                "sampun",
                "sudah"
            ],
            [
                "uwis",
                "sudah"
            ],
            [
                "wis",
                "sudah"
            ],
            [
                "wes",
                "sudah"
            ],
            [
                "parantos",
                "sudah"
            ],
            [
                "nggih",
                "iya"
            ],
            [
                "inggih",
                "iya"
            ],
            [
                "injih",
                "iya"
            ],
            [
                "njih",
                "iya"
            ],
            [
                "enggih",
                "iya"
            ],
            [
                "badhe",
                "mau"
            ],
            [
                "bade",
                "mau"
            ],
            [
                "ajeng",
                "mau"
            ],
            [
                "arep",
                "mau"
            ],
            [
                "hoyong",
                "mau"
            ],
            [
                "kepengin",
                "pengen"
            ],
            [
                "pengin",
                "pengen"
            ],
            [
                "damel",
                "bikin"
            ],
            [
                "ndamel",
                "bikin"
            ],
            [
                "gawe",
                "bikin"
            ],
            [
                "nggawe",
                "bikin"
            ],
            [
                "digawe",
                "dibikin"
            ],
            [
                "didamel",
                "dibikin"
            ],
            [
                "tumbas",
                "beli"
            ],
            [
                "tuku",
                "beli"
            ],
            [
                "mundhut",
                "beli"
            ],
            [
                "mendet",
                "ambil"
            ],
            [
                "njupuk",
                "ambil"
            ],
            [
                "dumugi",
                "sampai"
            ],
            [
                "menawi",
                "kalau"
            ],
            [
                "nek",
                "kalau"
            ],
            [
                "ngadamel",
                "bikin"
            ],
            [
                "ngadamelkeun",
                "bikin"
            ],
            [
                "mbayar",
                "bayar"
            ],
            [
                "kintun",
                "kirim"
            ],
            [
                "ngintun",
                "kirim"
            ],
            [
                "dikintun",
                "dikirim"
            ],
            [
                "saged",
                "bisa"
            ],
            [
                "iso",
                "bisa"
            ],
            [
                "isa",
                "bisa"
            ],
            [
                "tiasa",
                "bisa"
            ],
            [
                "takon",
                "tanya"
            ],
            [
                "tangklet",
                "tanya"
            ],
            [
                "tanglet",
                "tanya"
            ],
            [
                "naros",
                "tanya"
            ],
            [
                "kulo",
                "saya"
            ],
            [
                "kula",
                "saya"
            ],
            [
                "abdi",
                "saya"
            ],
            [
                "panjenengan",
                "kamu"
            ],
            [
                "sampeyan",
                "kamu"
            ],
            [
                "njenengan",
                "kamu"
            ],
            [
                "saking",
                "dari"
            ],
            [
                "seko",
                "dari"
            ],
            [
                "soko",
                "dari"
            ],
            [
                "ten",
                "di"
            ],
            [
                "teng",
                "di"
            ],
            [
                "neng",
                "di"
            ],
            [
                "nang",
                "di"
            ],
            [
                "ning",
                "di"
            ],
            [
                "mriki",
                "sini"
            ],
            [
                "kene",
                "sini"
            ],
            [
                "mrika",
                "sana"
            ],
            [
                "kono",
                "sana"
            ],
            [
                "panggenan",
                "tempat"
            ],
            [
                "panggonan",
                "tempat"
            ],
            [
                "panggenane",
                "tempat"
            ],
            [
                "panggonane",
                "tempat"
            ],
            [
                "nggone",
                "tempat"
            ],
            [
                "sekedhik",
                "sedikit"
            ],
            [
                "sekedik",
                "sedikit"
            ],
            [
                "sithik",
                "sedikit"
            ],
            [
                "sitik",
                "sedikit"
            ],
            [
                "setitik",
                "sedikit"
            ],
            [
                "saeutik",
                "sedikit"
            ],
            [
                "kathah",
                "banyak"
            ],
            [
                "akeh",
                "banyak"
            ],
            [
                "seueur",
                "banyak"
            ],
            [
                "sedoyo",
                "semua"
            ],
            [
                "kabeh",
                "semua"
            ],
            [
                "regane",
                "harga"
            ],
            [
                "regine",
                "harga"
            ],
            [
                "reginipun",
                "harga"
            ],
            [
                "hargane",
                "harga"
            ],
            [
                "hargine",
                "harga"
            ],
            [
                "hargana",
                "harga"
            ],
            [
                "regi",
                "harga"
            ],
            [
                "rego",
                "harga"
            ],
            [
                "reregan",
                "harga"
            ],
            [
                "larang",
                "mahal"
            ],
            [
                "ukurane",
                "ukuran"
            ],
            [
                "alamate",
                "alamat"
            ],
            [
                "lokasine",
                "lokasi"
            ],
            [
                "desaine",
                "desain"
            ],
            [
                "kaose",
                "kaos"
            ],
            [
                "ongkire",
                "ongkir"
            ],
            [
                "minimale",
                "minimal"
            ],
            [
                "klambi",
                "baju"
            ],
            [
                "bal",
                "bola"
            ],
            [
                "kathok",
                "celana"
            ],
            [
                "clono",
                "celana"
            ],
            [
                "apik",
                "bagus"
            ],
            [
                "sae",
                "bagus"
            ],
            [
                "tenan",
                "beneran"
            ],
            [
                "ngapusi",
                "nipu"
            ],
            [
                "diapusi",
                "ditipu"
            ],
            [
                "suwe",
                "lama"
            ],
            [
                "dangu",
                "lama"
            ],
            [
                "cepet",
                "cepat"
            ],
            [
                "gedhe",
                "besar"
            ],
            [
                "cilik",
                "kecil"
            ],
            [
                "mangke",
                "nanti"
            ],
            [
                "mengko",
                "nanti"
            ],
            [
                "kangge",
                "untuk"
            ],
            [
                "kanggo",
                "untuk"
            ],
            [
                "kagem",
                "untuk"
            ],
            [
                "dados",
                "jadi"
            ],
            [
                "dadi",
                "jadi"
            ],
            [
                "siji",
                "satu"
            ],
            [
                "setunggal",
                "satu"
            ],
            [
                "loro",
                "dua"
            ],
            [
                "kalih",
                "dua"
            ],
            [
                "telu",
                "tiga"
            ],
            [
                "tigo",
                "tiga"
            ],
            [
                "papat",
                "empat"
            ],
            [
                "sekawan",
                "empat"
            ],
            [
                "limo",
                "lima"
            ],
            [
                "gangsal",
                "lima"
            ],
            [
                "manut",
                "ikut"
            ],
            [
                "mawon",
                "aja"
            ],
            [
                "wae",
                "aja"
            ],
            [
                "bae",
                "aja"
            ],
            [
                "mung",
                "cuma"
            ],
            [
                "namung",
                "cuma"
            ],
            [
                "kanca",
                "teman"
            ],
            [
                "konco",
                "teman"
            ],
            [
                "rencang",
                "teman"
            ],
            [
                "niki",
                "ini"
            ],
            [
                "iki",
                "ini"
            ],
            [
                "niku",
                "itu"
            ],
            [
                "kuwi",
                "itu"
            ],
            [
                "iku",
                "itu"
            ],
            [
                "dalu",
                "malam"
            ],
            [
                "enjing",
                "pagi"
            ],
            [
                "sonten",
                "sore"
            ],
            [
                "sugeng",
                "selamat"
            ],
            [
                "kulonuwun",
                "permisi"
            ],
            [
                "suwun",
                "makasih"
            ],
            [
                "nuwun",
                "makasih"
            ],
            [
                "maturnuwun",
                "makasih"
            ],
            [
                "ngapunten",
                "maaf"
            ],
            [
                "sepurane",
                "maaf"
            ],
            [
                "sepuntene",
                "maaf"
            ]
        ]
    },
    "frasa": {
        "label": "Frasa",
        "help": "Beberapa kata yang artinya satu: \"matur nuwun\" dibaca \"makasih\".",
        "pairs": true,
        "words": [
            [
                "matur nuwun",
                "makasih"
            ],
            [
                "matur suwun",
                "makasih"
            ],
            [
                "hatur nuhun",
                "makasih"
            ],
            [
                "nuwun sewu",
                "permisi"
            ],
            [
                "kulo nuwun",
                "permisi"
            ],
            [
                "kula nuwun",
                "permisi"
            ],
            [
                "kados pundi",
                "gimana"
            ],
            [
                "di mana",
                "dimana"
            ],
            [
                "nyuwun pirsa",
                "tanya"
            ],
            [
                "nyuwun sewu",
                "permisi"
            ]
        ]
    },
    "kota": {
        "label": "Nama kota / daerah",
        "help": "Jawaban perkenalan tanpa \"dari\": \"budi jogja\" dibaca nama Budi, asal Jogja.",
        "words": [
            "purworejo",
            "kutoarjo",
            "kebumen",
            "magelang",
            "wonosobo",
            "temanggung",
            "jogja",
            "yogya",
            "yogyakarta",
            "jogjakarta",
            "sleman",
            "bantul",
            "kulonprogo",
            "wates",
            "gunungkidul",
            "klaten",
            "solo",
            "surakarta",
            "semarang",
            "salatiga",
            "kendal",
            "banjarnegara",
            "purbalingga",
            "purwokerto",
            "banyumas",
            "cilacap",
            "gombong",
            "muntilan",
            "mungkid",
            "boyolali",
            "sragen",
            "karanganyar",
            "sukoharjo",
            "wonogiri",
            "pati",
            "kudus",
            "jepara",
            "demak",
            "rembang",
            "blora",
            "grobogan",
            "pekalongan",
            "batang",
            "pemalang",
            "tegal",
            "brebes",
            "jakarta",
            "bandung",
            "surabaya",
            "malang",
            "bogor",
            "depok",
            "bekasi",
            "tangerang",
            "cirebon",
            "madiun",
            "kediri",
            "ngawi",
            "ponorogo",
            "pacitan",
            "medan",
            "makassar",
            "palembang",
            "lampung",
            "bali",
            "denpasar",
            "balikpapan",
            "samarinda",
            "pontianak",
            "banjarmasin",
            "manado",
            "padang",
            "pekanbaru",
            "batam",
            "jambi",
            "bengkulu",
            "aceh",
            "ambon",
            "jayapura",
            "kupang",
            "mataram"
        ]
    },
    "bukan_nama": {
        "label": "Bukan nama orang",
        "help": "Kata yang tidak pernah dianggap nama pelanggan (\"saya kirim filenya\" bukan nama \"Kirim\").",
        "words": [
            "mau",
            "mo",
            "ingin",
            "pengen",
            "pgn",
            "pingin",
            "tanya",
            "nanya",
            "kak",
            "ka",
            "kakak",
            "min",
            "admin",
            "mas",
            "mbak",
            "mba",
            "bu",
            "pak",
            "dari",
            "dr",
            "asal",
            "di",
            "ada",
            "lagi",
            "bisa",
            "boleh",
            "sudah",
            "udah",
            "belum",
            "ya",
            "yaa",
            "iya",
            "nih",
            "ini",
            "itu",
            "saya",
            "aku",
            "sy",
            "ak",
            "gw",
            "gue",
            "butuh",
            "perlu",
            "cari",
            "nyari",
            "pesan",
            "pesen",
            "order",
            "bikin",
            "buat",
            "minta",
            "halo",
            "hai",
            "hallo",
            "permisi",
            "selamat",
            "malam",
            "pagi",
            "siang",
            "sore",
            "tadi",
            "yang",
            "dan",
            "atau",
            "juga",
            "mohon",
            "tolong",
            "info",
            "informasi",
            "kok",
            "apa",
            "gimana",
            "bagaimana",
            "berapa",
            "terima",
            "kasih",
            "makasih",
            "oke",
            "ok",
            "siap",
            "baik",
            "sama",
            "dengan",
            "dgn",
            "tidak",
            "gak",
            "ga",
            "nggak",
            "enggak",
            "assalamualaikum",
            "waalaikumsalam",
            "salam",
            "kenal",
            "kulo",
            "kula",
            "badhe",
            "bade",
            "ajeng",
            "arep",
            "nggih",
            "njih",
            "inggih",
            "saking",
            "seko",
            "soko",
            "wonten",
            "nopo",
            "pinten",
            "sampun",
            "dereng",
            "matur",
            "nuwun",
            "suwun",
            "sugeng",
            "dalu",
            "enjing",
            "sonten",
            "punten",
            "hoyong",
            "damel",
            "takon",
            "nyuwun",
            "pripun",
            "piye",
            "mboten",
            "ora",
            "niki",
            "iki",
            "mriki",
            "mangke",
            "riyin",
            "ngapunten",
            "monggo",
            "mangga",
            "sami",
            "ten",
            "teng",
            "neng",
            "sip",
            "mantap",
            "kirim",
            "kirimkan",
            "kirimin",
            "file",
            "filenya",
            "nanti",
            "kabari",
            "kabarin",
            "hubungi",
            "transfer",
            "bayar",
            "cek",
            "lihat",
            "liat",
            "tunggu",
            "coba",
            "ambil",
            "pakai",
            "pake",
            "masih",
            "sedang",
            "cuma",
            "hanya",
            "desain",
            "design",
            "desainnya",
            "gambar",
            "logo",
            "ukuran",
            "warna",
            "harga",
            "kami",
            "kita",
            "sya",
            "saia",
            "aq",
            "telpon",
            "telepon",
            "aja"
        ]
    },
    "bukan_typo": {
        "label": "Kata umum (bukan typo)",
        "help": "Kata sehari-hari yang tidak boleh dikira typo nama produk atau kata kunci (\"baik\" bukan \"batik\").",
        "words": [
            "baik",
            "kasih",
            "terima",
            "makasih",
            "siap",
            "mana",
            "sama",
            "saja",
            "kalau",
            "harga",
            "tanya",
            "nanya",
            "belum",
            "sudah",
            "bagus",
            "besar",
            "kecil",
            "minta",
            "semua",
            "sedikit",
            "banyak",
            "untuk",
            "dengan",
            "ingin",
            "pesan",
            "kirim",
            "bikin",
            "warna",
            "logo",
            "kamu",
            "kapan",
            "tapi",
            "bisa",
            "boleh",
            "lihat",
            "liat",
            "model",
            "bahan",
            "jumlah",
            "tempat",
            "bayar",
            "transfer",
            "nanti",
            "besok",
            "hari",
            "pakai",
            "pake",
            "kayak",
            "kaya",
            "masih",
            "cari",
            "dulu",
            "lagi",
            "tolong",
            "mohon",
            "info",
            "tahu",
            "paham",
            "ditunggu",
            "tunggu",
            "beragam",
            "macam",
            "borong",
            "borongan",
            "grosir",
            "grosiran",
            "partai",
            "gimana",
            "dimana",
            "bagaimana",
            "kenapa",
            "mengapa",
            "berapa",
            "siapa",
            "teman",
            "tidak",
            "nggak",
            "bukan",
            "karena",
            "sekarang",
            "semoga",
            "nomor",
            "dikirim",
            "sablon",
            "bordir",
            "gambar",
            "desain",
            "design"
        ]
    },
    "pengisi_oke": {
        "label": "Kata pengisi \"ok/makasih\"",
        "help": "Kata yang boleh ikut dalam pesan \"ok kak makasih ya\" tanpa mengubah artinya.",
        "words": [
            "kak",
            "min",
            "mas",
            "mbak",
            "mba",
            "bu",
            "pak",
            "gan",
            "sis",
            "ya",
            "nih",
            "deh",
            "dong",
            "kok",
            "banyak",
            "sekali",
            "ok",
            "yang",
            "kalau",
            "begitu",
            "gitu",
            "sudah",
            "udah",
            "atas",
            "info",
            "infonya",
            "informasi",
            "informasinya",
            "penjelasannya",
            "bantuannya",
            "responnya",
            "balasannya",
            "jawabannya",
            "to",
            "lho",
            "loh",
            "yo",
            "sanget",
            "nggeh",
            "sangat",
            "membantu",
            "terbantu",
            "bermanfaat",
            "jelas",
            "lengkap",
            "kakak",
            "semuanya",
            "kembali"
        ]
    },
    "pengisi_sapaan": {
        "label": "Kata pengisi sapaan",
        "help": "Kata yang boleh ikut dalam sapaan \"selamat malam kak\".",
        "words": [
            "kak",
            "min",
            "mas",
            "mbak",
            "mba",
            "admin",
            "gan",
            "sis",
            "bu",
            "pak",
            "selamat",
            "ya",
            "nih",
            "pagi",
            "siang",
            "sore",
            "malam",
            "wr",
            "wb",
            "semua",
            "dulu"
        ]
    },
    "pengisi_saran": {
        "label": "Kata dibuang dari saran",
        "help": "Dibuang saat Latih bot menyarankan inti kata kunci (\"mas\", \"kak\", \"ya\").",
        "words": [
            "kak",
            "ka",
            "kakak",
            "min",
            "admin",
            "mas",
            "mbak",
            "mba",
            "bu",
            "pak",
            "gan",
            "sis",
            "om",
            "bang",
            "dek",
            "ya",
            "yaa",
            "yah",
            "dong",
            "deh",
            "sih",
            "nih",
            "tuh",
            "kok",
            "lho",
            "loh",
            "to",
            "kah",
            "gitu",
            "gini",
            "aja",
            "halo",
            "hai",
            "permisi",
            "saya",
            "aku",
            "gue",
            "gw",
            "ini",
            "itu",
            "yang",
            "nya",
            "nggih",
            "iya",
            "tolong",
            "mohon"
        ]
    },
    "kata_pesan": {
        "label": "Kata ingin memesan",
        "help": "Tanda pelanggan ingin memesan, sehingga produk yang disebut ikut diproses (\"mau bikin jersey, minimal berapa?\").",
        "words": [
            "mau",
            "ingin",
            "pengen",
            "pgn",
            "pingin",
            "bikin",
            "buat",
            "pesan",
            "pesen",
            "order",
            "produksi",
            "harga",
            "cetak",
            "butuh",
            "nyari",
            "cari"
        ]
    },
    "kata_buat": {
        "label": "Kata minta dibuatkan",
        "help": "Tanda pelanggan minta dibuatkan atau membeli sesuatu; kalau produknya tidak dikenal, dijawab \"dicek CS\".",
        "words": [
            "bikin",
            "buat",
            "dibuat",
            "dibikin",
            "pesan",
            "order",
            "produksi",
            "cetak",
            "beli",
            "jual",
            "jahit",
            "sablon",
            "melayani",
            "menerima pembuatan",
            "terima pesanan"
        ]
    },
    "satuan": {
        "label": "Satuan jumlah",
        "help": "Angka dengan satuan ini dibaca jumlah pesanan (\"50 pcs\", \"2 lusin\").",
        "words": [
            "pcs",
            "pc",
            "psc",
            "biji",
            "buah",
            "bh",
            "potong",
            "ptg",
            "lembar",
            "lbr",
            "set",
            "pasang",
            "orang",
            "org",
            "stel",
            "setel",
            "lusin",
            "kodi",
            "an",
            "anan"
        ]
    },
    "awal_nama": {
        "label": "Awal perkenalan",
        "help": "Kata sebelum nama: \"saya Budi\", \"kulo Slamet\", \"perkenalkan saya Dimas\".",
        "words": [
            "ini dengan",
            "dengan",
            "dgn",
            "kalih",
            "kaliyan",
            "perkenalkan nama saya",
            "perkenalkan saya",
            "perkenalkan aku",
            "perkenalkan kami",
            "kenalin saya",
            "kenalkan saya",
            "saya",
            "sya",
            "saia",
            "aku",
            "aq",
            "sy",
            "ak",
            "gw",
            "gue",
            "ini",
            "namaku",
            "nama saya",
            "nama aku",
            "nama sy",
            "nama",
            "perkenalkan",
            "kenalin",
            "nami kulo",
            "nami kula",
            "nami abdi",
            "kulo",
            "kula",
            "abdi",
            "asmanipun",
            "jenengku",
            "jenenge aku",
            "aranku"
        ]
    },
    "awal_asal": {
        "label": "Awal asal daerah",
        "help": "Kata sebelum asal: \"dari Jogja\", \"saking Kutoarjo\".",
        "words": [
            "asal dari",
            "tinggal di",
            "dari",
            "dr",
            "asal",
            "domisili",
            "di",
            "saking",
            "seko",
            "soko",
            "teko",
            "ti",
            "ten",
            "teng",
            "neng",
            "nang"
        ]
    },
    "penghenti_nama": {
        "label": "Kata setelah nama",
        "help": "Nama berhenti sebelum kata ini: \"saya Budi mau pesan\" -> Budi.",
        "words": [
            "mau",
            "mo",
            "ingin",
            "pengen",
            "pgn",
            "kak",
            "min",
            "ya",
            "yaa",
            "nih",
            "mohon",
            "izin",
            "ijin",
            "tanya",
            "nanya",
            "butuh",
            "perlu",
            "pesan",
            "pesen",
            "order",
            "bikin",
            "buat",
            "minta",
            "kalau",
            "kalo",
            "untuk",
            "utk",
            "ada",
            "badhe",
            "bade",
            "ajeng",
            "arep",
            "hoyong",
            "nyuwun",
            "takon",
            "damel",
            "wonten",
            "mas",
            "mbak",
            "mba",
            "pak",
            "bu",
            "nggih",
            "njih"
        ]
    },
    "kata_tidak": {
        "label": "Kata \"belum/tidak\"",
        "help": "Dipakai mengenali \"belum ada desain\".",
        "words": [
            "belum",
            "tidak",
            "gak",
            "nggak",
            "enggak"
        ]
    },
    "kata_sudah": {
        "label": "Kata \"sudah\"",
        "help": "Dipakai mengenali \"desain sudah ada\".",
        "words": [
            "sudah",
            "udah"
        ]
    },
    "kata_punya": {
        "label": "Kata \"ada/punya\"",
        "help": "Kata di antara \"belum/sudah\" dan \"desain\": \"belum PUNYA desain\".",
        "words": [
            "ada",
            "punya",
            "memiliki",
            "kepikiran",
            "dapat",
            "jadi",
            "siap"
        ]
    },
    "kata_desain": {
        "label": "Kata desain",
        "help": "Yang dimaksud dengan desain: \"belum ada LOGO\", \"kirim FILEnya\".",
        "words": [
            "desain",
            "design",
            "referensi",
            "konsep",
            "gambaran",
            "logo",
            "file",
            "filenya",
            "gambar",
            "desainnya",
            "designnya"
        ]
    },
    "kata_kirim": {
        "label": "Kata kirim",
        "help": "\"Nanti saya KIRIM filenya\" = desain sudah ada.",
        "words": [
            "kirim",
            "kirimkan",
            "kirimin"
        ]
    },
    "jawaban_belum_pasti": {
        "label": "Jawaban jumlah belum pasti",
        "help": "Saat ditanya jumlah, jawaban berisi kata ini (\"belum tahu\", \"nanti dikabari\") menutup alur seperti biasa.",
        "words": [
            "belum",
            "blm",
            "tau",
            "tahu",
            "bingung",
            "nanti",
            "terserah",
            "kurang",
            "sekitar",
            "kira"
        ]
    },
    "minta_size_chart": {
        "label": "Minta size chart",
        "help": "Saat ditanya ukuran, pesan berisi ini dianggap minta size chart, bukan jawaban.",
        "words": [
            "chart",
            "cart",
            "tabel",
            "?",
            "minta size",
            "minta ukuran",
            "minta daftar",
            "kirim size",
            "kirim ukuran",
            "kirimin size",
            "kirimin ukuran",
            "kirimkan size",
            "lihat size",
            "lihat ukuran",
            "liat size",
            "liat ukuran",
            "ada size",
            "ada ukuran"
        ]
    },
    "varian_ukuran": {
        "label": "Varian size chart",
        "help": "Kata yang memilih size chart selain reguler.",
        "pairs": true,
        "words": [
            [
                "oversize",
                "oversize"
            ],
            [
                "over size",
                "oversize"
            ],
            [
                "oversized",
                "oversize"
            ],
            [
                "boxy",
                "boxy"
            ]
        ]
    },
    "nama_lampiran": {
        "label": "Nama kiriman",
        "help": "Dipakai di balasan \"{lampiran} sudah diterima\".",
        "pairs": true,
        "words": [
            [
                "gambar",
                "gambarnya"
            ],
            [
                "video",
                "videonya"
            ],
            [
                "file",
                "filenya"
            ],
            [
                "lokasi",
                "lokasinya"
            ],
            [
                "kontak",
                "kontaknya"
            ]
        ]
    }
};

// The answers to "Apa mau saya oper ke CS?" (migration 012), as Kamus lists:
// in SEED_WORDS for a fresh install, in SEED_ADDITIONS for an existing one.
SEED_WORDS.jawaban_ya = {
    label: 'Jawaban "iya, oper ke CS"',
    help: 'Setelah bot bilang belum tahu dan menawarkan CS, jawaban berisi kata ini menyerahkan pelanggan ke CS.',
    words: ['iya', 'ya', 'iyaa', 'boleh', 'mau', 'oke', 'ok', 'okey', 'siap', 'gas', 'langsung', 'silakan', 'silahkan', 'nggih', 'monggo', 'sip', 'tolong'],
};
SEED_WORDS.jawaban_tidak = {
    label: 'Jawaban "tidak usah"',
    help: 'Setelah bot menawarkan CS, jawaban berisi kata ini membatalkan tawaran; percakapan lanjut seperti biasa.',
    words: ['tidak', 'gak', 'nggak', 'enggak', 'ga usah', 'gak usah', 'nggak usah', 'jangan', 'nanti saja', 'nanti aja', 'tidak usah', 'mboten', 'ora'],
};
SEED_WORDS.kata_tanya = {
    label: 'Kata tanya',
    help: 'Pesan yang berisi kata ini (atau tanda tanya) dianggap pertanyaan. Kalau AI aktif, pertanyaan di tengah alur dijawab dari Pengetahuan toko dan alurnya menunggu, bukan dianggap jawaban alur.',
    words: ['apa', 'apakah', 'gimana', 'bagaimana', 'kenapa', 'mengapa', 'kapan', 'dimana', 'mana', 'siapa', 'berapa', 'kah'],
};
SEED_WORDS.larangan_ai = {
    label: 'Kata terlarang untuk AI',
    help: 'Kalimat buatan AI (pembuka, jawaban) yang berisi kata ini tidak dikirim; bot memakai naskah biasa. Angka dan link selalu dilarang.',
    words: ['rp', 'rupiah', 'ribu', 'juta', 'harga', 'harganya', 'biaya', 'ongkir', 'diskon', 'potongan', 'promo', 'gratis', 'murah', 'mahal', 'pasti', 'dijamin', 'jamin', 'garansi', 'janji', 'besok', 'lusa', 'minggu depan', 'hari ini', 'transfer ke', 'rekening'],
};
SEED_WORDS.jawaban_menyusul = {
    label: 'Jawaban "nanti menyusul"',
    help: 'Saat bot menunggu jawaban pertanyaan lanjutan (mis. list ukuran), pesan tanpa angka yang berisi kata ini berarti datanya menyusul: bot membalas "Ditunggu list ukuran" dan tetap menunggu, order belum diteruskan ke CS.',
    words: ['nanti saya', 'nanti aku', 'nanti tak', 'nanti dikirim', 'nanti ya', 'menyusul', 'nyusul', 'kabari', 'dikabari', 'kabarin', 'dikabarin', 'dikumpulkan', 'dikumpulin', 'kumpulin', 'kumpulkan', 'didata', 'data dulu', 'rekap dulu', 'direkap', 'belum lengkap', 'belum fix', 'masih nunggu', 'masih menunggu', 'tanya dulu', 'tanyakan dulu', 'diskusi dulu', 'rapat dulu', 'mengko', 'engko'],
};
SEED_ADDITIONS.push({
    migration: '012_offer_cs',
    words: { jawaban_ya: SEED_WORDS.jawaban_ya.words, jawaban_tidak: SEED_WORDS.jawaban_tidak.words, kata_tanya: SEED_WORDS.kata_tanya.words, larangan_ai: SEED_WORDS.larangan_ai.words, jawaban_menyusul: SEED_WORDS.jawaban_menyusul.words },
});
