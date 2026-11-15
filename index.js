/**
 * Host half of the DeepSeek chat bundle.
 *
 * The whole feature lives in the browser: `client.js` registers the left-sidebar
 * entry and the main panel it opens, and calls the configured DeepSeek API
 * directly from the page. Nothing on the Host side needs to run, so this row
 * only keeps the bundle a valid plugin in the profile's composition.
 */
export function apply() {}
