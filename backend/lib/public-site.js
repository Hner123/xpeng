'use strict';

const DEFAULT_SITE = 'https://x-peng.netlify.app';

// Old deployments can still carry the backend origin in PUBLIC_SITE_URL
// or queued message payloads. Never use that origin for guest-facing links.
function publicSite(value) {
  if (!value) return DEFAULT_SITE;
  try {
    const url = new URL(String(value).trim());
    if (!['https:', 'http:'].includes(url.protocol)) return DEFAULT_SITE;
    if (url.hostname === 'heineraboka.site' || url.hostname.endsWith('.heineraboka.site')) return DEFAULT_SITE;
    return url.href.replace(/\/$/, '');
  } catch (_) { return DEFAULT_SITE; }
}

module.exports = { publicSite };
