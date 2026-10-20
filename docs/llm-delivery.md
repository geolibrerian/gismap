# AI documentation delivery checks

The canonical documentation is `/llms.txt`; `/llms-full.txt` is its expanded reference. They contain Markdown but are served as `text/plain; charset=utf-8` for HTTP-reader compatibility. `/llm.txt` is a permanent compatibility redirect, not a second canonical document. As a fallback only, the current main-branch source is [available on GitHub](https://raw.githubusercontent.com/geolibrerian/gismap/main/llms.txt); it can differ from a preview or deployed version.

After publishing an isolated Cloudflare Pages preview, run:

```sh
node scripts/smoke-llms.mjs https://ACTUAL-DEPLOYMENT.pages.dev --match-local
```

The development preview workflow runs this against the URL returned by the deploy action. It checks both direct GET responses, their media types, Markdown heading and key links, the 301 alias, a real 404 and byte-for-byte equality with the artifact in the checkout. A cache hit is not itself an error, but a stale type or body fails the check. Do not treat a passed preview as proof of production behavior; after an explicitly approved production deployment run the same command against `https://gismap.online` with the matching checkout. Check the printed cache status and investigate Cloudflare rules, Access challenges, redirects, CDN cache or Functions if delivery differs. Changes to Cloudflare configuration outside this repository cannot be verified from the source tree.

Before declaring external AI acceptance, use a fresh anonymous session with each client and record whether it retrieved and summarized each canonical URL without relying on a GitHub copy. A successful ordinary HTTP request alone is not that acceptance test. Next, independently test the supported map and briefing workflows, recording what each agent actually verified. Never put credentials or private data in test links.
