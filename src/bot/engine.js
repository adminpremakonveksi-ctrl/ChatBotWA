import { hasCatalog, productKeywords, productName, productQuestions } from './products.js';
import { textVersions } from './patterns.js';
import { config } from '../config.js';
import { normalise } from '../text.js';
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

export function decide(conversation, classified, media, { random = Math.random } = {}) {
    const conv = { step: 'new', name: null, origin: null, product: null, return_step: null, ...conversation };
    const r = classified;

    const actions = [];
    const patch = {};
    const state = () => ({ ...conv, ...patch });

    const say = (text) => text && actions.push({ type: 'text', text });
    const send = (kind, product = null, variant = null) => actions.push({ type: 'media', kind, product, variant });

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
        missed = true;
        const misses = (Number(conv.misses) || 0) + 1;

        if (misses >= (config.bot.maxMisses ?? 3)) {
            patch.misses = 0;

            return giveUp(`${misses}× tidak dipahami: ${reason}`);
        }

        patch.misses = misses;
        say(replies.clarify());
    };

    /** [7] + [8], then CS takes over. */
    const finish = () => {
        say(replies.waitForCs());
        say(replies.socials());
        handover('alur selesai');
    };

    const remember = (key, value) => {
        if (value) patch[key] = value;
    };

    const details = () => {
        try {
            return JSON.parse(state().details ?? '[]');
        } catch {
            return [];
        }
    };

    /** [5], unless they already said how many ("kemeja 2000 pcs"): then the flow is done. */
    const askQuantityOrFinish = (question) => {
        if (state().quantity) return finish();

        say(question);
        patch.step = 'awaiting_quantity';
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

    /** After the follow-up questions: the spec flow, [5] for catalog products, [4] for the rest. */
    const afterQuestions = () => {
        const product = state().product;

        if (hasCatalog(product)) return askQuantityOrFinish(replies.askQuantityCatalog());

        // They already said something about the design while answering: no [4] again.
        const design = details().findLast((d) => d.design)?.design;
        if (design === 'none') {
            // As at [4] with "belum ada": the portfolio [6B] (and [6] for jersey), then [5].
            say(replies.portfolio());
            if (product === 'jersey') say(replies.jerseyTemplates());

            return askQuantityOrFinish(replies.askQuantity());
        }
        if (design === 'ready') return askQuantityOrFinish(replies.askQuantity());

        say(replies.askDesign(productName(product)));
        patch.step = 'awaiting_design';
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

        // "Kemeja apa? Ukuran apa saja?" first, so CS gets a usable order.
        if (!askQuestion(0)) afterQuestions();
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
            if (state().step === 'awaiting_product') afterQuestions();

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
        if (['custom', 'price', 'ask_first', 'ack', 'greeting', 'introduction', 'human'].includes(r.intent)) return false;
        // "Ada contoh desainnya?" is their question; "belum ada desain" is an answer.
        if (r.intent === 'design_reference' && !r.design) return false;
        // "Ukuran campur, nanti dikabari" answers the size question; "size chartnya ada?" asks for the chart.
        if (r.intent === 'size_chart' && /chart|cart|tabel|\?|(minta|kirim\w*|lihat|liat|ada)\s+(size|ukuran|daftar)/i.test(String(r.text ?? ''))) return false;

        // Another product named: an answer when the question itself offers it
        // ("Kemejanya jenis apa? Misal PDH ..." -> "PDH lengan panjang"), a
        // change of mind otherwise ("eh kalau jaket bisa?").
        if (r.product && r.product !== state().product) {
            const question = normalise(productQuestions(state().product)[state().detail_index ?? 0] ?? '');

            return productKeywords(r.product).some((keyword) => question.includes(` ${keyword} `));
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

        // An amount said in passing ("desain logo, 50 pcs") is kept for CS and not asked again.
        if (r.quantity && !state().quantity) patch.quantity = r.quantity;

        if (state().step === 'awaiting_detail' && isDetailAnswer()) {
            const i = state().detail_index ?? 0;
            const question = productQuestions(state().product)[i] ?? '';

            const answer = String(r.text ?? '').trim();
            // Kept with the answer: whether it said anything about their design.
            const design = r.design ?? (r.intent === 'no_reference' ? 'none' : null);
            patch.details = JSON.stringify([...details(), { q: question, a: answer.slice(0, 500), ...(design ? { design } : {}) }]);

            // A bare number ("15", "40 pcs") answering a detail question is how many they want.
            if (!state().quantity && /^\d{1,6}\s*(pcs|pc|an|biji|stel|orang)?$/i.test(answer)) patch.quantity = answer;

            if (!askQuestion(i + 1)) afterQuestions();

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

        switch (step) {
            case 'awaiting_product':
                if (r.intent === 'product' && r.product) return productFlow(r.product);
                if (r.intent === 'greeting') return; // already asked; nothing to add
                if (r.intent === 'introduction' && r.name && !state().name) {
                    remember('name', r.name);
                    remember('origin', r.origin);
                    say(replies.afterIntro(r.name));

                    return;
                }
                // The greeting already asked what they need; do not apologise on the first message.
                if (conv.step === 'new') return;

                return notUnderstood(`tidak dikenali (${r.intent})`);

            case 'awaiting_design':
                if (r.intent === 'no_reference') {
                    say(replies.portfolio());
                    if (state().product === 'jersey') say(replies.jerseyTemplates());
                    // [6B] examples: the product's WhatsApp catalog items ("Contoh Baju Osis", ...).
                    if (state().product && media.links?.('katalog', state().product).length) send('katalog', state().product);

                    return askQuantityOrFinish(replies.askQuantity());
                }
                if (r.intent === 'quantity') return finish();
                if (r.intent === 'greeting') return;
                // A description, a picture or anything else is their design
                // input; CS reads it later.
                return askQuantityOrFinish(replies.askQuantity());

            case 'awaiting_detail':
                // A greeting or a name while a follow-up question waits: keep the name, ask nothing new.
                if (r.intent === 'introduction' && r.name && !state().name) {
                    remember('name', r.name);
                    remember('origin', r.origin);
                }
                if (['greeting', 'introduction'].includes(r.intent)) return;

                return notUnderstood(`jawaban detail tidak dipahami (${r.intent})`);

            case 'awaiting_quantity':
                if (r.intent === 'greeting') return;
                // A question the bot did not get is asked again, not taken as the end of the order.
                // "Belum tahu", "nanti dikabari" are an answer: the flow ends as usual.
                if (r.intent === 'other' && !/\b(belum|blm|tau|tahu|bingung|nanti|terserah|kurang|sekitar|kira)/i.test(String(r.text ?? ''))) {
                    return notUnderstood('jawaban jumlah tidak dipahami');
                }
                // Kept as they wrote it, for CS.
                if (!state().quantity && r.intent === 'quantity') patch.quantity = r.quantity ?? String(r.text ?? '').slice(0, 40);

                return finish();

            default:
                return notUnderstood(`langkah tidak dikenal: ${step}`);
        }
    };

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
                    if (r.intent === 'product' && r.product) productFlow(r.product);
                    else handle();
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
                if (r.intent === 'product' && r.product) productFlow(r.product);
                else handle();
            } else if (r.intent === 'greeting' || r.intent === 'ack') {
                // still waiting for the introduction
            } else if (r.intent === 'ask_first' || r.intent === 'price' || r.intent === 'human') {
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

    // A message that was understood starts the count of misses over; one that
    // was not keeps it (notUnderstood set it), whatever its label.
    if (!missed && Number(conv.misses) && patch.step !== 'handed_over') patch.misses = 0;

    return { actions, patch };
}
