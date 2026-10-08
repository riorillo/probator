import { readFileSync } from "node:fs";
import { encode } from "../json.ts";
import type { Mark } from "../marks.ts";
import type { Action } from "./types.ts";

/** Atomically read visible content and controls, preserving actual DOM node identity. */
const SNAPSHOT = readFileSync(new URL("./snapshot.js", import.meta.url), "utf8").trim();
export const READ_STATE = `${SNAPSHOT}()`;

/** Keep every navigation a click starts in the tab the harness watches, never in a new one. */
export const LINKS = readFileSync(new URL("./links.js", import.meta.url), "utf8");

/** Atomically draw the numbered boxes of one observation over the page. */
const MARKS = readFileSync(new URL("./marks.js", import.meta.url), "utf8");

export const READY_STATE = "document.readyState";
export const COMPLETE = "complete";

const LABEL_LAYOUT = readFileSync(new URL("./label-layout.js", import.meta.url), "utf8");

/** The numbers of the snapshot, drawn over the page before the frame is captured. */
export function draw(marks: readonly Mark[]): string {
  return `(${MARKS})(${encode(marks)}, ${LABEL_LAYOUT})`;
}

/** Drop the overlay, so no frame carries the numbers of an older observation. */
export const CLEAR =
  "(() => { document.querySelectorAll('[data-jev-marks]').forEach(host => host.remove()); })()";

export const MARKER = `(() => { const state=${SNAPSHOT}(true); return state?.marker ?? null; })()`;

export function guard(node: number): string {
  return "(() => { const c=window.__jevFast; " +
    `return c ? [c.pageKey(),c.guard(c.nodes.get(${node}))] : null; })()`;
}

/** Read-only stability wait; it never fails the caller. */
export function settle(action: Action): string {
  return `(action => new Promise(resolve => {
  const field=window.__jevFast?.nodes.get(action.node);
  const autocomplete=action.kind==='fill' && field?.getAttribute('role')==='combobox';
  let frames=0, stopped=false;
  const finish=()=>{stopped=true;resolve()};
  setTimeout(finish,autocomplete ? 200 : 50);
  const ready=()=>{
    if (stopped) return;
    const ids=(field?.getAttribute('aria-controls')||field?.getAttribute('aria-owns')||'')
      .split(/\\s+/).filter(Boolean);
    const home=field?.getRootNode?.() ?? document;
    const roots=ids.length ? ids.map(id=>home.getElementById?.(id) ?? document.getElementById(id)).filter(Boolean) : [document];
    const options=roots.flatMap(root=>[...root.querySelectorAll('[role="option"]')]);
    if (++frames>=2 && (!autocomplete || options.some(e=>{
      const r=e.getBoundingClientRect();
      return r.width && r.height && r.bottom>0 && r.top<innerHeight &&
        e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    }))) finish();
    else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
}))(${encode(action)})`;
}

/** Code-owned node IDs refer to actual observed elements, never model-generated selectors. */
export function target(action: Action): string {
  return `(action => {
  const deepest=(x,y)=>{
    let top=document.elementFromPoint(x,y);
    while (top?.shadowRoot){
      const inner=top.shadowRoot.elementFromPoint(x,y);
      if (!inner||inner===top) break;
      top=inner;
    }
    return top;
  };
  const up=(node,step)=>{
    for (; node; node=node.parentElement??node.getRootNode()?.host??null){
      if (step(node)) return node;
    }
    return null;
  };
  const nearest=(e,matches)=>up(e,node=>node.matches?.(matches));
  const owns=(e,top)=>up(top,node=>node===e)===e;
  const usable=(e,a)=>{
    if (!e?.isConnected) return false;
    if (e.matches(':disabled') || nearest(e,'[aria-disabled="true"],[inert]')) return false;
    const c=e.tagName==='LABEL' ? e.control : null;
    if (c && (c.matches(':disabled') || nearest(c,'[aria-disabled="true"],[inert]'))) return false;
    if (!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return false;
    if (a.kind!=='fill') return true;
    return !e.readOnly && e.getAttribute('aria-readonly')!=='true';
  };
  const reachable=(r,x,y)=>{
    if (!r.width || !r.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return false;
    return true;
  };
  const selectable=(e,value)=>e.tagName==='SELECT' && [...e.options].some(o=>o.value===value &&
    !o.disabled && !o.closest('optgroup[disabled]'));
  const e=window.__jevFast?.nodes.get(action.node);
  if (!usable(e,action)) return null;
  const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
  if (!reachable(r,x,y) || !owns(e,deepest(x,y))) return null;
  if (action.kind!=='select') return {x,y};
  if (!selectable(e,action.value)) return null;
  e.value=action.value;
  e.dispatchEvent(new Event('input',{bubbles:true}));
  e.dispatchEvent(new Event('change',{bubbles:true}));
  return {x,y};
})(${encode(action)})`;
}
