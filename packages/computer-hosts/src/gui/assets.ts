/**
 * GUI asset loader.
 *
 * Wrangler bundles with esbuild. We use the `text` loader (configured via
 * wrangler rules) to import HTML/CSS files as strings.
 */

// @ts-expect-error — text loader import
import dashboardHtml from './dashboard.html';
// @ts-expect-error — text loader import
import viewerHtml from './viewer.html';
// @ts-expect-error — text loader import
import styleCss from './style.css';

export { dashboardHtml, viewerHtml, styleCss };
