const STOP = new Set(`yang dan untuk dengan bisa apa aja saja kak mau ini itu ada tidak gak nggak ngga dari ke di buat bikin kalau kalo atau juga sudah udah belum masih lagi dong deh nih sih ya iya oke ok terima kasih makasih tolong mohon minta boleh gimana bagaimana berapa kapan dimana mana siapa kenapa karena jadi nya lah kah pun sama saya aku kita kami anda kamu mas mbak min admin halo hai permisi selamat pagi siang sore malam`.split(/\s+/));

export const tokensOf = (text) =>
    [...new Set(
        String(text ?? '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .split(/[^a-z0-9]+/)
            .filter((word) => word.length >= 3 && !STOP.has(word)),
    )];

export function scoreOf(text, queryTokens) {
    if (!queryTokens.length) return 0;

    const own = tokensOf(text);
    const set = new Set(own);
    let score = 0;

    for (const q of queryTokens) {
        if (set.has(q)) score += 2;
        else if (q.length >= 4 && own.some((e) => e.length >= 4 && (e.includes(q) || q.includes(e)))) score += 1;
    }

    return score;
}

export function relevanceQuery({ text = '', history = [], productName = '' } = {}) {
    const earlier = history.filter((h) => h.who === 'pelanggan').slice(-2).map((h) => h.text);

    return tokensOf([text, ...earlier, productName].join(' '));
}

export function pickRelevant(items, textOf, queryTokens, limit) {
    return new Set(
        items
            .map((item) => ({ item, score: scoreOf(textOf(item), queryTokens) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((entry) => entry.item),
    );
}
