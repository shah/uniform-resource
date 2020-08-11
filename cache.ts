export interface Cache<T> {
    [key: string]: T;
}

/**
 * Create a simple LRU cache which looks and acts like a normal object but
 * is backed by a Proxy object that stores expensive to construct objects.
 * @param maxEntries evict cached items after this many entries
 */
export function lruCache<T>(maxEntries: number = 50): Cache<T> {
    const result: Cache<T> = {};
    const handler = {
        // Set objects store the cache keys in insertion order.
        cache: new Set<string>(),
        get: function (obj: Cache<T>, key: string): T | undefined {
            const entry = obj[key];
            if (entry) {
                // move the most recent key to the end so it's last to be evicted
                this.cache.delete(key);
                this.cache.add(key);
            }
            return entry;
        },
        set: function (obj: Cache<T>, key: string, value: T): boolean {
            obj[key] = value;
            if (this.cache.size >= maxEntries) {
                // least-recently used cache eviction strategy, the oldest
                // item is the first one in the list
                const keyToDelete = this.cache.keys().next().value;
                delete obj[key];
                this.cache.delete(keyToDelete);
            }
            return true;
        }
    };
    return new Proxy(result, handler);
}

