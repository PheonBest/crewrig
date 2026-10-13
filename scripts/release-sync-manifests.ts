// release-sync-manifests.ts — rewrite the version of package.json and extension.json of the current directory (spec 0257). It has no shell predecessor: it replaces the `jq` calls of the engine's prepare command
// (spec 0257 Decision D2).
//
// Usage: node scripts/release-sync-manifests.ts <version>
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs Node.js 24 or later.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/build-extension.ts, do not "tidy" it into an
// ordinary module: no top-level `import`/`export` (Node.js loads the file as CommonJS and prints no
// MODULE_TYPELESS_PACKAGE_JSON warning), the first statement removes the `warning` listeners, no
// `uncaughtException` handler, and `process.exitCode` rather than `process.exit` so that standard output drains.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/packaging/sync-manifests-main.ts");
    process.exitCode = await main({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      io: {
        out: (line: string) => void process.stdout.write(`${line}\n`),
        err: (line: string) => void process.stderr.write(`${line}\n`),
        errRaw: (text: string) => void process.stderr.write(text),
      },
    });
  } catch (error) {
    // A path inside the message may hold a control character: show it as `\xNN`.
    const text = error instanceof Error ? error.message : String(error);
    const shown = Array.from(text, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
    }).join("");
    process.stderr.write(`Error: ${shown}\n`);
    process.exitCode = 1;
  }
})();
