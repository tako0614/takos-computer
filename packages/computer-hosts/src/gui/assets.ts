/**
 * GUI asset loader.
 *
 * The SolidJS dashboard build writes `assets.generated.ts` so the Worker can
 * import the dashboard HTML in Deno tests and in Wrangler without raw-loader
 * support.
 */

import { appHtml } from "./assets.generated.ts";

const styleCss = `
body {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
}

code {
  color: #bfdbfe;
}
`;

export { appHtml, styleCss };
