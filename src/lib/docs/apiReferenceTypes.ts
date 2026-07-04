/**
 * Shared content-model types for the API reference family
 * (/docs/x402, /docs/rest, /docs/mcp) and their markdown twins.
 *
 * Types only, no runtime code: importable from server components,
 * data files, and the markdown builders alike. Extracted from the
 * original x402 data module when the reference family grew to three
 * pages (sourceRef: src/app/(marketing)/(api-reference)/docs/x402/
 * data/endpoints.ts, pre-extraction).
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ParamTableData {
  heading: string;
  rows: ParamRow[];
}

export interface CodeSample {
  label: string;
  code: string;
  /**
   * Marks the page's single signature "ink stamp" card (hard shadow +
   * ink border). Placement rule in docs/UI_DESIGN_SYSTEM.md: exactly
   * one featured sample per reference page.
   */
  featured?: boolean;
}

export interface CalloutData {
  tone: "amber" | "blue";
  text: string;
}

export interface EndpointOperation {
  /** Anchor id for deep links. Omitted when the section id already covers it. */
  id?: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  paramTables: ParamTableData[];
  codeSamples: CodeSample[];
  callouts?: CalloutData[];
  sourceRef: string;
}

export interface FlowStep {
  title: string;
  body: string;
}

export interface SectionTable {
  columns: string[];
  rows: string[][];
}

export interface DocsSection {
  id: string;
  navLabel: string;
  title: string;
  summary: string;
  callouts?: CalloutData[];
  flowSteps?: FlowStep[];
  flowCodeSamples?: CodeSample[];
  statusFlow?: { steps: string[]; terminal: string[] };
  table?: SectionTable;
  tableNote?: string;
  operations?: EndpointOperation[];
  codeSamples?: CodeSample[];
  sourceRef: string;
}

export interface SidebarItem {
  id: string;
  label: string;
}
