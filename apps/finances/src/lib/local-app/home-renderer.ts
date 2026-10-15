import fs from "node:fs";
import path from "node:path";

/** One self-contained, network-free resource for full-page and companion hosts. */
export function financeHomeHtml() {
  const script = fs.readFileSync(
    path.join(process.cwd(), "public/finance-workspace.js"),
    "utf8",
  );
  const css = fs.readFileSync(
    path.join(process.cwd(), "public/finance-workspace.css"),
    "utf8",
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Finances</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
}
