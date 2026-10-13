// failure.ts — a release step that failed at run time (as opposed to a ReleaseRefusal, which is a
// refused precondition). The entry prints `Error: <message>` on standard error and exits with `status`.

export class ReleaseFailure extends Error {
  readonly status = 1;
}
