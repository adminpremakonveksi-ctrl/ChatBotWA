import { getProduct, hasCatalog, productKeywords, productName, productQuestions } from './products.js';
import { textVersions } from './patterns.js';
import { config } from '../config.js';
import { normalise } from '../text.js';
import { wordMap, wordSet } from './words.js';
import { fillText, replies } from './replies.js';

/**
 * The reply flow from SPEK-CHATBOT.md as a pure function.
 *
 *   decide(conversation, classified, media) -> { actions, patch }
 *
 * `actions` is what to send, in order:
 *   { type: 'text', text }
 *   { type: 'media', kind: 'katalog' | 'size-chart' | 'katalog-review', product, variant }
 *   { type: 'handover', reason }      bot goes silent on this number
 * `patch` is the conversation state to save afterwards.
 *
 * Steps:
 *   new                          nothing said yet
 *   awaiting_intro               asked name & origin [2]
 *   awaiting_product             asked which product [1]/[3]
 *   awaiting_detail              asked a product's follow-up question ("kemeja apa?")
 *   awaiting_design              asked for a design reference [4]
 *   awaiting_quantity            asked how many [5]
 *   awaiting_size_chart_product  asked which product the size chart is for
 *   handed_over                  CS takes it from here; bot stays silent
 */

// Answered at any point, without moving the conversation. 'custom' = answer
// patterns, which include the seeded Lokasi, Pengiriman, Ragu and Minimal order.
const FAQ = new Set(['size_chart', 'design_reference', 'custom']);

// A message containing one of a list's words (Kamus), as typed (lowercase).
const saysAny = (text, list) => {
    const lower = ` ${String(text ?? '').toLowerCase()} `;

    return [...wordSet(list)].some((w) => lower.includes(w));
};

// Whole words only: "ya" is in "iya kak", not in "saya" or "kaya".
const saysWord = (text, list) => {
    const words = ` ${String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

    return [...wordSet(list)].some((w) => words.includes(` ${w} `));
};

export function decide(conversation, classified, media, { random = Math.random } = {}) {
    const conv = { step: 'new', name: null, origin: null, product: null, return_step: null, ...conversation };
    const r = classified;

    const actions = [];
    const patch = {};
    const state = () => ({ ...conv, ...patch });

    const say = (text) => text && actions.push({ type: 'text', text });
    // The same file/catalog once per reply, however many questions asked for it.
    const send = (kind, product = null, variant = null) => {
        if (actions.some((a) => a.type === 'media' && a.kind === kind && a.product === product && a.variant === variant)) return;
        actions.push({ type: 'media', kind, product, variant });
    };

    const handover = (reason) => {
        // Every handover by the bot ends with the same line, so the customer knows CS takes over.
        say(replies.handoverNotice());
        actions.push({ type: 'handover', reason });
        patch.step = 'handed_over';
    };

    /** Aturan wajib 1: cannot answer -> straight to CS. */
    const giveUp = (reason) => {
        say(replies.waitForCs());
        handover(reason);
    };

    /**
     * A message the bot did not understand. It asks again in other words
     * instead of closing the chat; only after several misses in a row
     * (Pengaturan, default 3) does CS take over.
     */
    let missed = false;
    const notUnderstood = (reason) => {
        // With the AI on: an answer from the shop's own facts (checked), or
        // "belum tahu, mau saya oper ke CS?". Neither counts as a miss.
        if (r.intent === 'other' && r.aiAnswer?.type === 'answer') return say(r.aiAnswer.text);
        if (r.intent === 'other' && r.aiAnswer?.type === 'unknown') {
            say(replies.aiUnknown());
            patch.offered_cs = 1;

            return;
        }

        missed = true;
        const misses = (Number(conv.misses) || 0) + 1;

        if (misses >= (config.bot.maxMisses ?? 3)) {
            patch.misses = 0;

            return giveUp(`${misses}× tidak dipahami: ${reason}`);
        }

        patch.misses = misses;
        say(replies.clarify(misses - 1));
    };

    /** [7] + [8], then CS takes over. */
    const closeOrder = () => {
        say(replies.waitForCs());
        say(replies.socials());
        handover('alur selesai');
    };

    /**
     * After [4] (or the catalog), up to the end of the order, one at a time:
     * the product's follow-up questions ("kemeja apa?"), then [5] how many,
     * then the size question last (the last question of a product with a size
     * chart), then [7] + [8]. `i` is the next question to ask.
     */
    const next = (i, quantityAsked = false) => {
        const product = state().product;
        const questions = productQuestions(product);
        const sizeAt = getProduct(product)?.sizeChart && questions.length ? questions.length - 1 : questions.length;

        if (i < sizeAt) return askQuestion(i);
        // [5], once: "belum tahu" is an answer too, and the flow goes on.
        if (!state().quantity && !quantityAsked && i <= sizeAt) {
            say(hasCatalog(product) ? replies.askQuantityCatalog() : replies.askQuantity());
            patch.step = 'awaiting_quantity';
            patch.detail_index = i;

            return;
        }
        if (i < questions.length) return askQuestion(i);

        closeOrder();
    };

    /** On to the end of the order: from the first question, or from where [5] interrupted. */
    const finish = () => (state().step === 'awaiting_quantity' ? next(state().detail_index ?? 0, true) : next(0));

    const remember = (key, value) => {
        if (value) patch[key] = value;
    };

    /** Something for CS to answer or look at (a question, a picture), kept on the conversation. */
    const note = (text) => {
        let notes = [];
        try {
            notes = JSON.parse(state().notes ?? '[]');
        } catch {
            /* start over */
        }
        if (!notes.includes(text)) patch.notes = JSON.stringify([...notes, text].slice(-10));
    };

    // What they sent besides words, as CS should read it (a maps link for a location).
    const attachmentNotes = () => (r.attachments ?? []).map((a) => a.note).filter(Boolean);

    /** A picture, file, location or contact without words: received, noted for CS, the chat goes on. */
    const received = () => {
        const notes = attachmentNotes();
        for (const n of notes.length ? notes : ['[gambar dari pelanggan]']) note(n);

        const kind = r.attachments?.[0]?.kind ?? 'gambar';
        // How the reply names it (Kamus: "Nama kiriman"): "lokasinya sudah Mawar terima".
        say(replies.imageReceived(wordMap('nama_lampiran').get(kind) ?? 'kirimannya'));
    };

    const details = () => {
        try {
            return JSON.parse(state().details ?? '[]');
        } catch {
            return [];
        }
    };

    /** The product's i-th follow-up question; false when there is none left. */
    const askQuestion = (i) => {
        const question = productQuestions(state().product)[i];
        if (!question) return false;

        say(fillText(question, { nama: state().name ?? '', produk: productName(state().product) }));
        patch.detail_index = i;
        patch.step = 'awaiting_detail';

        return true;
    };

    const productFlow = (product) => {
        // Another product than before: the amount said for the old one does not carry over.
        if (state().product && state().product !== product) patch.quantity = r.quantity ?? null;
        else if (r.quantity) patch.quantity = r.quantity;

        patch.product = product;
        patch.details = null;
        patch.detail_index = null;

        if (hasCatalog(product)) {
            if (media.has('katalog', product)) send('katalog', product);
            // [9] "sampaikan kalau jersey lagi ada promo": the pamphlet the team
            // uploaded and/or the promo text; neither means no promo right now.
            if (product === 'jersey') {
                if (media.has('promo', 'jersey')) send('promo', 'jersey');
                say(replies.jerseyPromo());
            }
        }

        // The spec flow: catalog products skip [4], the others are asked it. The
        // follow-up questions, [5] and the size question come after (next).
        if (hasCatalog(product)) return next(0);

        say(replies.askDesign(productName(product)));
        patch.step = 'awaiting_design';
    };

    const sizeChart = (product, variant) => {
        const found = [variant, 'reguler'].find((v) => media.has('size-chart', product, v));

        if (!found) {
            // No file uploaded yet: CS sends it later (the morning recap lists them); the chat goes on.
            say(replies.sizeChartMissing(productName(product)));

            return;
        }

        send('size-chart', product, found);
        say(replies.sizeChartNote());
    };

    /**
     * "Harganya berapa?" with no product in the message. Prices come only from
     * the catalog or from CS: never computed here.
     */
    const price = () => {
        const product = state().product;

        if (!product) {
            say(replies.priceWhich());
            patch.step = 'awaiting_product';

            return;
        }

        // Catalog products: the catalog carries the price list. The flow stays
        // where it was (a follow-up question still waits for its answer).
        if (hasCatalog(product) && media.has('katalog', product)) {
            send('katalog', product);
            if (state().step === 'awaiting_product') finish();

            return;
        }

        // Design products: [4] explains price depends on quantity and design;
        // later in the flow, a short reminder and the flow carries on: CS
        // gives the actual price once the order details are in.
        if (state().step === 'awaiting_product') return productFlow(product);

        say(replies.priceDesign(productName(product)));
    };

    const handedOver = () => patch.step === 'handed_over';

    const answerFaq = (intent) => {
        const product = r.product ?? state().product;

        switch (intent) {
            case 'size_chart':
                if (!product) {
                    say(replies.sizeChartWhich());
                    patch.return_step = state().step;
                    patch.step = 'awaiting_size_chart_product';
                } else {
                    sizeChart(product, r.sizeVariant);
                }
                break;

            case 'design_reference':
                if (product && media.has('katalog', product)) send('katalog', product);
                else if (media.has('katalog')) send('katalog');
                say(replies.portfolio());
                if (product === 'jersey') say(replies.jerseyTemplates());
                break;
        }
    };

    // Every FAQ the message asked: the main one first, then the extras.
    const faqs = [r.intent, ...(r.extras ?? [])].filter(
        (intent, i, list) =>
            FAQ.has(intent) &&
            list.indexOf(intent) === i &&
            // "belum ada desainnya" is one need, not two: its no_reference
            // answer already carries the portfolio and the examples.
            !(intent === 'design_reference' && r.intent === 'no_reference'),
    );
    const wantsProduct = Boolean(r.product) && (r.intent === 'product' || (r.extras ?? []).includes('product'));

    /** Answers each FAQ; false when one of them had to hand over. */
    /**
     * One answer pattern (the team's, or a seeded one such as Lokasi), bubble
     * by bubble in the order they set.
     */
    const answerPattern = (p) => {
        for (const bubble of p.bubbles) {
            if (bubble.type === 'text') {
                // Several versions: one at random, so regulars do not get the same lines.
                const versions = textVersions(bubble.text);
                say(fillText(versions[Math.floor(random() * versions.length)] ?? '', { nama: state().name ?? '' }));
            }
            if (bubble.type === 'link') say(bubble.url);
            if (bubble.type === 'photos' && media.has('pola', String(p.id))) send('pola', String(p.id));
            if (bubble.type === 'catalog') for (const link of media.catalogItemLinks?.(bubble.items) ?? []) say(link);
            if (bubble.type === 'slot') {
                // "katalog-review", "katalog:jersey", "size-chart:kaos:reguler": files from the Media page.
                const [kind, product = null, variant = null] = bubble.slot.split(':');
                if (media.has(kind, product, variant)) send(kind, product, variant);
            }
        }

        if (p.after === 'handover') handover(`pola: ${p.name}`);
    };

    /** Every pattern, then every built-in answer the message asked; false when one handed over. */
    const answerFaqs = () => {
        if ((faqs.length || r.patterns?.length) && r.product && !state().product) remember('product', r.product);

        for (const p of r.patterns ?? []) {
            answerPattern(p);
            if (handedOver()) return false;
        }

        for (const intent of faqs) {
            if (intent === 'custom') continue; // answered above
            answerFaq(intent);
            if (handedOver()) return false;
        }

        return true;
    };

    /**
     * Whether a message at a follow-up question is its answer. A question of
     * their own (an answer pattern, price, design examples) is answered
     * instead; "ok" waits. "M 10, L 20" mentions sizes but is an answer.
     */
    const isDetailAnswer = () => {
        if (['custom', 'price', 'ask_first', 'ack', 'greeting', 'introduction', 'human', 'voice', 'cs_question', 'about_bot', 'product_unknown'].includes(r.intent)) return false;
        // "Ada contoh desainnya?" is their question; "belum ada desain" is an answer.
        if (r.intent === 'design_reference' && !r.design) return false;
        // "Ukuran campur, nanti dikabari" answers the size question; "size chartnya ada?" asks for the chart.
        if (r.intent === 'size_chart' && saysAny(r.text, 'minta_size_chart')) return false;

        // Another product named: an answer when the question itself offers it
        // ("Kemejanya jenis apa? Misal PDH ..." -> "PDH lengan panjang"), a
        // change of mind otherwise ("eh kalau jaket bisa?").
        if (r.product && r.product !== state().product) {
            const question = normalise(productQuestions(state().product)[state().detail_index ?? 0] ?? '');

            return productKeywords(r.product).some((keyword) => question.includes(` ${keyword} `));
        }

        return true;
    };

    /** The AI's answer to a question asked mid-flow (classify.js); true when one was said. */
    const answerFlowQuestion = () => {
        if (!r.isQuestion || r.intent === 'other' || !r.aiAnswer || r.aiAnswer.type === 'unclear') return false;

        if (r.aiAnswer.type === 'answer') {
            say(r.aiAnswer.text);
        } else {
            say(replies.aiUnknown());
            patch.offered_cs = 1;
        }

        return true;
    };

    /** Everything after the greeting. */
    const handle = () => {
        // They asked for a person: no questions, straight to CS.
        if (r.intent === 'human') {
            say(replies.waitForCs());

            return handover('minta bicara dengan CS');
        }

        if (r.intent === 'voice') {
            say(replies.voiceNote());

            return;
        }

        // A picture outside the design step: received, noted for CS (at a follow-up question it is the answer).
        if (r.intent === 'image' && state().step !== 'awaiting_detail') return received();

        // "Bisa DP dulu?": noted for CS, the flow waits where it was.
        if (r.intent === 'cs_question') {
            note(String(r.text ?? '').slice(0, 300));
            say(replies.csQuestion());

            return;
        }

        // A question in the middle of the order ("sablonnya pakai apa kak?"):
        // answered by the AI from the shop's facts, and the flow waits where it
        // was. "Bisa bikin jersey?" before any product: the answer, then the flow.
        if (answerFlowQuestion()) {
            const midOrder = ['awaiting_design', 'awaiting_quantity', 'awaiting_detail'].includes(state().step);
            if (!midOrder && r.intent === 'product' && r.product && r.product !== state().product) productFlow(r.product);

            return;
        }

        // "Kamu bot ya?": answered honestly; the flow waits where it was.
        if (r.intent === 'about_bot') {
            say(replies.aboutBot());

            return;
        }

        // A product the shop does not list: CS checks it, the bot names what it makes, the chat stays open.
        if (r.intent === 'product_unknown' || (r.intent === 'product' && !r.product)) {
            say(replies.productUnknown());
            if (['new', 'awaiting_intro'].includes(state().step)) patch.step = 'awaiting_product';

            return;
        }

        // An amount said in passing ("desain logo, 50 pcs") is kept for CS and not asked again.
        if (r.quantity && !state().quantity) patch.quantity = r.quantity;

        // "Nanti saya kabari, masih dikumpulkan": the size list often comes days
        // after the size chart. Not the answer and not a miss; the question
        // stays open (store.js keeps this step for detailWaitDays).
        const later = state().step === 'awaiting_detail' && r.intent !== 'image' && !(r.attachments ?? []).length
            && !/\d/.test(String(r.text ?? '')) && saysAny(r.text, 'jawaban_menyusul');
        if (later) {
            note('Jawaban menyusul: ' + String(r.text ?? '').slice(0, 200));
            say(replies.detailLater());

            return;
        }

        if (state().step === 'awaiting_detail' && isDetailAnswer()) {
            const i = state().detail_index ?? 0;
            const question = productQuestions(state().product)[i] ?? '';

            const answer = String(r.text ?? '').trim() || attachmentNotes().join(' ') || '[gambar]';
            // Kept with the answer: whether it said anything about their design.
            const design = r.design ?? (r.intent === 'no_reference' ? 'none' : null);
            patch.details = JSON.stringify([...details(), { q: question, a: answer.slice(0, 500), ...(design ? { design } : {}) }]);

            // A bare number ("15", "40 pcs") answering a detail question is how many they want.
            if (!state().quantity && /^\d{1,6}\s*(pcs|pc|an|biji|stel|orang)?$/i.test(answer)) patch.quantity = answer;

            next(i + 1);

            return;
        }

        if (FAQ.has(r.intent)) {
            // "mau bikin jersey, minimal berapa?": answer, then start the
            // jersey flow so the bot's own question comes last.
            if (answerFaqs() && wantsProduct && state().step !== 'awaiting_size_chart_product') {
                productFlow(r.product);
            }

            return;
        }

        // A side question next to the answer the bot asked for: answer it
        // first, then carry on with the flow.
        if (!answerFaqs()) return;

        const step = state().step;

        // "ok", "makasih": nothing to answer and no reason to call CS. After the
        // quantity question it closes the flow politely ([7] + [8]).
        if (r.intent === 'ack') {
            if (step === 'awaiting_quantity') finish();

            return;
        }

        // "mau nanya2 dulu": invite the question and keep waiting where we were.
        if (r.intent === 'ask_first') {
            say(replies.askFirst());

            return;
        }

        if (r.intent === 'price') return price();

        if (step === 'awaiting_size_chart_product') {
            if (r.product) {
                patch.product = r.product;
                patch.step = conv.return_step ?? 'awaiting_product';
                patch.return_step = null;
                sizeChart(r.product, r.sizeVariant);
            } else {
                notUnderstood('produk size chart tidak dikenali');
                // Ask the size chart question again with the apology.
                if (patch.step !== 'handed_over') say(replies.sizeChartWhich());
            }

            return;
        }

        if (r.intent === 'product' && r.product && r.product !== state().product) {
            productFlow(r.product);

            return;
        }

        // A name, first or corrected ("eh salah, nama saya Haikal"): kept, never
        // a miss. Before the product: [3] again; mid-order: the flow waits where it was.
        if (r.intent === 'introduction' && r.name) {
            remember('name', r.name);
            remember('origin', r.origin);
            say(step === 'awaiting_product' ? replies.afterIntro(r.name) : replies.introAgain(r.name));

            return;
        }

        switch (step) {
            case 'awaiting_product':
                if (r.intent === 'product' && r.product) return productFlow(r.product);
                if (r.intent === 'greeting') return; // already asked; nothing to add
                // The greeting already asked what they need; do not apologise on the first message.
                if (conv.step === 'new') return;

                return notUnderstood(`tidak dikenali (${r.intent})`);

            case 'awaiting_design':
                if (r.intent === 'no_reference') {
                    say(replies.portfolio());
                    if (state().product === 'jersey') say(replies.jerseyTemplates());
                    // [6B] examples: the product's WhatsApp catalog items ("Contoh Baju Osis", ...).
                    if (state().product && media.links?.('katalog', state().product).length) send('katalog', state().product);

                    return finish();
                }
                if (r.intent === 'quantity') return finish();
                if (r.intent === 'greeting') return;
                // A description, a picture or anything else is their design
                // input; CS reads it later.
                return finish();

            case 'awaiting_detail':
                // A greeting while a follow-up question waits: ask nothing new.
                if (['greeting', 'introduction'].includes(r.intent)) return;

                return notUnderstood(`jawaban detail tidak dipahami (${r.intent})`);

            case 'awaiting_quantity':
                if (r.intent === 'greeting') return;
                // A question the bot did not get is asked again, not taken as the end of the order.
                // "Belum tahu", "nanti dikabari" are an answer: the flow ends as usual.
                if (r.intent === 'other' && !saysAny(r.text, 'jawaban_belum_pasti')) {
                    return notUnderstood('jawaban jumlah tidak dipahami');
                }
                // Kept as they wrote it, for CS.
                if (!state().quantity && r.intent === 'quantity') patch.quantity = r.quantity ?? String(r.text ?? '').slice(0, 40);

                return finish();

            default:
                return notUnderstood(`langkah tidak dikenal: ${step}`);
        }
    };

    // The bot offered CS ("Apa mau saya oper ke CS?"): "iya" hands over; anything
    // else carries on as usual and the offer lapses (Kamus: jawaban_ya / jawaban_tidak).
    if (Number(conv.offered_cs) && conv.step !== 'handed_over') {
        patch.offered_cs = 0;

        if (saysWord(r.text, 'jawaban_ya') && !saysWord(r.text, 'jawaban_tidak') && ['ack', 'other', 'human'].includes(r.intent)) {
            say(replies.waitForCs());
            handover('pelanggan minta dioper ke CS');

            return { actions, patch };
        }
    }

    switch (conv.step) {
        case 'handed_over':
            return { actions: [], patch: {} };

        case 'new': {
            const name = r.name ?? conv.name;

            if (r.intent === 'human') {
                // "Mau ngobrol sama admin" as the very first message: straight to CS.
                handle();
            } else if (conv.autoGreeted) {
                // The WhatsApp Business Salam already greeted them and asked who
                // they are: no second greeting, no apology on the first message.
                if (r.name) {
                    remember('name', r.name);
                    remember('origin', r.origin);
                    say(replies.afterIntro(r.name));
                    patch.step = 'awaiting_product';
                    if (answerFaqs() && r.product) productFlow(r.product);
                } else if (['greeting', 'ack', 'other'].includes(r.intent)) {
                    patch.step = 'awaiting_intro';
                    remember('product', r.product);
                    remember('quantity', r.quantity);
                } else {
                    patch.step = 'awaiting_product';
                    handle();
                }
            } else if (name) {
                // [1]. A returning customer is greeted by the name we stored.
                remember('name', r.name);
                remember('origin', r.origin);
                say(replies.greetKnown(name));
                patch.step = 'awaiting_product';

                if (!['greeting', 'introduction', 'ack', 'ask_first'].includes(r.intent)) handle();
            } else {
                // [2]. Keep any product they mentioned for after the intro.
                say(replies.greetUnknown());
                patch.step = 'awaiting_intro';
                remember('product', r.product);
                remember('quantity', r.quantity);

                answerFaqs();
                if (r.intent === 'about_bot') say(replies.aboutBot());
                if (r.intent === 'product_unknown') say(replies.productUnknown());
                if (r.intent === 'voice') say(replies.voiceNote());
                if (r.intent === 'image') received();
                if (r.intent === 'cs_question') {
                    note(String(r.text ?? '').slice(0, 300));
                    say(replies.csQuestion());
                }
            }

            break;
        }

        case 'awaiting_intro':
            if (r.name) {
                remember('name', r.name);
                remember('origin', r.origin);
                say(replies.afterIntro(r.name));
                patch.step = 'awaiting_product';

                const pending = r.product ?? conv.product;

                if (answerFaqs() && pending && (wantsProduct || !FAQ.has(r.intent))) productFlow(pending);
            } else if (r.intent === 'product' || FAQ.has(r.intent)) {
                // They skipped the introduction; do not ask twice.
                patch.step = 'awaiting_product';
                handle();
            } else if (r.intent === 'greeting' || r.intent === 'ack') {
                // still waiting for the introduction
            } else if (['ask_first', 'price', 'human', 'about_bot', 'product_unknown', 'cs_question', 'image', 'voice'].includes(r.intent)) {
                // They want to get to their question; do not insist on the introduction.
                patch.step = 'awaiting_product';
                handle();
            } else {
                // Not a name and not a known question: do not insist on the introduction.
                patch.step = 'awaiting_product';
                notUnderstood(`perkenalan tidak dikenali (${r.intent})`);
            }
            break;

        default:
            handle();
    }

    // A question only CS can answer, next to something the bot did answer
    // ("minimal berapa? bisa DP?"): noted for CS and said so, once.
    if (r.csQuestion && r.intent !== 'cs_question' && patch.step !== 'handed_over' && conv.step !== 'handed_over') {
        note(String(r.text ?? '').slice(0, 300));
        if (!actions.some((a) => a.text === replies.csQuestion())) say(replies.csQuestion());
    }

    // A message that was understood starts the count of misses over; one that
    // was not keeps it (notUnderstood set it), whatever its label.
    if (!missed && Number(conv.misses) && patch.step !== 'handed_over') patch.misses = 0;

    // The AI's opening line (checked in ai-text.js) goes before the fixed reply,
    // never on its own and never in front of a handover.
    if (r.opening && actions.some((a) => a.type === 'text') && patch.step !== 'handed_over') {
        actions.unshift({ type: 'text', text: r.opening });
    }

    return { actions, patch };
}
