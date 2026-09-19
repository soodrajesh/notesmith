// GA4, shared with irajeshsood.com's measurement ID — this tool is served under
// irajeshsood.com/notesmith/ via a rewrite, and a visit here is part of that same
// user journey (same pattern as gogenops.com sharing one ID across its landing
// page + calculators). Hostname-gated because this repo is ALSO directly live at
// mynotesmith.vercel.app — without the check, that separate deployment's traffic
// (and Vercel preview builds) would misreport as irajeshsood.com visits.
// anonymize_ip on; page_location strips the query string.
//
// Lives in a file (not inline in index.html) so the CSP can keep script-src free
// of 'unsafe-inline'.
window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
gtag('js', new Date());
if (location.hostname === 'irajeshsood.com') {
  var url = new URL(window.location.href);
  url.search = '';
  gtag('config', 'G-LSL40CXDZK', {
    anonymize_ip: true,
    send_page_view: true,
    page_location: url.toString(),
  });
}
