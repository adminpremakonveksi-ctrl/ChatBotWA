import { config } from '../config.js';

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(/[:.]/).map(Number);

    return h * 60 + (m || 0);
};

const formatters = new Map();

const formatterFor = (timezone) => {
    if (!formatters.has(timezone)) {
        formatters.set(
            timezone,
            new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        );
    }

    return formatters.get(timezone);
};

/** Day of week (0 = Sunday) and minutes since midnight in the shop's timezone. */
export function localClock(date, timezone) {
    const parts = Object.fromEntries(formatterFor(timezone).formatToParts(date).map((part) => [part.type, part.value]));

    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return { day: days[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * The bot is a night guard, not a CS replacement. It speaks only outside
 * working hours: Mon-Sat from 17.30 to 07.30, and all of Sunday. Inside working
 * hours it stays completely silent and CS handles every chat.
 *
 * Monday 00.00-07.30 counts as active because it is still the night window.
 */
export function isBotActive(date = new Date(), options = config.bot) {
    if (options.forceMode === 'always') return true;
    if (options.forceMode === 'never') return false;

    const { day, minutes } = localClock(date, options.timezone);

    if (day === 0) {
        return true;
    }

    const from = toMinutes(options.activeFrom);
    const until = toMinutes(options.activeUntil);

    return minutes >= from || minutes < until;
}

/** When the bot next switches between active and silent (minute precision, within 8 days). */
export function nextChange(date = new Date(), options = config.bot) {
    if (options.forceMode === 'always' || options.forceMode === 'never') return null;

    const start = new Date(Math.ceil(date.getTime() / 60000) * 60000);
    const now = isBotActive(date, options);

    for (let minute = 0; minute <= 8 * 24 * 60; minute++) {
        const at = new Date(start.getTime() + minute * 60000);
        if (isBotActive(at, options) !== now) return at;
    }

    return null;
}

/** Minutes the shop's timezone is ahead of UTC (Asia/Jakarta: 420). */
export function utcOffsetMinutes(date = new Date(), timezone = config.bot.timezone) {
    const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));

    return Math.round((local - utc) / 60000);
}
