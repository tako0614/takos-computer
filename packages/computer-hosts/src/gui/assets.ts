/**
 * GUI asset loader.
 *
 * The SolidJS dashboard build writes `assets.generated.ts` so the Worker can
 * import the dashboard HTML in Bun tests and in Wrangler without raw-loader
 * support.
 */

import { appHtml } from "./assets.generated.ts";

export { appHtml };
