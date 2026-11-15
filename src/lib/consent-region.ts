/**
 * Region check for the analytics consent banner. geo.lipu.dev (a Cloudflare
 * Worker, source in komapc/lipu-hub `geo/`) answers `{ consentRequired }` from
 * the visitor's country: true for the EU/EEA, UK and Switzerland, and for any
 * country it can't determine. consentScript() (run beforeInteractive by
 * GoogleAnalytics.tsx) starts the request and stores the promise on window under GEO_PROMISE_KEY;
 * CookieConsent reads it. Anything other than a literal `false` within
 * GEO_TIMEOUT_MS (error, timeout, CSP block) keeps analytics denied and shows
 * the opt-in banner, so a Worker outage falls back to the old behaviour.
 */
export const GEO_URL = 'https://geo.lipu.dev/'
export const GEO_TIMEOUT_MS = 1500
export const GEO_PROMISE_KEY = '__daatanConsentNotRequired'

declare global {
  interface Window {
    __daatanConsentNotRequired?: Promise<boolean>
  }
}

/** Resolves true only when the geo check said this visitor's region needs no opt-in banner. */
export function consentNotRequired(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return window[GEO_PROMISE_KEY] ?? Promise.resolve(false)
}

/**
 * Inline consent script. Sets the Consent Mode default (denied unless the
 * visitor stored 'granted'); with no stored choice, asks geo.lipu.dev and
 * grants analytics only on a literal `consentRequired: false` that arrives
 * within GEO_TIMEOUT_MS and while the visitor still hasn't chosen.
 */
export function consentScript(): string {
  return `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
var _storedConsent;
try { _storedConsent = localStorage.getItem('daatan_analytics_consent'); } catch(e) {}
var _decided = _storedConsent === 'granted' || _storedConsent === 'denied';
gtag('consent', 'default', {
  analytics_storage: _storedConsent === 'granted' ? 'granted' : 'denied',
  ad_storage: 'denied',
  functionality_storage: 'denied',
  personalization_storage: 'denied',
  security_storage: 'granted',
  wait_for_update: _decided ? undefined : ${GEO_TIMEOUT_MS}
});
if (!_decided) {
  window.${GEO_PROMISE_KEY} = new Promise(function (resolve) {
    try {
      var ctrl = new AbortController();
      setTimeout(function () { ctrl.abort(); resolve(false); }, ${GEO_TIMEOUT_MS});
      fetch('${GEO_URL}', { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { resolve(!!d && d.consentRequired === false); })
        .catch(function () { resolve(false); });
    } catch (e) { resolve(false); }
  }).then(function (notRequired) {
    var stillUndecided = true;
    try { stillUndecided = !localStorage.getItem('daatan_analytics_consent'); } catch (e) {}
    if (notRequired && stillUndecided) gtag('consent', 'update', { analytics_storage: 'granted' });
    return notRequired;
  });
}
`
}
