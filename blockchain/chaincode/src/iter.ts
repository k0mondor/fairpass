/**
 * Fabric range/composite-key iterators use next()/close() rather than the
 * standard AsyncIterable protocol in their TypeScript types, so this walks
 * them by hand and always closes, even on error.
 */
interface FabricIterator {
    close(): Promise<void>;
    next(): Promise<{ value: { key: string; value: Uint8Array }; done: boolean }>;
}

export async function collectValues(iterator: FabricIterator): Promise<{ key: string; text: string }[]> {
    const out: { key: string; text: string }[] = [];
    try {
        for (;;) {
            const { value, done } = await iterator.next();
            if (done) {
                break;
            }
            out.push({ key: value.key, text: Buffer.from(value.value).toString('utf8') });
        }
    } finally {
        await iterator.close();
    }
    return out;
}
