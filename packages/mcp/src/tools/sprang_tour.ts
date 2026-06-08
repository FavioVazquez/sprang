import type { GraphLoader } from '../graph-loader.js';
import type { Tour, TourStep, SprangNode, LanguageLesson } from '@sprang/core';

export interface SprangTourInput {
  tour_id?: string;
  persona?: 'junior' | 'senior' | 'experienced' | 'pm' | 'non-technical';
}

export interface TourStepWithNode {
  step_number: number;
  step_title: string;
  explanation: string;
  highlight?: boolean;
  languageLesson?: LanguageLesson;
  node?: {
    id: string;
    type: string;
    label: string;
    summary?: string;
    risk_score?: number;
  };
}

export interface SprangTourResult {
  tour_id: string;
  title: string;
  description: string;
  persona: string;
  steps: TourStepWithNode[];
  total_steps: number;
}

export interface SprangTourListResult {
  tours: Array<{
    id: string;
    title: string;
    description: string;
    step_count: number;
  }>;
}

function filterStepsForPersona(
  steps: TourStep[],
  persona: 'junior' | 'senior' | 'experienced' | 'pm' | 'non-technical',
  graph: { nodes: SprangNode[] }
): TourStep[] {
  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  if (persona === 'junior') {
    // All steps with language lessons — most comprehensive
    return steps;
  }

  if (persona === 'senior' || persona === 'experienced') {
    // Skip the first introductory step; experienced engineers don't need the basics
    return steps.slice(1);
  }

  if (persona === 'pm') {
    // Filter to domain/service/flow nodes — business-process focused
    return steps.filter((step) => {
      const node = nodeMap.get(step.node_id ?? '');
      if (!node) return false;
      return node.type === 'domain' || node.type === 'service' || node.type === 'flow';
    });
  }

  if (persona === 'non-technical') {
    // Highest-level only: entry-points, domains, and services — no implementation details
    return steps.filter((step) => {
      const node = nodeMap.get(step.node_id ?? '');
      if (!node) return false;
      return (
        node.type === 'domain' ||
        node.type === 'service' ||
        node.type === 'flow' ||
        (node.type === 'file' && (node as SprangNode & { is_entry_point?: boolean }).is_entry_point)
      );
    });
  }

  return steps;
}

export async function sprangTour(
  loader: GraphLoader,
  input: SprangTourInput
): Promise<SprangTourResult | SprangTourListResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  if (graph.tours.length === 0) {
    return { error: 'No tours available in this graph', code: 'NO_TOURS' };
  }

  const persona = (input.persona ?? 'junior') as 'junior' | 'senior' | 'experienced' | 'pm' | 'non-technical';
  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  let tour: Tour | undefined;
  if (input.tour_id) {
    tour = graph.tours.find((t) => t.id === input.tour_id);
    if (!tour) {
      return { error: `Tour '${input.tour_id}' not found`, code: 'TOUR_NOT_FOUND' };
    }
  } else {
    tour = graph.tours[0];
    if (!tour) {
      return { error: 'No tours available in this graph', code: 'NO_TOURS' };
    }
  }

  const filteredSteps = filterStepsForPersona(tour.steps, persona, graph);

  const stepsWithNodes: TourStepWithNode[] = filteredSteps.map((step, idx) => {
    const node = nodeMap.get(step.node_id ?? '');
    return {
      step_number: idx + 1,
      step_title: step.step_title,
      explanation: step.explanation,
      highlight: step.highlight,
      languageLesson: step.languageLesson,
      node: node
        ? {
            id: node.id,
            type: node.type,
            label: node.label,
            summary: node.summary,
            risk_score: node.risk_score,
          }
        : undefined,
    };
  });

  return {
    tour_id: tour.id,
    title: tour.title,
    description: tour.description,
    persona,
    steps: stepsWithNodes,
    total_steps: stepsWithNodes.length,
  };
}
