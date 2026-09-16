import { makeLock } from "../src/core/util.mjs";
export function memoryDB() {
  let data = {},
    seq = 0;
  const lock = makeLock();
  const match = (d, q) =>
    Object.entries(q).every(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
        ? Object.entries(v).every(([op, x]) =>
            op === "$gte"
              ? d[k] >= x
              : op === "$lte"
                ? d[k] <= x
                : op === "$gt"
                  ? d[k] > x
                  : op === "$lt"
                    ? d[k] < x
                    : op === "$in"
                      ? x.includes(d[k])
                      : false,
          )
        : d[k] === v,
    );
  const list = (n) => data[n] || (data[n] = []);
  const update = (d, u, insert) => {
    if (insert) Object.assign(d, structuredClone(u.$setOnInsert || {}));
    Object.assign(d, structuredClone(u.$set || {}));
    for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
  };
  const db = {
    command: async () => ({ setName: "test" }),
    collection: (n) => ({
      createIndex: async () => {},
      findOne: async (q) =>
        structuredClone(list(n).find((d) => match(d, q)) || null),
      insertOne: async (d) => {
        const doc = structuredClone(d);
        doc._id ??= "id" + ++seq;
        if (list(n).some((x) => x._id === doc._id)) {
          const e = Error("Duplicate");
          e.code = 11000;
          throw e;
        }
        list(n).push(doc);
        return { insertedId: doc._id };
      },
      updateOne: async (q, u, o = {}) => {
        let d = list(n).find((d) => match(d, q)),
          insert = false;
        if (!d && o.upsert) {
          d = { ...q, _id: q._id || "id" + ++seq };
          list(n).push(d);
          insert = true;
        }
        if (d) update(d, u, insert);
        return { matchedCount: d ? 1 : 0 };
      },
      findOneAndUpdate: async (q, u) => {
        const d = list(n).find((d) => match(d, q));
        if (!d) return null;
        update(d, u, false);
        return structuredClone(d);
      },
    }),
  };
  return {
    db,
    dump: () => structuredClone(data),
    tx: (fn) =>
      lock("tx", async () => {
        const snapshot = structuredClone(data);
        try {
          return await fn({ mock: true });
        } catch (e) {
          data = snapshot;
          throw e;
        }
      }),
  };
}
