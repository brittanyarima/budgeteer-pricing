/**
 * Monthly pricing refresh script for MagicBudget.
 *
 * Loads prices.json, asks Claude (with web_search) for updated price ranges
 * on each item, builds a diff, and writes the updated file + a PR body to
 * /tmp/pr_body.md so the GitHub Actions step can open a PR.
 *
 * IP guardrails: prompts explicitly forbid citing park-operator domains.
 * Items where Claude returns low confidence or conflicting sources go into a
 * "needs human research" bucket — they are NOT auto-updated.
 *
 * Safety cap: if cumulative API cost exceeds COST_CAP_USD ($5 default) the
 * script throws, causing the workflow to fail and notify via GitHub.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types mirroring the iOS PricingData schema
// ---------------------------------------------------------------------------

interface PricingItem {
  id: string;
  name: string;
  category: string;
  icon: string;
  location: string;
  tier?: string;
  minPrice: number;
  maxPrice: number;
  averagePrice: number;
  notes?: string;
  lastVerified: string;
}

interface PricingData {
  version: string;
  lastUpdated: string;
  source: string;
  items: PricingItem[];
}

interface RefreshResult {
  minPrice: number;
  maxPrice: number;
  averagePrice: number;
  sourceURL: string;
  confidence: "high" | "medium" | "low";
  notes: string;
}

interface DiffRow {
  name: string;
  oldMin: number;
  oldMax: number;
  newMin: number;
  newMax: number;
  sourceURL: string;
  confidence: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PRICES_PATH = path.resolve(__dirname, "../prices.json");
const PR_BODY_PATH = "/tmp/pr_body.md";
const DRIFT_THRESHOLD = 0.05; // 5% change required to include in PR
const COST_CAP_USD = parseFloat(process.env.COST_CAP_USD ?? "5.00");

// Sonnet 4.6 pricing (per million tokens, as of 2025)
const INPUT_COST_PER_MTK = 3.0;
const OUTPUT_COST_PER_MTK = 15.0;

const FORBIDDEN_DOMAINS = [
  "disney.com",
  "disneyland.com",
  "disneyworld.com",
  "disneyparks.com",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function bumpVersion(): string {
  return today().replace(/-/g, ".");
}

function drift(oldVal: number, newVal: number): number {
  if (oldVal === 0) return newVal > 0 ? 1 : 0;
  return Math.abs(newVal - oldVal) / oldVal;
}

function hasForbiddenDomain(url: string): boolean {
  return FORBIDDEN_DOMAINS.some((d) => url.includes(d));
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTK +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTK
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const raw = fs.readFileSync(PRICES_PATH, "utf8");
  const data: PricingData = JSON.parse(raw);

  const client = new Anthropic({ apiKey });

  let totalCost = 0;
  const updated: PricingItem[] = [];
  const diffs: DiffRow[] = [];
  const needsHumanResearch: string[] = [];

  for (const item of data.items) {
    if (totalCost >= COST_CAP_USD) {
      throw new Error(
        `API cost cap of $${COST_CAP_USD} reached after ${updated.length} items. ` +
          `Remaining items were not refreshed.`
      );
    }

    console.log(`Researching: ${item.name}…`);

    const prompt = `Research the current price range for "${item.name}" at Walt Disney World \
and Disneyland as of ${today()}. Use public third-party aggregator sources \
like MouseSavers, AllEars, DisneyFoodBlog, WDWMagic. \
Do NOT cite disney.com, disneyland.com, disneyworld.com, or any other park-operator domain directly.

You MUST find at least 2 independent sources. If you cannot find 2 independent sources, \
set confidence to "low".

Return ONLY a JSON object (no markdown, no explanation):
{
  "minPrice": number,
  "maxPrice": number,
  "averagePrice": number,
  "sourceURL": string,
  "confidence": "high" | "medium" | "low",
  "notes": string
}`;

    let result: RefreshResult | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        tools: [{ type: "web_search_20250305", name: "web_search" } as any],
        messages: [{ role: "user", content: prompt }],
      });

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      totalCost += estimateCost(inputTokens, outputTokens);

      // Extract the text block containing the JSON response
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        console.warn(`  No text response for "${item.name}", skipping.`);
        needsHumanResearch.push(`${item.name} — no text response from Claude`);
        updated.push(item);
        continue;
      }

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`  Could not parse JSON for "${item.name}", skipping.`);
        needsHumanResearch.push(
          `${item.name} — could not parse JSON from response`
        );
        updated.push(item);
        continue;
      }

      result = JSON.parse(jsonMatch[0]) as RefreshResult;
    } catch (err) {
      console.warn(`  API error for "${item.name}": ${err}, skipping.`);
      needsHumanResearch.push(`${item.name} — API error: ${err}`);
      updated.push(item);
      continue;
    }

    // IP guardrail check
    if (hasForbiddenDomain(result.sourceURL)) {
      console.warn(
        `  Forbidden domain in sourceURL for "${item.name}", skipping.`
      );
      needsHumanResearch.push(
        `${item.name} — source URL points to a park-operator domain (${result.sourceURL})`
      );
      updated.push(item);
      continue;
    }

    // Confidence check
    if (result.confidence === "low") {
      console.warn(
        `  Low confidence for "${item.name}", routing to human review.`
      );
      needsHumanResearch.push(
        `${item.name} — low confidence (${result.sourceURL})`
      );
      updated.push(item);
      continue;
    }

    // Drift check — only update if price moved >5%
    const avgDrift = drift(item.averagePrice, result.averagePrice);
    if (avgDrift < DRIFT_THRESHOLD) {
      console.log(
        `  Price unchanged (${(avgDrift * 100).toFixed(1)}% drift < 5%), skipping.`
      );
      updated.push({ ...item, lastVerified: new Date().toISOString() });
      continue;
    }

    console.log(
      `  Updated: $${item.minPrice}–$${item.maxPrice} → $${result.minPrice}–$${result.maxPrice} ` +
        `(confidence: ${result.confidence})`
    );

    diffs.push({
      name: item.name,
      oldMin: item.minPrice,
      oldMax: item.maxPrice,
      newMin: result.minPrice,
      newMax: result.maxPrice,
      sourceURL: result.sourceURL,
      confidence: result.confidence,
    });

    updated.push({
      ...item,
      minPrice: result.minPrice,
      maxPrice: result.maxPrice,
      averagePrice: result.averagePrice,
      notes: result.notes || item.notes,
      lastVerified: new Date().toISOString(),
    });
  }

  // Write updated prices.json
  const updatedData: PricingData = {
    ...data,
    version: bumpVersion(),
    lastUpdated: new Date().toISOString(),
    items: updated,
  };
  fs.writeFileSync(PRICES_PATH, JSON.stringify(updatedData, null, 2), "utf8");
  console.log(`\nWrote updated prices.json (version ${updatedData.version})`);
  console.log(
    `Total estimated API cost: $${totalCost.toFixed(3)} / $${COST_CAP_USD} cap`
  );

  // Write PR body
  const prBody = buildPRBody(diffs, needsHumanResearch, totalCost);
  fs.writeFileSync(PR_BODY_PATH, prBody, "utf8");
  console.log(`Wrote PR body to ${PR_BODY_PATH}`);
}

// ---------------------------------------------------------------------------
// PR body builder
// ---------------------------------------------------------------------------

function buildPRBody(
  diffs: DiffRow[],
  needsReview: string[],
  cost: number
): string {
  const date = today();
  let body = `## Automated Pricing Refresh — ${date}\n\n`;
  body += `> Estimated API cost: **$${cost.toFixed(3)}** · `;
  body += `Model: claude-sonnet-4-6 · Sources: third-party aggregators only\n\n`;

  if (diffs.length === 0) {
    body += `**No prices drifted >5% from the previous values.** `;
    body += `All \`lastVerified\` timestamps were updated.\n`;
  } else {
    body += `### Price Changes (>${Math.round(
      5
    )}% drift, ${diffs.length} items)\n\n`;
    body += `| Item | Old Range | New Range | Confidence | Source |\n`;
    body += `|------|-----------|-----------|------------|--------|\n`;
    for (const d of diffs) {
      const oldRange = `$${d.oldMin}–$${d.oldMax}`;
      const newRange = `$${d.newMin}–$${d.newMax}`;
      const domain = new URL(d.sourceURL).hostname;
      body += `| ${d.name} | ${oldRange} | ${newRange} | ${d.confidence} | [${domain}](${d.sourceURL}) |\n`;
    }
  }

  if (needsReview.length > 0) {
    body += `\n### ⚠️ Needs Human Research (${needsReview.length} items)\n\n`;
    body += `These items were skipped due to low confidence, API errors, or IP guardrail violations. `;
    body += `Please research and update them manually before merging.\n\n`;
    for (const r of needsReview) {
      body += `- ${r}\n`;
    }
  }

  body += `\n---\n_Auto-generated by [monthly-refresh workflow](/.github/workflows/monthly-refresh.yml). `;
  body += `Never commits directly to main — always opens a PR for human review._\n`;

  return body;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
