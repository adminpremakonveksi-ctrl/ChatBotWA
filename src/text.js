import { SEED_WORDS } from './seeds.js';


let words = new Map();
let phrases = [];

const pairsOf = (list) => (SEED_WORDS[list]?.words ?? []).map(([word, value]) => ({ word, value }));

export function setDictionary({ shorthand = [], regional = [], phrase = [] } = {}) {
    words = new Map();
    for (const { word, value } of [...regional, ...shorthand]) {
        if (word && value) words.set(String(word).toLowerCase(), String(value).toLowerCase());
    }

    phrases = phrase
        .filter((p) => p.word && p.value)
        .map((p) => [` ${String(p.word).toLowerCase().trim()} `, ` ${String(p.value).toLowerCase().trim()} `]);
}

setDictionary({ shorthand: pairsOf('singkatan'), regional: pairsOf('bahasa_daerah'), phrase: pairsOf('frasa') });

export const expandWord = (word) => words.get(word) ?? word;

export function textRulesVersion() {
    const source = JSON.stringify([[...words.entries()].sort(), phrases, 'reduplication-1', 'doubles-2']);
    let hash = 5381;
    for (let i = 0; i < source.length; i++) hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;

    return hash.toString(36);
}

export function squashWord(word) {
    const w = String(word).toLowerCase().replace(/(\p{L})\1{2,}/gu, '$1');

    if (/^(?:wk){2,}w?$|^(?:kw){2,}k?$/.test(w)) return 'wkwk';
    if (/^(?:h[aeiou]){2,}h?$/.test(w)) return `h${w[1]}h${w[1]}`;
    if (w.length >= 3) return w.replace(/(\p{L})\1$/u, '$1');

    return w;
}

export function normalise(text) {
    const joined = String(text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&\- ]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => (words.has(word) ? word : squashWord(word)))
        .flatMap((word) => {
            if (/^\p{L}{2,}2$/u.test(word) && !words.has(word)) return [word.slice(0, -1), word.slice(0, -1)];

            const [a, b] = word.split('-');

            return b && a === b ? [a, b] : [word];
        })
        .join(' ');

    const replacePhrases = (value) => {
        let out = ` ${value} `;
        for (const [from, to] of phrases) {
            while (out.includes(from)) out = out.replace(from, to);
        }

        return out;
    };

    const mapped = replacePhrases(joined).trim().split(' ').filter(Boolean).map(expandWord);

    return replacePhrases(mapped.join(' '));
}

export const cleanPhrase = (phrase) => normalise(phrase).trim();

export const slugify = (text) =>
    String(text ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
