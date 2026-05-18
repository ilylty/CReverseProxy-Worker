# AGENTS

## Runtime
- This repo is a single Cloudflare Worker, not a Node app package: there is no `package.json` or npm script layer.
- Source of truth for runtime wiring is `wrangler.jsonc`: worker name `cloudflare-reverse-proxy`, entrypoint `src/index.js`.
- Public demo URL is `https://rpb.ilylty.bond/`.
- `wrangler.jsonc` also defines observability: Workers logs are enabled and persisted, while traces are currently disabled.
- Use `npx wrangler ...` directly for all local work.

## Commands
- Local dev: `npx wrangler dev`
- Deploy: `npx wrangler deploy`
- There are no repo-local lint, test, or typecheck commands configured today. Do not claim they were run unless you add that tooling.

## Files That Matter
- `src/index.js` is the worker entrypoint and high-level request flow: routing, upstream request construction, redirect following, HEAD probe handling, and WebSocket forwarding.
- `src/home.js` contains the home page rendering and wallpaper fetch logic.
- `src/proxy/url.js` contains proxy path parsing, target normalization, and relative navigation recovery.
- `src/proxy/security.js` contains SSRF guardrails and upstream target validation.
- `src/proxy/rewrite.js` contains response header rewriting, HTML/CSS rewriting, and the injected browser shim.
- `README.md` is useful for the public URL shape and intended feature set, but prefer `src/index.js` when behavior and docs differ.
- `.wrangler/` is generated local Wrangler output, not source.

## Proxy Semantics To Preserve
- Proxy paths are encoded as `/<scheme>/<host>/<path>?<query>` via `toProxyPath()` and `toProxyUrl()`. Keep this format stable unless you intentionally migrate every rewrite path.
- Requests that do not start with `/http/` or `/https/` may still be valid proxied navigations: `recoverRelativeNavigationTarget()` reconstructs them from same-origin `Referer`. Changes here can silently break relative assets and form posts.
- Nested proxied URLs are normalized by `normalizeProxyTargetFromUrl()` plus `findNestedProxyTarget()`. This prevents double-proxy paths from drifting; preserve that behavior when touching path parsing.
- The runtime shim injected by `HeadInjector` rewrites `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `window.open`, history methods, DOM URL setters, and form submission. If browser-side navigation breaks, inspect the shim and server-side HTML attribute rewriting together.

## Security And Header Gotchas
- `enforceTargetPolicy()` intentionally blocks localhost, common private/internal suffixes, private IPv4 ranges, and local/ULA/link-local IPv6 literals. Do not relax this casually; it is the repo's SSRF protection.
- Only ports `80` and `443` are allowed for upstream targets.
- Response headers are intentionally stripped in `rewriteResponseHeaders()`, including CSP, frame/embed policies, and `alt-svc`, and `Set-Cookie` is conservatively rewritten. `content-length` is also dropped for rewritten HTML/CSS responses. Changes here can affect rendering and login behavior.

## Known Special Cases
- `buildFallbackAssetResponse()` returns synthetic empty assets for specific Apple CDN failures:
  `sfss.cdn-apple.com/*.js` on `403`, and `sf-saas.cdn-apple.com/*.css` on `>=500`.
- `text/event-stream` is streamed through without buffering; `WebSocket` upgrades are forwarded separately in `handleWebSocket()`.
- JS body rewriting is intentionally minimal right now: `rewriteTextAsset()` only rewrites CSS content, not arbitrary JavaScript text.
- Attachment responses preserve identity content metadata where possible, and `HEAD` attachment responses may be probed with a synthetic range `GET` to recover stable download headers.

## Verification
- After behavior changes, prefer manual verification with `npx wrangler dev` against a real public target that exercises:
  home page redirect, relative asset loading, form submission, redirects, SSE, and WebSocket proxying.
- If you touch URL parsing or rewriting, test both canonical proxied paths like `/https/github.com/` and same-origin relative navigations recovered from a proxied page.
- For lightweight structural refactors, `npx wrangler deploy --dry-run` is the fastest bundle validation step available in this repo.
