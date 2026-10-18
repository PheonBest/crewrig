// plugins.ts — the synthetic plugins the Copilot arm installs through --plugin-dir. File bytes
// match the shell heredocs of the retired probe-extension-hooks.sh exactly.

import fs from "node:fs";
import path from "node:path";

/** write_probe_plugin <dir> <name> <hook-file-relative-path> <marker> */
export function writeProbePlugin(
  dir: string,
  name: string,
  relpath: string,
  marker: string,
  log: string,
): void {
  fs.mkdirSync(path.dirname(path.join(dir, relpath)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    `{"name":"${name}","version":"0.0.1","description":"crewrig extension-hook probe: ${marker}"}\n`,
  );
  fs.writeFileSync(
    path.join(dir, relpath),
    [
      "{",
      '  "version": 1,',
      '  "disableAllHooks": false,',
      '  "hooks": {',
      '    "preToolUse": [',
      `      {"type": "command", "matcher": ".*", "command": "echo ${marker} >> ${log}"}`,
      "    ]",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
}

export function writeRootTokenPlugin(dir: string, log: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    '{"name":"crewrig-probe-root-token","version":"0.0.1","description":"probe root token"}\n',
  );
  const cmd = `echo \\"CWD=$(pwd) ROOT=\${COPILOT_PLUGIN_ROOT:-unset}\\" >> ${log}`;
  fs.writeFileSync(
    path.join(dir, "hooks.json"),
    `{"version":1,"disableAllHooks":false,"hooks":{"preToolUse":[{"type":"command","matcher":".*","command":"${cmd}"}]}}\n`,
  );
}

export function writeMatcherPlugin(dir: string, log: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    '{"name":"crewrig-probe-matcher","version":"0.0.1","description":"probe matcher form"}\n',
  );
  fs.writeFileSync(
    path.join(dir, "hooks.json"),
    [
      '{"version":1,"disableAllHooks":false,"hooks":{"preToolUse":[',
      `  {"type":"command","matcher":"no-such-tool-xyz","command":"echo MARKER_NOMATCH >> ${log}"},`,
      `  {"type":"command","matcher":"bash","command":"echo MARKER_BASH >> ${log}"}`,
      "]}}",
      "",
    ].join("\n"),
  );
}
