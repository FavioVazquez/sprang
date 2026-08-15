import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseAgent } from './base.js';
import type { AgentContext, AgentResult } from './base.js';
import { detectCommunities, modularity } from '../graph/communities.js';
import { findCycles, computeMartinMetrics, findSdpViolations } from '../graph/architecture-metrics.js';
import { detectClones } from '../graph/clones.js';
import { extractEnvRefs, summarizeEnvVars, type EnvVarRef } from '../artifacts/env-vars.js';
import { extractEventRefs, linkEvents, type EventRef } from '../artifacts/events.js';
import { extractArtifacts, detectArtifactKind, sniffArtifactKind } from '../artifacts/non-code.js';

/**
 * Structural analysis that goes beyond the import graph.
 *
 * Everything here was previously reachable only through a library call, which
 * meant the dashboard, the health grade and the MCP tools could not see any of
 * it. Running it in Phase 2 puts the results where the rest of the system
 * already looks.
 *
 * Findings that describe a *pair* or a *set* — a cycle, a clone group, a
 * community, an event topic — are written to the intermediate directory rather
 * than onto nodes, because they do not belong to any single node. Findings
 * that describe one file are attached to that file.
 */
export class StructureAnalyzerAgent extends BaseAgent {
  readonly id = 'structure-analyzer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const graph = ctx.graph;

    // ── Communities ──
    // The de-facto module structure, which frequently disagrees with the
    // directory layout. Two resolutions: coarse subsystems and finer modules.
    const subsystems = detectCommunities(graph, { resolution: 0.5 });
    const modules = detectCommunities(graph, { resolution: 1.5 });
    const q = modularity(graph, subsystems);

    for (const community of subsystems) {
      for (const nodeId of community.nodeIds) {
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        node.metadata = { ...node.metadata, community: community.label };
      }
    }

    // ── Cycles and architecture metrics ──
    const cycles = findCycles(graph);
    const martin = computeMartinMetrics(graph);
    const sdpViolations = findSdpViolations(martin, graph);

    // ── Clones ──
    // Needs source, so read only the files the graph already knows about, and
    // tolerate any of them having moved since the scan.
    const sources = new Map<string, string>();
    for (const node of graph.nodes) {
      if (node.type !== 'file' || !node.location?.file) continue;
      if (node.metadata?.['fileCategory'] !== 'source') continue;
      try {
        sources.set(node.location.file, await readFile(join(ctx.projectRoot, node.location.file), 'utf-8'));
      } catch {
        // A file listed in the graph but gone from disk is normal mid-refactor.
      }
    }
    const clones = detectClones(graph, sources);

    // ── Non-code artifacts become real graph nodes ──
    //
    // CI jobs, k8s resources, Terraform, migrations and OpenAPI endpoints are
    // where people actually get lost, and the schema has declared node types
    // for them since 0.2 without anything ever producing one. A migration that
    // drops a column three services still read is the classic agent
    // catastrophe, and it is invisible in an import graph.
    let artifactNodes = 0;
    for (const node of graph.nodes) {
      if (node.type !== 'file' || !node.location?.file) continue;
      const path = node.location.file;
      let content = sources.get(path);
      if (content === undefined) {
        // Artifacts are mostly *not* source files, so they were skipped above.
        const kind = detectArtifactKind(path);
        if (kind === null) continue;
        try {
          content = await readFile(join(ctx.projectRoot, path), 'utf-8');
        } catch {
          continue;
        }
      }
      if (detectArtifactKind(path) === null && sniffArtifactKind(path, content) === null) continue;

      const extracted = extractArtifacts(path, content);
      if (extracted.nodes.length === 0) continue;

      for (const artifact of extracted.nodes) {
        if (graph.nodes.some((n) => n.id === artifact.id)) continue;
        graph.nodes.push({
          id: artifact.id,
          type: artifact.type,
          label: artifact.label,
          location: { file: artifact.file, ...(artifact.line ? { start_line: artifact.line } : {}) },
          ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
        });
        artifactNodes += 1;
      }
      for (const edge of extracted.edges) {
        if (graph.edges.some((e) => e.source === edge.source && e.target === edge.target && e.type === edge.type)) {
          continue;
        }
        graph.edges.push({ source: edge.source, target: edge.target, type: edge.type });
      }
    }

    // ── Config and event artifacts ──
    const envRefs: EnvVarRef[] = [];
    const eventRefs: EventRef[] = [];
    for (const [path, content] of sources) {
      try {
        envRefs.push(...extractEnvRefs(path, content));
        eventRefs.push(...extractEventRefs(path, content));
      } catch {
        // Never let one unparseable file end the analysis.
      }
    }
    const envVars = summarizeEnvVars(envRefs);
    const events = linkEvents(eventRefs);

    // Attach the per-file findings that a node can meaningfully own.
    for (const node of graph.nodes) {
      if (node.type !== 'file' || !node.location?.file) continue;
      const path = node.location.file;
      const reads = envVars.filter((v) => v.readBy.includes(path));
      const publishes = events.filter((e) => e.publishers.includes(path));
      const subscribes = events.filter((e) => e.subscribers.includes(path));
      if (reads.length === 0 && publishes.length === 0 && subscribes.length === 0) continue;
      node.metadata = {
        ...node.metadata,
        ...(reads.length > 0
          ? {
              env_vars: reads.map((v) => v.name),
              // The actionable half: needed here, declared nowhere.
              env_vars_undeclared: reads.filter((v) => v.undeclared).map((v) => v.name),
            }
          : {}),
        ...(publishes.length > 0 ? { publishes: publishes.map((e) => e.topic) } : {}),
        ...(subscribes.length > 0 ? { subscribes: subscribes.map((e) => e.topic) } : {}),
      };
    }

    await this.writeIntermediate(ctx, 'structure.json', {
      artifactNodes,
      communities: {
        modularity: Math.round(q * 1000) / 1000,
        subsystems: subsystems.map((c) => ({ label: c.label, size: c.nodeIds.length })),
        modules: modules.map((c) => ({ label: c.label, size: c.nodeIds.length })),
      },
      cycles: cycles.map((c) => ({
        members: c.members,
        witness: c.witness,
        suggestedCut: c.suggestedCut,
      })),
      martin,
      sdpViolations,
      clones: clones.map((c) => ({
        similarity: c.similarity,
        members: c.members.map((m) => `${m.file}:${m.name}`),
      })),
      envVars: envVars.filter((v) => v.undeclared || v.readBy.length > 1),
      events: events.filter((e) => e.orphanedPublish || e.orphanedSubscribe || e.publishers.length > 0),
    });

    return this.success(ctx, graph);
  }
}
