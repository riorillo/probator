/** The frame of the observed page, already encoded by the server. */
export function Shot({ frame }: { readonly frame: string }) {
  return <img alt="Live view of the controlled browser" src={frame} />;
}
