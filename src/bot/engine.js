import { getProduct, hasCatalog, productKeywords, productName, productQuestions } from './products.js';
import { textVersions } from './patterns.js';
import { config } from '../config.js';
import { normalise } from '../text.js';
import { wordMap, wordSet } from './words.js';
import { fillText, replies } from './replies.js';
import { isSizeQuestion, sizeChartActions } from './media-plan.js';


const FAQ = new Set(['size_chart', 'design_reference', 'custom']);

const saysAny = (text, list) => {
    const lower = ` ${String(text ?? '').toLowerCase()} `;

    return [...wordSet(list)].some((w) => lower.includes(w));
};

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
    const send = (kind, product = null, variant = null) => {
        if (actions.some((a) => a.type === 'media' && a.kind === kind && a.product === product && a.variant === variant)) return;
        actions.push({ type: 'media', kind, product, variant });
    };

    const handover = (reason) => {
        say(replies.handoverNotice());
        actions.push({ type: 'handover', reason });
        patch.step = 'handed_over';
    };

    const giveUp = (reason) => {
        say(replies.waitForCs());
        handover(reason);
    };

    let missed = false;
    const notUnderstood = (reason) => {
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

    const closeOrder = () => {
        say(replies.waitForCs());
        say(replies.socials());
        handover('alur selesai');
    };

    const next = (i, quantityAsked = false) => {
        const product = state().product;
        const questions = productQuestions(product);
        const sizeAt = getProduct(product)?.sizeChart && questions.length ? questions.length - 1 : questions.length;

        if (i < sizeAt) return askQuestion(i);
        if (!state().quantity && !quantityAsked && i <= sizeAt) {
            say(hasCatalog(product) ? replies.askQuantityCatalog() : replies.askQuantity());
            patch.step = 'awaiting_quantity';
            patch.detail_index = i;

            return;
        }
        if (i < questions.length) return askQuestion(i);

        closeOrder();
    };

    const finish = () => (state().step === 'awaiting_quantity' ? next(state().detail_index ?? 0, true) : next(0));

    const remember = (key, value) => {
        if (value) patch[key] = value;
    };

    const note = (text) => {
        let notes = [];
        try {
            notes = JSON.parse(state().notes ?? '[]');
        } catch {
        }
        if (!notes.includes(text)) patch.notes = JSON.stringify([...notes, text].slice(-10));
    };

    const attachmentNotes = () => (r.attachments ?? []).map((a) => a.note).filter(Boolean);

    const received = () => {
        const notes = attachmentNotes();
        for (const n of notes.length ? notes : ['[gambar dari pelanggan]']) note(n);

        const kind = r.attachments?.[0]?.kind ?? 'gambar';
        say(replies.imageReceived(wordMap('nama_lampiran').get(kind) ?? 'kirimannya'));
    };

    const details = () => {
        try {
            return JSON.parse(state().details ?? '[]');
        } catch {
            return [];
        }
    };

    const askQuestion = (i) => {
        const question = productQuestions(state().product)[i];
        if (!question) return false;

        if (getProduct(state().product)?.sizeChart && isSizeQuestion(question) && media.has('size-chart', state().product, 'reguler')) {
            actions.push(...sizeChartActions(media, state().product));
        }
        say(fillText(question, { nama: state().name ?? '', produk: productName(state().product) }));
        patch.detail_index = i;
        patch.step = 'awaiting_detail';

        return true;
    };

    const productFlow = (product) => {
        if (state().product && state().product !== product) patch.quantity = r.quantity ?? null;
        else if (r.quantity) patch.quantity = r.quantity;

        patch.product = product;
        patch.details = null;
        patch.detail_index = null;

        if (hasCatalog(product)) {
            if (media.has('katalog', product)) send('katalog', product);
            if (product === 'jersey') {
                if (media.has('promo', 'jersey')) send('promo', 'jersey');
                say(replies.jerseyPromo());
            }
        }

        if (hasCatalog(product)) return next(0);

        say(replies.askDesign(productName(product)));
        patch.step = 'awaiting_design';
    };

    const sizeChart = (product, variant) => {
        const found = [variant, 'reguler'].find((v) => media.has('size-chart', product, v));

        if (!found) {
            say(replies.sizeChartMissing(productName(product)));

            return;
        }

        send('size-chart', product, found);
        say(replies.sizeChartNote());
    };

    const price = () => {
        const product = state().product;

        if (!product) {
            say(replies.priceWhich());
            patch.step = 'awaiting_product';

            return;
        }

        if (hasCatalog(product) && media.has('katalog', product)) {
            send('katalog', product);
            if (state().step === 'awaiting_product') finish();

            return;
        }

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

    const faqs = [r.intent, ...(r.extras ?? [])].filter(
        (intent, i, list) =>
            FAQ.has(intent) &&
            list.indexOf(intent) === i &&
            !(intent === 'design_reference' && r.intent === 'no_reference'),
    );
    const wantsProduct = Boolean(r.product) && (r.intent === 'product' || (r.extras ?? []).includes('product'));

    const answerPattern = (p) => {
        for (const bubble of p.bubbles) {
            if (bubble.type === 'text') {
                const versions = textVersions(bubble.text);
                say(fillText(versions[Math.floor(random() * versions.length)] ?? '', { nama: state().name ?? '' }));
            }
            if (bubble.type === 'link') say(bubble.url);
            if (bubble.type === 'photos' && media.has('pola', String(p.id))) send('pola', String(p.id));
            if (bubble.type === 'catalog') for (const link of media.catalogItemLinks?.(bubble.items) ?? []) say(link);
            if (bubble.type === 'slot') {
                const [kind, product = null, variant = null] = bubble.slot.split(':');
                if (media.has(kind, product, variant)) send(kind, product, variant);
            }
        }

        if (p.after === 'handover') handover(`pola: ${p.name}`);
    };

    const answerFaqs = () => {
        if ((faqs.length || r.patterns?.length) && r.product && !state().product) remember('product', r.product);

        for (const p of r.patterns ?? []) {
            answerPattern(p);
            if (handedOver()) return false;
        }

        for (const intent of faqs) {
            if (intent === 'custom') continue;
            answerFaq(intent);
            if (handedOver()) return false;
        }

        return true;
    };

    const isDetailAnswer = () => {
        if (['custom', 'price', 'ask_first', 'ack', 'greeting', 'introduction', 'human', 'voice', 'cs_question', 'about_bot', 'product_unknown'].includes(r.intent)) return false;
        if (r.intent === 'design_reference' && !r.design) return false;
        if (r.intent === 'size_chart' && saysAny(r.text, 'minta_size_chart')) return false;

        if (r.product && r.product !== state().product) {
            const question = normalise(productQuestions(state().product)[state().detail_index ?? 0] ?? '');

            return productKeywords(r.product).some((keyword) => question.includes(` ${keyword} `));
        }

        return true;
    };

    const answerFlowQuestion = () => {
        if (!r.isQuestion || r.intent === 'other' || !r.aiAnswer || r.aiAnswer.type === 'unclear') return false;

        if (r.aiAnswer.type === 'answer') {
            say(r.aiAnswer.text);
        } else {
            note(String(r.text ?? '').slice(0, 300));
            say(replies.csQuestion());
        }

        return true;
    };

    const handle = () => {
        if (r.intent === 'human') {
            say(replies.waitForCs());

            return handover('minta bicara dengan CS');
        }

        if (r.intent === 'voice') {
            say(replies.voiceNote());

            return;
        }

        if (r.intent === 'image' && state().step !== 'awaiting_detail') return received();

        if (r.intent === 'cs_question') {
            note(String(r.text ?? '').slice(0, 300));
            say(replies.csQuestion());

            return;
        }

        if (answerFlowQuestion()) {
            const midOrder = ['awaiting_design', 'awaiting_quantity', 'awaiting_detail'].includes(state().step);
            if (!midOrder && r.intent === 'product' && r.product && r.product !== state().product) productFlow(r.product);

            return;
        }

        if (r.intent === 'about_bot') {
            say(replies.aboutBot());

            return;
        }

        if (r.intent === 'product_unknown' || (r.intent === 'product' && !r.product)) {
            say(replies.productUnknown());
            if (['new', 'awaiting_intro'].includes(state().step)) patch.step = 'awaiting_product';

            return;
        }

        if (r.quantity && !state().quantity) patch.quantity = r.quantity;

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
            const design = r.design ?? (r.intent === 'no_reference' ? 'none' : null);
            patch.details = JSON.stringify([...details(), { q: question, a: answer.slice(0, 500), ...(design ? { design } : {}) }]);

            if (!state().quantity && /^\d{1,6}\s*(pcs|pc|an|biji|stel|orang)?$/i.test(answer)) patch.quantity = answer;

            next(i + 1);

            return;
        }

        if (FAQ.has(r.intent)) {
            if (answerFaqs() && wantsProduct && state().step !== 'awaiting_size_chart_product') {
                productFlow(r.product);
            }

            return;
        }

        if (!answerFaqs()) return;

        const step = state().step;

        if (r.intent === 'ack') {
            if (step === 'awaiting_quantity') finish();

            return;
        }

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
                if (patch.step !== 'handed_over') say(replies.sizeChartWhich());
            }

            return;
        }

        if (r.intent === 'product' && r.product && r.product !== state().product) {
            productFlow(r.product);

            return;
        }

        if (r.intent === 'introduction' && r.name) {
            remember('name', r.name);
            remember('origin', r.origin);
            say(step === 'awaiting_product' ? replies.afterIntro(r.name) : replies.introAgain(r.name));

            return;
        }

        switch (step) {
            case 'awaiting_product':
                if (r.intent === 'product' && r.product) return productFlow(r.product);
                if (r.intent === 'greeting') return;
                if (conv.step === 'new') return;

                return notUnderstood(`tidak dikenali (${r.intent})`);

            case 'awaiting_design':
                if (r.intent === 'no_reference') {
                    say(replies.portfolio());
                    if (state().product === 'jersey') say(replies.jerseyTemplates());
                    if (state().product && media.links?.('katalog', state().product).length) send('katalog', state().product);

                    return finish();
                }
                if (r.intent === 'quantity') return finish();
                if (r.intent === 'greeting') return;
                return finish();

            case 'awaiting_detail':
                if (['greeting', 'introduction'].includes(r.intent)) return;

                return notUnderstood(`jawaban detail tidak dipahami (${r.intent})`);

            case 'awaiting_quantity':
                if (r.intent === 'greeting') return;
                if (r.intent === 'other' && !saysAny(r.text, 'jawaban_belum_pasti')) {
                    return notUnderstood('jawaban jumlah tidak dipahami');
                }
                if (!state().quantity && r.intent === 'quantity') patch.quantity = r.quantity ?? String(r.text ?? '').slice(0, 40);

                return finish();

            default:
                return notUnderstood(`langkah tidak dikenal: ${step}`);
        }
    };

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
                handle();
            } else if (conv.autoGreeted) {
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
                remember('name', r.name);
                remember('origin', r.origin);
                say(replies.greetKnown(name));
                patch.step = 'awaiting_product';

                if (!['greeting', 'introduction', 'ack', 'ask_first'].includes(r.intent)) handle();
            } else {
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
                patch.step = 'awaiting_product';
                handle();
            } else if (r.intent === 'greeting' || r.intent === 'ack') {
            } else if (['ask_first', 'price', 'human', 'about_bot', 'product_unknown', 'cs_question', 'image', 'voice'].includes(r.intent)) {
                patch.step = 'awaiting_product';
                handle();
            } else {
                patch.step = 'awaiting_product';
                notUnderstood(`perkenalan tidak dikenali (${r.intent})`);
            }
            break;

        default:
            handle();
    }

    if (r.csQuestion && r.intent !== 'cs_question' && patch.step !== 'handed_over' && conv.step !== 'handed_over') {
        note(String(r.text ?? '').slice(0, 300));
        if (!actions.some((a) => a.text === replies.csQuestion())) say(replies.csQuestion());
    }

    if (!missed && Number(conv.misses) && patch.step !== 'handed_over') patch.misses = 0;

    if (r.opening && actions.some((a) => a.type === 'text') && patch.step !== 'handed_over') {
        actions.unshift({ type: 'text', text: r.opening });
    }

    return { actions, patch };
}
