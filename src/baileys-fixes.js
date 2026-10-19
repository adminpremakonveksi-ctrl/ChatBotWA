/**
 * Fixes for Baileys 6.7.24 (pinned: 7.0 is still a release candidate),
 * applied to each socket from our code, so a client's `npm install` never
 * loses them (patching node_modules would; the installer skips scripts).
 *
 * Each fix is as narrow as possible and leaves Baileys' own handling (its
 * processing order, its receipts to the server) as it is.
 */

/**
 * WhatsApp sends "mex" notifications for more than channels: a linked-profiles
 * update (<update op_name="NotificationLinkedProfilesUpdatesSideSub">) has no
 * <mex> child. Baileys 6.7.24 routes every type="mex" notification to its
 * channel handler, which rejects it ("Invalid mex newsletter notification").
 *
 * Fix: before Baileys sees it, such a notification is given its own type.
 * Baileys has no handler for that type, so it does nothing with it except the
 * receipt (ack) to the server, which it always sends. Channel notifications
 * (with <mex>) are untouched.
 */
export const NON_CHANNEL_MEX = 'mex-update';

export const isNonChannelMex = (node) =>
    node?.attrs?.type === 'mex' && !(Array.isArray(node.content) && node.content.some((child) => child?.tag === 'mex'));

export function fixMexNotifications(socket) {
    const ws = socket?.ws;
    if (typeof ws?.prependListener !== 'function') return false;

    ws.prependListener('CB:notification', (node) => {
        if (isNonChannelMex(node)) node.attrs.type = NON_CHANNEL_MEX;
    });

    return true;
}
