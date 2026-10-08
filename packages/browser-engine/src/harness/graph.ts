import { END, START, StateGraph } from "@langchain/langgraph";
import { StalePage } from "../errors.ts";
import { decide } from "./decide.ts";
import { execute } from "./execute.ts";
import { recover } from "./recover.ts";
import { Definition, type State } from "./state.ts";

/**
 * The harness as a state machine: one command is one invocation.
 * A tick is a full step (choose, then run); a predict or an act is half of one.
 */
// LangGraph's fluent `addNode()` return type omits `addConditionalEdges()` in 1.4.x,
// although the runtime Graph builder implements it. Keep the state schema on nodes;
// isolate the upstream declaration mismatch at this builder boundary.
const Builder: any = new StateGraph(Definition);
Builder.addNode("decide", decide);
Builder.addNode("execute", execute);
Builder.addNode("recover", recover);
Builder.addConditionalEdges(START, entry);
Builder.addConditionalEdges("decide", afterDecide);
Builder.addConditionalEdges("execute", afterExecute);
Builder.addEdge("recover", END);

const GRAPH = Builder.compile();

/** Runs one command of the harness against the state it left behind. */
export async function orchestrate(state: State): Promise<State> {
  return await GRAPH.invoke(state);
}

function entry(state: State): "decide" | "execute" {
  return state.mode === "act" ? "execute" : "decide";
}

function afterDecide(state: State): "execute" | "recover" | typeof END {
  if (recoverable(state)) return "recover";
  if (state.failure) return END;
  if (state.mode === "tick") return "execute";
  return END;
}

function afterExecute(state: State): "recover" | typeof END {
  if (recoverable(state)) return "recover";
  return END;
}

/** Only a full step recovers: predicting and acting report the changed page to the caller. */
function recoverable(state: State): boolean {
  if (state.mode !== "tick") return false;
  return state.failure instanceof StalePage;
}
