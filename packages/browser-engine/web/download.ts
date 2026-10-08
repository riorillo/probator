/** Saves text as a file. The single place the client touches storage. */

/** Writes `content` to a file with this name in the download folder. */
export function save(content: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
