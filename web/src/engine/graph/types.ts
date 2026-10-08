// Pipeline graph model (GRAPH_ENGINE_DESIGN.md §3). Positions are not part of it: they live in
// PipelineCanvasState, keyed by node id. Execution order comes from connections and creation order only.
import type { Destination, ReviewDecision, SourceSpec, Step } from "../types";

export type InputRoleId = "input" | "left" | "right" | "primary" | "reference" | "datasets";

type JoinStep = Extract<Step, { type: "join" }>;
type AppendStep = Extract<Step, { type: "append" }>;

/** A step's configuration as a node. Combine steps read their second dataset from an edge, not a file. */
export type NodeStep = Exclude<Step, JoinStep | AppendStep> | Omit<JoinStep, "source"> | Omit<AppendStep, "source">;

interface NodeBase {
  id: string;
  /** Creation order: the only tie-break for execution order. Never derived from position. */
  order: number;
  label?: string;
}

export interface SourceNode extends NodeBase {
  kind: "source";
  source: SourceSpec;
  /**
   * Row-identity rank, assigned once and never reused. Rank 0 rows keep their source row numbers as IDs;
   * rank k rows get IDs k * 1e9 + row number, so sources never collide and lineage is decodable.
   */
  rank: number;
}

export interface StepNode extends NodeBase {
  kind: "step";
  step: NodeStep;
}

export interface LoadNode extends NodeBase {
  kind: "load";
  destination: Destination | null;
}

export type GraphNode = SourceNode | StepNode | LoadNode;

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  input: InputRoleId;
  /** Position among "datasets" inputs (Append). */
  slot?: number;
}

export interface PipelineGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PipelineSpecV2 {
  formaSpec: 2;
  name: string;
  graph: PipelineGraph;
  reviewDecisions: ReviewDecision[];
}

/** Rank multiplier for namespaced row IDs. The run counter must stay below it. */
export const RANK_BASE = 1_000_000_000;

export interface Problem {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}
