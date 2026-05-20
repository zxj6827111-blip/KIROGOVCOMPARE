# P3-1 Post-Merge Health Check

Date: 2026-05-20
Branch: `main`
Baseline: `origin/main`

## Git Baseline

- `git fetch origin`: passed
- `git checkout main`: passed
- `git pull --ff-only origin main`: passed, already up to date
- `git status --short`: clean before checks
- Latest commit: `441439e Merge pull request #102 from zxj6827111-blip/codex/p3-appshell-navigation`
- P3-1 merge commit is present on `main`.
- No P3-1 leftover uncommitted files were found.
- `frontend/src/components/ComparisonHistory.js` had transient EOL/index noise before refresh, but no content diff existed and the final status was clean.

## Verification

- `npm.cmd run build`: passed
- `npm.cmd test`: passed, 19 suites / 144 tests
- `cd frontend && npm test -- --runInBand`: passed, 15 suites / 76 tests
- `cd frontend && npm.cmd run build`: passed
- `npm.cmd run smoke:pdf`: passed, 4/4 checks
- `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001`: passed, 4/4 checks

## Notes

- PDF smoke used `pdfjs-dist` text/page inspection.
- Pixel-level rendering checks were downgraded because `pdfinfo`, `pdftoppm`, ImageMagick, and Ghostscript were not all available locally.
- Strict live checks confirmed:
  - comparison PDF baseline paths passed for `4670` and `1143`;
  - GovInsight report PDF passed for `city_721/2025`;
  - `/api/pdf-jobs` create, completion, download, failed-job, missing-file, and batch ZIP checks passed.

## Conclusion

P3-1 is merged into `main` and the post-merge baseline is healthy. No regression was found in build, tests, frontend build, or PDF smoke checks.
