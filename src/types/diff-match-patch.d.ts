declare module 'diff-match-patch' {
  class DiffMatchPatch {
    diff_main(text1: string, text2: string): Array<[number, string]>;
    diff_cleanupSemantic(diffs: Array<[number, string]>): void;
  }
  export = DiffMatchPatch;
}
