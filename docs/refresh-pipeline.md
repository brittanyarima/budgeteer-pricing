# Pricing Refresh Pipeline

## How it works

On the 1st of each month at noon UTC, a GitHub Actions workflow runs `scripts/refresh.ts`. The script:

1. Loads `prices.json`
2. For each item, calls Claude (Sonnet 4.6 with `web_search`) to research the current price range from third-party aggregators (AllEars, MouseSavers, DisneyFoodBlog, WDWMagic)
3. Items with >5% drift from the current JSON are updated; all others have `lastVerified` bumped
4. Items where Claude returns `low` confidence or only park-operator sources go into a "needs human research" bucket — they are **never** auto-updated
5. The bumped `prices.json` is committed to a new branch, and a PR is opened with a table of changes + the needs-human-research list

## IP guardrails

- The prompt explicitly forbids citing `disney.com`, `disneyland.com`, `disneyworld.com`, or any park-operator domain
- Every updated price carries a `sourceURL` pointing to the third-party aggregator used
- The script validates source URLs before accepting results; any forbidden domain triggers the needs-human-research bucket
- Low-confidence items never auto-merge

## Running manually

1. Ensure `ANTHROPIC_API_KEY` is set in your environment
2. `cd scripts && npm ci && npx ts-node refresh.ts`
3. Review the diff in `prices.json` and the PR body written to `/tmp/pr_body.md`

## Reviewing a PR

1. Open the PR auto-assigned to you
2. Check the per-item table: old price → new price, source URL, confidence
3. Click a few source URLs to spot-check that the listed prices match
4. Check the "⚠️ Needs Human Research" section; update those items manually if needed
5. Merge when satisfied — the MagicBudget app picks up the new prices within 7 days via the remote fetch

## Cost estimate

- ~45 items × ~$0.03/call = ~$1.35/month
- Safety cap enforced at $5/run (set via `COST_CAP_USD` env var)
- If the cap is hit the workflow fails loudly via GitHub notification
