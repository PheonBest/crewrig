// expand.ts — TypeScript twin of tests/e2e/lib/expand.sh (spec 0261 R1): the mount-string token
// expander. Twin of the shell library: change both, and keep them equal.

export interface ExpandResult {
  readonly rc: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `expand_mount`: replace every `${CREWRIG_E2E_HOME}` by `bundleHome`, then every `${HOME}` by
 * `home` — in that order, so a bundle home that itself contains `${HOME}` is expanded by the
 * second pass, as the shell does. An empty or missing bundle home is the shell's `:?` abort
 * (rc 127; the `file: line N:` prefix of bash is added by the caller that knows the shell file).
 */
export function expandMount(raw: string, bundleHome: string, home: string): ExpandResult {
  if (bundleHome === "") {
    return {
      rc: 127,
      stdout: "",
      stderr:
        "E2E_CREWRIG_E2E_HOME: expand_mount: E2E_CREWRIG_E2E_HOME must be exported by the caller\n",
    };
  }
  const expanded = raw.split("${CREWRIG_E2E_HOME}").join(bundleHome).split("${HOME}").join(home);
  return { rc: 0, stdout: `${expanded}\n`, stderr: "" };
}
