// In-memory MongoDB bypass - Atlas bağlanamadığında kullanılır
export function memoryDB() {
  const collections = new Map();

  function getCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  return {
    client: null, // No actual MongoDB client
    db: {
      async command(cmd) {
        // Mock MongoDB command - Atlas gibi davran
        if (cmd.hello === 1) {
          return { msg: "isdbgrid" }; // Atlas cluster simülasyonu
        }
        return {};
      },
      collection(name) {
        const coll = getCollection(name);
        return {
          async findOne(filter, opts = {}) {
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) return { ...doc };
            }
            return null;
          },
          find(filter = {}) {
            const results = [];
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) results.push({ ...doc });
            }
            // Chainable query builder
            const query = {
              _results: results,
              async toArray() {
                return query._results;
              },
              sort(sortSpec) {
                // Basit sort implementasyonu - sadece chain için
                return query;
              },
              limit(n) {
                query._results = query._results.slice(0, n);
                return query;
              },
            };
            return query;
          },
          async insertOne(doc) {
            const id = doc._id || generateId();
            coll.set(id, { ...doc, _id: id });
            return { insertedId: id };
          },
          async updateOne(filter, update, opts = {}) {
            let matched = false;
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) {
                matched = true;
                applyUpdate(doc, update);
                coll.set(id, doc);
                return { matchedCount: 1, modifiedCount: 1 };
              }
            }
            if (opts.upsert) {
              const newDoc = { ...extractFilterFields(filter) };
              applyUpdate(newDoc, update);
              const id = newDoc._id || generateId();
              newDoc._id = id;
              coll.set(id, newDoc);
              return { matchedCount: 0, modifiedCount: 0, upsertedId: id };
            }
            return { matchedCount: 0, modifiedCount: 0 };
          },
          async findOneAndUpdate(filter, update, opts = {}) {
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) {
                const oldDoc = { ...doc };
                applyUpdate(doc, update);
                coll.set(id, doc);
                return { value: oldDoc };
              }
            }
            if (opts.upsert) {
              const newDoc = { ...extractFilterFields(filter) };
              applyUpdate(newDoc, update);
              const id = newDoc._id || generateId();
              newDoc._id = id;
              coll.set(id, newDoc);
              return { value: null };
            }
            return { value: null };
          },
          async updateMany(filter, update, opts = {}) {
            let matched = 0, modified = 0;
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) {
                matched++;
                applyUpdate(doc, update);
                coll.set(id, doc);
                modified++;
              }
            }
            return { matchedCount: matched, modifiedCount: modified };
          },
          async deleteOne(filter) {
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) {
                coll.delete(id);
                return { deletedCount: 1 };
              }
            }
            return { deletedCount: 0 };
          },
          async findOneAndDelete(filter) {
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) {
                coll.delete(id);
                return { value: { ...doc } };
              }
            }
            return { value: null };
          },
          async deleteMany(filter) {
            let count = 0;
            const toDelete = [];
            for (const [id, doc] of coll) {
              if (matchesFilter(doc, filter)) {
                toDelete.push(id);
                count++;
              }
            }
            toDelete.forEach((id) => coll.delete(id));
            return { deletedCount: count };
          },
          async createIndex() {
            return "memory-index";
          },
        };
      },
      async command(cmd) {
        if (cmd?.hello === 1) return { msg: "isdbgrid" };
        return {};
      },
    },
    tx: async (fn) => {
      // No real transaction support, just execute the function
      return await fn(null);
    },
  };
}

function matchesFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, value] of Object.entries(filter)) {
    if (key === "$or") {
      if (!value.some((subFilter) => matchesFilter(doc, subFilter)))
        return false;
    } else if (key === "$and") {
      if (!value.every((subFilter) => matchesFilter(doc, subFilter)))
        return false;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
      // Operators like $lt, $gt, $gte, $lte, $ne
      for (const [op, opValue] of Object.entries(value)) {
        const docValue = doc[key];
        if (op === "$lt" && !(docValue < opValue)) return false;
        if (op === "$lte" && !(docValue <= opValue)) return false;
        if (op === "$gt" && !(docValue > opValue)) return false;
        if (op === "$gte" && !(docValue >= opValue)) return false;
        if (op === "$ne" && docValue === opValue) return false;
        if (op === "$in" && !opValue.includes(docValue)) return false;
        if (op === "$nin" && opValue.includes(docValue)) return false;
      }
    } else {
      if (doc[key] !== value) return false;
    }
  }
  return true;
}

function applyUpdate(doc, update) {
  if (update.$set) {
    Object.assign(doc, update.$set);
  }
  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) {
      doc[key] = (doc[key] || 0) + value;
    }
  }
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push)) {
      if (!Array.isArray(doc[key])) doc[key] = [];
      doc[key].push(value);
    }
  }
  if (update.$pull) {
    for (const [key, value] of Object.entries(update.$pull)) {
      if (Array.isArray(doc[key])) {
        doc[key] = doc[key].filter((item) => item !== value);
      }
    }
  }
}

function extractFilterFields(filter) {
  const fields = {};
  for (const [key, value] of Object.entries(filter)) {
    if (!key.startsWith("$") && typeof value !== "object") {
      fields[key] = value;
    }
  }
  return fields;
}

function generateId() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}
