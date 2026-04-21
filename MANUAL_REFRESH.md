# Manual Pricing Refresh

Paste the prompt below into [claude.ai](https://claude.ai/) once a month. Claude has web search built in, so this is free — no API key, no billing.

---

## The prompt

Copy everything between the `---BEGIN---` and `---END---` markers, replacing `{{PASTE prices.json HERE}}` with the current contents of this repo's `prices.json`.

```
---BEGIN---
You are helping me refresh a pricing JSON file for a Disney Parks budgeting
iOS app called MagicBudget. Current date: {{ today's date, e.g. 2026-05-01 }}.

Below is the current prices.json. For EACH item, use web search to find the
current price range at Walt Disney World and Disneyland.

RULES:
1. Use ONLY third-party aggregator sources: MouseSavers, AllEars,
   DisneyFoodBlog, WDWMagic, TouringPlans, DisneyTouristBlog.
2. NEVER cite disney.com, disneyland.com, disneyworld.com, or any
   park-operator domain directly — IP guardrail.
3. Require at least 2 independent sources per item. If you can't find 2
   sources, leave that item UNCHANGED and add it to a "needs human research"
   list at the end.
4. Only update an item if the new price drifts more than 5% from the
   current averagePrice. For items with <5% drift, keep prices unchanged
   but update lastVerified to today's date.
5. Update lastVerified to today's ISO date for every item you successfully
   researched (whether the price changed or not).
6. Bump the top-level `version` to today's date in YYYY.MM.DD format.
7. Bump the top-level `lastUpdated` to today's ISO timestamp.
8. Keep the schema IDENTICAL — same fields, same order, same id values.
   Do not add, remove, rename, or reorder any fields.

OUTPUT FORMAT:
1. First, a markdown table of items that changed (old range → new range,
   source URL, confidence).
2. Then a "⚠️ Needs human research" list of items you couldn't verify.
3. Finally, the FULL updated prices.json inside a ```json code block,
   ready to paste over the existing file.

Current prices.json:

{{PASTE prices.json HERE}}
---END---
```

## Review checklist

Before committing Claude's updated JSON:

- [ ] Spot-check 3 items in the "changed" table — click the source URL and confirm the price matches
- [ ] Verify no `disney.com` / `disneyland.com` / `disneyworld.com` URLs in any `sourceURL`
- [ ] Manually research any items in the "needs human research" list (or leave unchanged and try again next month)
- [ ] Confirm the top-level `version` is today's date in `YYYY.MM.DD` format
- [ ] Confirm `lastUpdated` is today's ISO timestamp
- [ ] Confirm item count is unchanged (Claude shouldn't add or remove items)

## Commit + publish

```bash
git add prices.json
git commit -m "chore: monthly pricing refresh YYYY-MM-DD"
git push
```

Within ~1 minute GitHub Pages republishes. Within 7 days all MagicBudget users see the new prices (the iOS app auto-fetches on a 7-day cache window).

## If you want to force an immediate update

Users who pull-to-refresh on the Add Expense screen will fetch the new prices immediately.
