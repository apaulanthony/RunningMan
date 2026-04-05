/**
 * StorageService.js
 * Responsibility: Stores and retrieves data from local storage
 */
const version = __APP_VERSION__;

export class StorageService {
    init() {
        this.version = this.convertVersionToInt32(version);
    }

    /**
     * Convert a sematic versioning string into an 32-bit integer.
     * 
     * Make sure the input string is compatible with the standard found
     * at semver.org. Since this only uses 10-bit per major/minor/patch version,
     * the highest possible SemVer string would be 1023.1023.1023.
     * @param  {string} version SemVer string
     * @return {number}         Numeric version
     */
    convertVersionToInt32(version) {
        // Split a given version string into three parts.
        let parts = version.split('.');

        // Check if we got exactly three parts, otherwise throw an error.
        if (parts.length !== 3) {
            throw new Error('Received invalid version string');
        }

        // Make sure that no part is larger than 1023 or else it
        // won't fit into a 32-bit integer.
        parts.forEach((part) => {
            if (part >= 1024) {
                throw new Error(`Version string invalid, ${part} is too large`);
            }
        });

        // Let's create a new number which we will return later on
        let numericVersion = 0;

        // Shift all parts either 0, 10 or 20 bits to the left.
        for (let i = 0; i < 3; i++) {
            numericVersion |= parts[i] << i * 10;
        }

        return numericVersion;
    }

    /**
     * Open (or create) the IndexedDB database and object store for runs
     * 
     * @returns {Promise<IDBDatabase>}
     */
    async openDB() {
        return new Promise((resolve, reject) => {
            // Read application version number from package.json and convert a sematic versioning string into an 32-bit integer.		
            const request = indexedDB.open('RunningManDB', this.version);
            request.onerror = (event) => reject(event.target.error);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;

                const runsStore = db.objectStoreNames.contains('runs') ? transaction.objectStore('runs') : db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });

                if (!runsStore.indexNames.contains('date')) {
                    runsStore.createIndex('date', 'date', { unique: false });
                }
            };

            request.onsuccess = (event) => resolve(event.target.result);
        });
    }


    /**
     * Save a run to IndexedDB, returning a promise that resolves to the ID of the saved run
     * 
     * @param {object} run 
     * @returns 
     */
    async saveRun(run) {
        const db = await this.openDB();

        return new Promise(async (resolve, reject) => {
            db.onerror = (event) => reject(event.target.error);

            const request = db.transaction(['runs'], 'readwrite')
                .objectStore('runs')
                .put({ date: Date.now(), ...run });

            request.onsuccess = (event) => resolve(event.target.result);
        });
    }

    /**
     * Get a run by ID from IndexedDB
     * 
     * @param {BigInteger} id 
     * @returns {Promise<Run>} 
     */
    async getRun(id) {
        const db = await this.openDB();

        return new Promise(async (resolve, reject) => {
            db.onerror = (event) => reject(event.target.error);

            const request = db.transaction(['runs'], 'readonly')
                .objectStore('runs')
                .get(id)

            request.onsuccess = (event) => resolve(event.target.result);
        });
    }

    /**
     * Delete a run by ID from IndexedDB
     * 
     * @param {BigInteger} id 
     * @returns {Promise<void>} resolves when the operation is complete
     */
    async deleteRun(id) {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            db.onerror = (event) => reject(event.target.error);

            const request = db.transaction(['runs'], 'readwrite')
                .objectStore('runs')
                .delete(id);

            request.onsuccess = (event) => resolve(event.target.result);
        });
    }

    /**
     * Get all runs from IndexedDB, returning a promise that resolves to an array of run objects
     * 
     * @returns {Promise<array<Run>>} 
     */
    async getAllRuns() {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            db.onerror = (event) => reject(event.target.error);

            const request = db.transaction(['runs'])
                .objectStore('runs')
                .getAll();

            request.onsuccess = (event) => resolve(event.target.result);
        });
    }

    /**
     * Get all runs from IndexedDB, sorted by date
     * 
     * @param {boolean} decending
     * @returns {Promise<array<Run>>}
     */
    async getAllRunsByDate(decending) {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            db.onerror = (event) => reject(event.target.error);

            // Get all runs from the 'runs' object store using "date" index
            const request = db.transaction(['runs'])
                .objectStore('runs')
                .index('date')
                .getAll();

            request.onsuccess = (event) => {
                const runs = event.target.result;
                resolve(decending ? runs.reverse() : runs)
            };
        });
    }

    /**
     * Clear all runs from IndexedDB, returning a promise that resolves when the operation is complete
     * 
     * @returns {Promise<array<void>>} 
     */
    async deleteAllRuns() {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            db.onerror = (event) => reject(event.target.error);

            const request = db.transaction(['runs'], 'readwrite')
                .objectStore('runs')
                .clear();

            request.onsuccess = (event) => resolve(event.target.result);
        });
    }

    /**
     * @returns Promise containing an array of runs Ids that have been fixed (if any)
     */
    async fixData() {
        const runs = await this.getAllRuns();

        // Write corrections and series of map functions. If the correction is detected, then clone the
        // run object and make the changes to that, otherwise let the original drop through. Mark the
        // updated/replacement run objects with "fixed" property so that we can filter out those that
        // tha didn't need updating.

        // We can use an Iterator to walk through all items one at a time, applying all of the maps'
        // changes, in just one loop. Fallback to a normal array if Iterato isn't available, same
        // end-effect but each step would trigger its own array and loop making if much more inefficient.

        // Check if we have the modern Iterator Helpers (map, filter, etc.)
        const hasIteratorHelpers = self.Iterator?.from === "function"
            && typeof Iterator.prototype.map === 'function'
            && typeof Iterator.prototype.filter === 'function';

        const runsIterator = (hasIteratorHelpers
            ? Iterator.from(runs)  // Lazy & Efficient
            : runs  // Eager & Compatible
        ).map(run => {
            if (!run.route.route) return run;

            // Is there a spurious route within route? If so, collapse it to be the main object, 
            return {
                ...run,
                ...run.route,
                fixed: true
            }
        }).map(run => {
            if (typeof run.date.getTime === "function") return run;

            const update = { ...run, fixed: true };

            // Ensure the "date" is consistently a Date object as opposed to timestamp
            update.date = update.date && new Date(update.date);

            return update;
        }).map(run => {
            if (!run.finised) return run;

            const update = { ...run, fixed: true };

            // Correct stupid typo
            update.finished = update.finised;
            delete update.finised;

            return update;
        }).map(run => {
            const update = { ...run };
            let updated = 0;

            // Ensure with route, each coord's timestamp is consistently a Date object
            update.route?.forEach(coord => {
                if (typeof coord[3].getTime !== 'function') {
                    updated += 1;
                    coord[3] = new Date(coord[3]);
                }
            })

            if (updated) {
                update.fixed = true;
            }

            return update;
        }).filter(run => run.fixed)
            .map(run => {
                const update = { ...run };
                delete update.fixed;
                return update;
            });

        return Promise.all(runsIterator.map(update => this.saveRun(update)));
    }
}