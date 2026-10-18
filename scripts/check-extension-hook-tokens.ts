// check-extension-hook-tokens.ts — asserts that no neutral `${extensionRoot}` token survives in
// any emitted hook file, for every discovered extension and every target (spec 0179 R12).
//
// Usage: node scripts/check-extension-hook-tokens.ts
// Renders a fresh `--target all` for each extension, scans the four emitted hook files, then
// removes `extensions/*/*/dist-*-plugin`.
// Exit: 0 clean, 1 when any file still carries the token.
// Finding line: `  FAIL <path> — surviving neutral token occurrence <i>/<N> ('${extensionRoot}')`.
//
// ENTRY FORM: no top-level import/export (CommonJS load, no MODULE_TYPELESS warning), like
// scripts/build-extension.ts.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { checkHookTokens } = await import("./lib/governance/hook-tokens.ts");
    process.exitCode = await checkHookTokens({
      argv: process.argv.slice(2),
      env: process.env,
      platform: process.platform,
      entryFile: __filename,
      io: {
        out: (line: string) => void process.stdout.write(`${line}\n`),
        err: (line: string) => void process.stderr.write(`${line}\n`),
        errRaw: (text: string) => void process.stderr.write(text),
      },
    });
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
