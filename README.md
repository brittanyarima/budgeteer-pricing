# budgeteer-pricing

Public pricing data for the [MagicBudget](https://github.com/brittanyarima/Budgeteer) iOS app. The app fetches `prices.json` from GitHub Pages once per week so prices can be updated without shipping a new app release.

- **Live URL:** https://brittanyarima.github.io/budgeteer-pricing/prices.json
- **Update cadence:** manual, roughly monthly (see below)
- **Schema:** see `prices.json` — matches the iOS `PricingData` model

## How to refresh prices (manual, ~10 min/month)

1. Open [claude.ai](https://claude.ai/) in a browser
2. Start a new chat and paste the full prompt from [`MANUAL_REFRESH.md`](./MANUAL_REFRESH.md)
3. Claude will research current prices with web search and return an updated `prices.json`
4. Save Claude's response over this repo's `prices.json`
5. Bump the `version` and `lastUpdated` fields at the top (format: `YYYY.MM.DD`)
6. Commit and push to `main` — the app will pick up the new prices within 7 days

See [`MANUAL_REFRESH.md`](./MANUAL_REFRESH.md) for the full prompt and review checklist.

## Future automation

See [this tracking issue](https://github.com/brittanyarima/Budgeteer/issues) for the plan to automate this via GitHub Actions + Anthropic API.
