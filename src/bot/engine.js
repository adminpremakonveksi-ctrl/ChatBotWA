import { hasCatalog, productName } from './products.js';
import { replies } from './replies.js';

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
 *   awaiting_design              asked for a design reference [4]
 *   awaiting_quantity            asked how many [5]
 *   awaiting_size_chart_product  asked which product the size chart is for
 *   handed_over                  CS takes it from here; bot stays silent
 */

const FAQ = new Set(['size_chart', 'location', 'shipping', 'trust', 'design_reference', 'moq']);

export function decide(conversation, classified, media) {
    const conv = { step: 'new', name: null, origin: null, product: null, return_step: null, ...conversation };
    const r = classified;

    const actions = [];
    const patch = {};
    const state = () => ({ ...conv, ...patch });

    const say = (text) => text && actions.push({ type: 'text', text });
    const send = (kind, product = null, variant = null) => actions.push({ type: 'media', kind, product, variant });

    const handover = (reason) => {
        actions.push({ type: 'handover', reason });
        patch.step = 'handed_over';
    };

    /** Aturan wajib 1: cannot answer -> straight to CS. */
    const giveUp = (reason) => {
        say(replies.waitForCs());
        handover(reason);
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

    const productFlow = (product) => {
        patch.product = product;

        if (hasCatalog(product)) {
            if (media.has('katalog', product)) send('katalog', product);
            // [9] "sampaikan kalau jersey lagi ada promo": the pamphlet the team
            // uploaded and/or the promo text; neither means no promo right now.
            if (product === 'jersey') {
                if (media.has('promo', 'jersey')) send('promo', 'jersey');
                say(replies.jerseyPromo());
            }
            say(replies.askQuantity());
            patch.step = 'awaiting_quantity';
        } else {
            say(replies.askDesign(productName(product)));
            patch.step = 'awaiting_design';
        }
    };

    const sizeChart = (product, variant) => {
        const found = [variant, 'reguler'].find((v) => media.has('size-chart', product, v));

        if (!found) {
            giveUp(`size chart ${product}/${variant} belum ada`);

            return;
        }

        send('size-chart', product, found);
        say(replies.sizeChartNote());
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

            case 'location':
                say(replies.location());
                say(replies.locationMap());
                break;

            case 'shipping':
                say(replies.shipping());
                break;

            case 'trust':
                say(replies.trust());
                if (media.has('katalog-review')) send('katalog-review');
                break;

            case 'moq':
                say(replies.moq1());
                say(replies.moq2());
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
    const faqs = [r.intent, ...(r.extras ?? [])].filter((intent, i, list) => FAQ.has(intent) && list.indexOf(intent) === i);
    const wantsProduct = Boolean(r.product) && (r.intent === 'product' || (r.extras ?? []).includes('product'));

    /** Answers each FAQ; false when one of them had to hand over. */
    const answerFaqs = () => {
        if (faqs.length && r.product && !state().product) remember('product', r.product);

        for (const intent of faqs) {
            answerFaq(intent);
            if (handedOver()) return false;
        }

        return true;
    };

    /** Everything after the greeting. */
    const handle = () => {
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

        if (step === 'awaiting_size_chart_product') {
            if (r.product) {
                patch.product = r.product;
                patch.step = conv.return_step ?? 'awaiting_product';
                patch.return_step = null;
                sizeChart(r.product, r.sizeVariant);
            } else {
                giveUp('produk size chart tidak dikenali');
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
                return giveUp(`tidak dikenali (${r.intent})`);

            case 'awaiting_design':
                if (r.intent === 'no_reference') {
                    say(replies.portfolio());
                    if (state().product === 'jersey') say(replies.jerseyTemplates());
                    say(replies.askQuantity());
                    patch.step = 'awaiting_quantity';

                    return;
                }
                if (r.intent === 'quantity') return finish();
                if (r.intent === 'greeting') return;
                // A description, a picture or anything else is their design
                // input; CS reads it later.
                say(replies.askQuantity());
                patch.step = 'awaiting_quantity';

                return;

            case 'awaiting_quantity':
                if (r.intent === 'greeting') return;
                return finish();

            default:
                return giveUp(`langkah tidak dikenal: ${step}`);
        }
    };

    switch (conv.step) {
        case 'handed_over':
            return { actions: [], patch: {} };

        case 'new': {
            const name = r.name ?? conv.name;

            if (name) {
                // [1]. A returning customer is greeted by the name we stored.
                remember('name', r.name);
                remember('origin', r.origin);
                say(replies.greetKnown(name));
                patch.step = 'awaiting_product';

                if (!['greeting', 'introduction'].includes(r.intent)) handle();
            } else {
                // [2]. Keep any product they mentioned for after the intro.
                say(replies.greetUnknown());
                patch.step = 'awaiting_intro';
                remember('product', r.product);

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
            } else if (r.intent === 'greeting') {
                // still waiting for the introduction
            } else {
                giveUp(`perkenalan tidak dikenali (${r.intent})`);
            }
            break;

        default:
            handle();
    }

    return { actions, patch };
}
