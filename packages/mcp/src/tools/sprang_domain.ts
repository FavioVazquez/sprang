import type { GraphLoader } from '../graph-loader.js';
import type { Domain } from '@sprang/core';

export interface SprangDomainInput {
  domain_name?: string;
}

export interface DomainSummary {
  id: string;
  label: string;
  summary?: string;
  flow_count: number;
  entity_count: number;
}

export interface SprangDomainListResult {
  domains: DomainSummary[];
  total: number;
}

export interface SprangDomainDetailResult {
  domain: Domain;
}

export async function sprangDomain(
  loader: GraphLoader,
  input: SprangDomainInput
): Promise<SprangDomainDetailResult | SprangDomainListResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  if (input.domain_name) {
    const lowerName = input.domain_name.toLowerCase();
    const domain = graph.domains.find(
      (d) =>
        d.label.toLowerCase() === lowerName ||
        d.id.toLowerCase() === lowerName ||
        d.label.toLowerCase().includes(lowerName)
    );

    if (!domain) {
      return {
        error: `Domain '${input.domain_name}' not found`,
        code: 'DOMAIN_NOT_FOUND',
      };
    }

    return { domain };
  }

  // Return list of all domains
  const summaries: DomainSummary[] = graph.domains.map((d) => ({
    id: d.id,
    label: d.label,
    summary: d.summary,
    flow_count: d.flows.length,
    entity_count: d.entities?.length ?? 0,
  }));

  return {
    domains: summaries,
    total: summaries.length,
  };
}
