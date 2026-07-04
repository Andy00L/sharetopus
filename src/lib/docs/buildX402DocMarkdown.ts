import "server-only";

import {
  DOCS_SECTIONS,
  OVERVIEW,
  type CalloutData,
  type DocsSection,
  type EndpointOperation,
  type ParamTableData,
} from "@/app/(marketing)/(x402-reference)/docs/x402/data/endpoints";
import { fetchX402Pricing } from "@/app/(marketing)/(x402-reference)/docs/x402/data/pricing";
import {
  SITE_ORIGIN,
  renderFencedCode,
  renderMarkdownTable,
} from "./markdownPrimitives";

/**
 * Renders the public /docs/x402 reference as plain markdown for AI agents.
 *
 * Reuses the same content model as the HTML page (data/endpoints.ts) and
 * the same live pricing read (data/pricing.ts), so the two surfaces cannot
 * drift apart. Served at /docs/x402.md via /api/docs/[slug].
 */

function renderCallout(callout: CalloutData): string {
  const label = callout.tone === "amber" ? "Warning" : "Note";
  return `> **${label}:** ${callout.text}`;
}

function renderParamTable(paramTable: ParamTableData): string {
  return [
    `#### ${paramTable.heading}`,
    "",
    renderMarkdownTable(
      ["Name", "Type", "Required", "Description"],
      paramTable.rows.map((paramRow) => [
        `\`${paramRow.name}\``,
        paramRow.type,
        paramRow.required ? "yes" : "no",
        paramRow.description,
      ]),
    ),
  ].join("\n");
}

function renderOperation(operation: EndpointOperation): string {
  const parts: string[] = [
    `### ${operation.method} ${operation.path}: ${operation.title}`,
    "",
    operation.description,
  ];
  for (const paramTable of operation.paramTables) {
    parts.push("", renderParamTable(paramTable));
  }
  for (const callout of operation.callouts ?? []) {
    parts.push("", renderCallout(callout));
  }
  for (const codeSample of operation.codeSamples) {
    parts.push("", renderFencedCode(codeSample.code, codeSample.label));
  }
  return parts.join("\n");
}

function renderSection(section: DocsSection, pricingMarkdown: string): string {
  const parts: string[] = [`## ${section.title}`, "", section.summary];
  for (const callout of section.callouts ?? []) {
    parts.push("", renderCallout(callout));
  }
  if (section.flowSteps) {
    parts.push("");
    section.flowSteps.forEach((flowStep, stepIndex) => {
      parts.push(`${stepIndex + 1}. **${flowStep.title}** ${flowStep.body}`);
    });
  }
  for (const codeSample of section.flowCodeSamples ?? []) {
    parts.push("", renderFencedCode(codeSample.code, codeSample.label));
  }
  if (section.statusFlow) {
    const orderedSteps = section.statusFlow.steps.join(" -> ");
    const terminalStates = section.statusFlow.terminal.join(", ");
    parts.push(
      "",
      `Status flow: ${orderedSteps}. Terminal states: ${terminalStates}.`,
    );
  }
  if (section.table) {
    parts.push(
      "",
      renderMarkdownTable(section.table.columns, section.table.rows),
    );
  }
  if (section.tableNote) {
    parts.push("", section.tableNote);
  }
  if (section.id === "pricing") {
    parts.push("", pricingMarkdown);
  }
  for (const operation of section.operations ?? []) {
    parts.push("", renderOperation(operation));
  }
  for (const codeSample of section.codeSamples ?? []) {
    parts.push("", renderFencedCode(codeSample.code, codeSample.label));
  }
  return parts.join("\n");
}

/**
 * Reads the live pricing rows and renders them as a table. On a read
 * failure the doc still ships, with the same fallback the HTML page
 * uses: the 402 response is the authoritative price quote.
 */
async function renderPricingMarkdown(): Promise<string> {
  const pricing = await fetchX402Pricing();
  if (!pricing.ok) {
    return "Live pricing is temporarily unavailable. Call any paid endpoint without a payment and read the current price from the 402 response.";
  }
  return renderMarkdownTable(
    ["Action", "Price (USDC)", "Recurrence", "Description"],
    pricing.rows.map((pricingRow) => [
      `\`${pricingRow.action}\``,
      String(pricingRow.usdcPrice),
      pricingRow.recurrence,
      pricingRow.description ?? "",
    ]),
  );
}

export async function buildX402DocMarkdown(): Promise<string> {
  const pricingMarkdown = await renderPricingMarkdown();
  const headerParts = [
    `# ${OVERVIEW.title}`,
    "",
    `> ${OVERVIEW.subtitle}`,
    "",
    `Base URL: \`${OVERVIEW.baseUrl}\``,
    "",
    `Networks: ${OVERVIEW.networks.join(", ")}.`,
    "",
    renderCallout({ tone: "amber", text: OVERVIEW.callout }),
    "",
    `The human-readable version of this reference is ${SITE_ORIGIN}/docs/x402. The site index for agents is ${SITE_ORIGIN}/llms.txt.`,
  ];
  const sectionParts = DOCS_SECTIONS.map((section) =>
    renderSection(section, pricingMarkdown),
  );
  return `${[...headerParts, "", sectionParts.join("\n\n")].join("\n")}\n`;
}
