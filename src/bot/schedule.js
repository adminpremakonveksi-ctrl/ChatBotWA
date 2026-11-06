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

const dateFormatters = new Map();

export function localDateString(date, timezone) {
    if (!dateFormatters.has(timezone)) dateFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone }));

    return dateFormatters.get(timezone).format(date);
}

export function holidayOn(date = new Date(), options = config.bot) {
    const day = localDateString(date, options.timezone);

    return (options.holidays ?? []).find((h) => day >= h.from && day <= h.to) ?? null;
}

export function localClock(date, timezone) {
    const parts = Object.fromEntries(formatterFor(timezone).formatToParts(date).map((part) => [part.type, part.value]));

    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return { day: days[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isBotActive(date = new Date(), options = config.bot) {
    if (options.forceMode === 'always') return true;
    if (options.forceMode === 'never') return false;

    const { day, minutes } = localClock(date, options.timezone);

    if (day === 0 || holidayOn(date, options)) {
        return true;
    }

    return inWindow(minutes, options.activeFrom, options.activeUntil);
}

export function inWindow(minutes, from, until) {
    const start = toMinutes(from);
    const end = toMinutes(until);

    if (start === end) return true;

    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function describeHours(from, until) {
    const start = toMinutes(from);
    const end = toMinutes(until);
    const dot = (t) => String(t).replace(':', '.');

    if (start === end) return 'aktif 24 jam setiap hari';
    if (start > end) return `aktif Sen–Sab ${dot(from)} sampai ${dot(until)} besok paginya, Minggu 24 jam`;

    return `aktif Sen–Sab ${dot(from)}–${dot(until)} (siang), Minggu 24 jam`;
}

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

export function utcOffsetMinutes(date = new Date(), timezone = config.bot.timezone) {
    const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));

    return Math.round((local - utc) / 60000);
}
