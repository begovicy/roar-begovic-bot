import fs from "node:fs";
export const moduleGroups = {
  manager: [
    "manager",
    "penalties",
    "booster",
    "community",
    "communityOps",
    "mecraManager",
    "requested-commands",
  ],
  statistics: ["statistics", "statExtras", "statDetails"],
  economy: ["economy", "economyExtras"],
  guard: ["guard", "guardExtras"],
};
export async function registry() {
  const all = [];
  for (const [role, modules] of Object.entries(moduleGroups)) {
    const c = JSON.parse(
      fs.readFileSync(new URL("../config.example.json", import.meta.url)),
    );
    c.guildId = "123456789012345678";
    c.owners = [];
    const commands = new Map(),
      handlers = [],
      entries = [];
    let origin;
    const ctx = {
      role,
      c,
      client: {},
      report() {},
      db: {
        command: async () => ({ setName: "mock" }),
        collection: () => ({ createIndex: async () => {} }),
      },
      tx: async () => {
        throw Error("Registration must not start a transaction");
      },
      lock: () => {
        throw Error("Registration must not execute user operations");
      },
      add(names, fn) {
        for (const name of names) {
          if (commands.has(name)) throw Error(role + " duplicate " + name);
          commands.set(name, fn);
        }
        entries.push({
          role,
          module: origin,
          name: names[0],
          aliases: names.slice(1),
          fn,
        });
      },
      replace(names, fn) {
        for (const name of names) {
          if (!commands.has(name)) throw Error("Unknown replacement " + name);
          commands.set(name, fn);
        }
      },
      alias(names, original) {
        const fn = commands.get(original);
        if (!fn) throw Error("Alias target missing");
        for (const n of names) {
          if (commands.has(n)) throw Error("Alias duplicate");
          commands.set(n, fn);
        }
        entries
          .find((e) => e.name === original || e.aliases.includes(original))
          .aliases.push(...names);
      },
      getCommand(name){return commands.get(name);},
      hasCommand: (n) => commands.has(n),
      event() {},
      every() {},
      onReady() {},
      onInteraction(
        fn,
        prefix = {
          manager: "m:",
          statistics: "s:",
          economy: "e:",
          guard: "g:",
        }[role],
      ) {
        if (handlers.some((x) => x.prefix === prefix))
          throw Error("Duplicate component namespace " + prefix);
        handlers.push({ prefix, fn });
      },
    };
    for (const name of modules) {
      origin = name;
      await (await import("../src/modules/" + name + ".mjs")).install(ctx);
    }
    all.push({ role, entries, commands, handlers, ctx });
  }
  return all;
}
