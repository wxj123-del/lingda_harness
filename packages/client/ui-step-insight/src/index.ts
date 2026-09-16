/**
 * Step Insight plugin, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The view reads the Session event window without adding
 * host-side behavior, model context, or provider requests.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
