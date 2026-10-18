// releaserc-types.ts — input and output shapes of the engine configuration.

export interface ReleasercInput {
  forge: "github" | "gitlab";
  mode: "publish" | "rehearsal" | "prepare";
  ext: string;
  root: string;
  out: string;
  branch: string;
  /** The directory holding `release-notes/` (the facades and the `.hbs` files). */
  libDir: string;
  env: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
}

export interface GitmojiOptions {
  releaseRules: { major: string[]; minor: string[]; patch: string[] };
  releaseNotes?: {
    template: string;
    partials: { commitTemplate: string };
    issueResolution: { template: string };
  };
}

export type PluginEntry = string | [string, object];

export interface Releaserc {
  extends: string;
  branches: string[];
  tagFormat: string;
  plugins: PluginEntry[];
  repositoryUrl?: string;
}
