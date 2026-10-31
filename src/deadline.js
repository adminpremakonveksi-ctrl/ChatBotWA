/** Bound a network operation even when a library promise never settles. */
export function withDeadline(work, milliseconds, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error('Timed Out: ' + label), { code: 'ETIMEDOUT' })), milliseconds);
        Promise.resolve().then(work).then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}
