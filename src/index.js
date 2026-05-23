import { renderHome } from "./home.js";
import {
  isHttpProtocol,
  parseProxyTarget,
  parseUserTarget,
  recoverRelativeNavigationTarget,
  safeResolveUrl,
  toProxyUrl,
} from "./proxy/url.js";
import { enforceTargetPolicy } from "./proxy/security.js";
import {
  extractTotalLengthFromContentRange,
  getNormalizedSingletonHeaderValue,
  isCssMimeType,
  normalizeAttachmentValidationHeaders,
  restorePassthroughContentMetadata,
  rewriteHtmlResponse,
  rewriteResponseHeaders,
  rewriteTextAsset,
} from "./proxy/rewrite.js";

const RESERVED_PATHS = new Set(["/favicon.ico", "/robots.txt"]);
const MAX_UPSTREAM_REDIRECTS = 3;
const DEBUG_FETCH = false;
const DEBUG_FETCH_HOST_FILTER = ".googlevideo.com";

export default {
  async fetch(request) {
    try {
      debugLogFetchInput("worker", request);
      return await handleRequest(request);
    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, { status: 500 });
    }
  },
};

async function handleRequest(request) {
  const requestUrl = new URL(request.url);

  if (RESERVED_PATHS.has(requestUrl.pathname)) {
    return new Response(null, { status: 204 });
  }

  if (requestUrl.pathname === "/") {
    const inputUrl = requestUrl.searchParams.get("url");
    if (!inputUrl) {
      return renderHome(requestUrl.origin);
    }

    const targetUrl = parseUserTarget(inputUrl);
    enforceTargetPolicy(targetUrl);
    return Response.redirect(toProxyUrl(targetUrl, requestUrl.origin), 302);
  }

  const refererUrl = safeResolveUrl(request.headers.get("referer") || "", requestUrl);
  const recoveredRelativeTarget = recoverRelativeNavigationTarget(requestUrl, refererUrl);
  if (recoveredRelativeTarget) {
    enforceTargetPolicy(recoveredRelativeTarget);
    if (isWebSocketUpgrade(request)) {
      return handleWebSocket(request, recoveredRelativeTarget);
    }
    return handleHttpProxy(request, requestUrl, recoveredRelativeTarget);
  }

  const targetUrl = parseProxyTarget(requestUrl, request.headers.get("referer"));
  if (!targetUrl) {
    return new Response("Invalid proxy path", { status: 400 });
  }

  enforceTargetPolicy(targetUrl);

  if (isWebSocketUpgrade(request)) {
    return handleWebSocket(request, targetUrl);
  }

  return handleHttpProxy(request, requestUrl, targetUrl);
}


async function handleHttpProxy(request, requestUrl, targetUrl) {
  const { upstreamResponse, finalTargetUrl } = await fetchUpstreamResponse(request, targetUrl);

  if (shouldProbeHeadAttachment(request, upstreamResponse)) {
    return buildHeadAttachmentProbeResponse(request, requestUrl, finalTargetUrl, upstreamResponse);
  }

  const fallbackAssetResponse = buildFallbackAssetResponse(upstreamResponse, finalTargetUrl);
  if (fallbackAssetResponse) {
    return fallbackAssetResponse;
  }

  const responseHeaders = rewriteResponseHeaders(upstreamResponse.headers, requestUrl, finalTargetUrl);
  const contentType = getNormalizedSingletonHeaderValue(upstreamResponse.headers, "content-type");
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  restorePassthroughContentMetadata(responseHeaders, upstreamResponse.headers, mimeType);
  normalizeAttachmentValidationHeaders(responseHeaders, upstreamResponse.headers, mimeType);

  if (shouldUseFixedLengthDownloadResponse(request, upstreamResponse, responseHeaders, mimeType)) {
    return buildFixedLengthDownloadResponse(upstreamResponse, responseHeaders);
  }

  if (mimeType === "text/event-stream") {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  if (upstreamResponse.status === 204 || upstreamResponse.status === 205 || request.method === "HEAD") {
    return new Response(null, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  if (mimeType === "text/html") {
    responseHeaders.delete("content-length");
    const rewrittenHtmlResponse = rewriteHtmlResponse(upstreamResponse, requestUrl.origin, finalTargetUrl);
    return new Response(rewrittenHtmlResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  if (isCssMimeType(mimeType)) {
    responseHeaders.delete("content-length");
    const body = await upstreamResponse.text();
    const rewrittenBody = rewriteTextAsset(body, finalTargetUrl, requestUrl.origin, mimeType);
    return new Response(rewrittenBody, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function fetchUpstreamResponse(request, targetUrl) {
  let currentTargetUrl = targetUrl;
  let currentMethod = request.method;
  const shouldAutoFollow = shouldAutoFollowUpstreamRedirects(request);
  const seenTargets = new Set([currentTargetUrl.toString()]);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const upstreamRequest = buildUpstreamRequest(request, currentTargetUrl, {
      method: currentMethod,
    });
    const fetchInit = {
      redirect: "manual",
    };
    debugLogFetchInput("upstream", upstreamRequest, fetchInit);
    const upstreamResponse = await fetch(upstreamRequest, fetchInit);
    debugLogFetchResponse("upstream", upstreamResponse, currentTargetUrl);

    if (!shouldAutoFollow || !isRedirectResponse(upstreamResponse.status)) {
      return { upstreamResponse, finalTargetUrl: currentTargetUrl };
    }

    const location = upstreamResponse.headers.get("location");
    const nextTargetUrl = location ? safeResolveUrl(location, currentTargetUrl) : null;
    if (!nextTargetUrl || !isHttpProtocol(nextTargetUrl.protocol)) {
      return { upstreamResponse, finalTargetUrl: currentTargetUrl };
    }

    enforceTargetPolicy(nextTargetUrl);

    const nextTargetKey = nextTargetUrl.toString();
    if (redirectCount >= MAX_UPSTREAM_REDIRECTS || seenTargets.has(nextTargetKey)) {
      return { upstreamResponse, finalTargetUrl: currentTargetUrl };
    }

    seenTargets.add(nextTargetKey);
    currentMethod = getRedirectedRequestMethod(currentMethod, upstreamResponse.status);
    currentTargetUrl = nextTargetUrl;
  }
}

function buildUpstreamRequest(request, targetUrl, overrides = {}) {
  const headers = new Headers(request.headers);
  const requestUrl = new URL(request.url);
  const originalTargetUrl = parseProxyTarget(requestUrl, request.headers.get("referer"));
  const requestContext = {
    secFetchMode: headers.get("sec-fetch-mode"),
    secFetchDest: headers.get("sec-fetch-dest"),
  };
  headers.set("host", targetUrl.host);
  stripProxyContextHeaders(headers);
  rewriteForwardHeaders(headers, targetUrl, originalTargetUrl, requestContext);
  headers.delete("cf-connecting-ip");
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  if (overrides.headers) {
    for (const [headerName, headerValue] of Object.entries(overrides.headers)) {
      if (headerValue === null) {
        headers.delete(headerName);
      } else {
        headers.set(headerName, headerValue);
      }
    }
  }

  const method = overrides.method || request.method;

  return new Request(targetUrl, {
    method,
    headers,
    body: canHaveRequestBody(method) ? request.body : undefined,
    redirect: "manual",
    duplex: canHaveRequestBody(method) ? "half" : undefined,
  });
}

function shouldAutoFollowUpstreamRedirects(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const secFetchMode = request.headers.get("sec-fetch-mode");
  const secFetchDest = request.headers.get("sec-fetch-dest");
  return secFetchMode !== "navigate" && secFetchDest !== "document" && secFetchDest !== "iframe" && secFetchDest !== "frame";
}

function isRedirectResponse(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function getRedirectedRequestMethod(method, status) {
  if (status === 303 && method !== "HEAD") {
    return "GET";
  }

  if ((status === 301 || status === 302) && method === "POST") {
    return "GET";
  }

  return method;
}

function stripProxyContextHeaders(headers) {
  headers.set("accept-encoding", "identity");
  headers.delete("cookie");
  headers.delete("sec-fetch-dest");
  headers.delete("sec-fetch-mode");
  headers.delete("sec-fetch-site");
  headers.delete("sec-fetch-user");
  headers.delete("service-worker-navigation-preload");
}

function buildFallbackAssetResponse(upstreamResponse, targetUrl) {
  const hostname = targetUrl.hostname.toLowerCase();
  const pathname = targetUrl.pathname.toLowerCase();

  if (hostname === "sfss.cdn-apple.com" && pathname.endsWith(".js") && upstreamResponse.status === 403) {
    return new Response(";", {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
        "x-proxy-fallback": "sfss-empty-js",
      },
    });
  }

  if (hostname === "sf-saas.cdn-apple.com" && pathname.endsWith(".css") && upstreamResponse.status >= 500) {
    return new Response("/* upstream stylesheet unavailable */", {
      status: 200,
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-store",
        "x-proxy-fallback": "sf-saas-empty-css",
      },
    });
  }

  return null;
}

function shouldProbeHeadAttachment(request, upstreamResponse) {
  if (request.method !== "HEAD") {
    return false;
  }

  const contentDisposition = upstreamResponse.headers.get("content-disposition") || "";
  if (!/(^|;)\s*attachment\b/i.test(contentDisposition)) {
    return false;
  }

  return !upstreamResponse.headers.has("location") && !upstreamResponse.headers.has("set-cookie");
}

async function buildHeadAttachmentProbeResponse(request, requestUrl, targetUrl, headResponse) {
  const probeRequest = buildUpstreamRequest(request, targetUrl, {
    method: "GET",
    headers: {
      range: "bytes=0-0",
    },
  });
  const fetchInit = {
    redirect: "manual",
  };
  debugLogFetchInput("head-probe", probeRequest, fetchInit);
  const probeResponse = await fetch(probeRequest, fetchInit);
  debugLogFetchResponse("head-probe", probeResponse, targetUrl);

  if (probeResponse.body) {
    await probeResponse.body.cancel();
  }

  const responseHeaders = rewriteResponseHeaders(headResponse.headers, requestUrl, targetUrl);
  const contentType = headResponse.headers.get("content-type") || "";
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  const headIdentityContentLength = headResponse.headers.get("x-identity-content-length");

  const contentRange = probeResponse.headers.get("content-range");
  const acceptRanges = probeResponse.headers.get("accept-ranges");
  if (acceptRanges) {
    responseHeaders.set("accept-ranges", acceptRanges);
  } else {
    responseHeaders.set("accept-ranges", "bytes");
  }

  restorePassthroughContentMetadata(responseHeaders, probeResponse.headers, mimeType);
  normalizeAttachmentValidationHeaders(responseHeaders, probeResponse.headers, mimeType);

  // Keep the synthesized HEAD response shaped like a normal 200 attachment response.
  responseHeaders.delete("content-range");

  const probedContentLength =
    extractTotalLengthFromContentRange(contentRange) || headIdentityContentLength || responseHeaders.get("x-identity-content-length");
  if (probedContentLength) {
    responseHeaders.set("content-length", probedContentLength);
  }

  return new Response(null, {
    status: headResponse.status,
    statusText: headResponse.statusText,
    headers: responseHeaders,
  });
}

function shouldUseFixedLengthDownloadResponse(request, upstreamResponse, responseHeaders, mimeType) {
  if (request.method !== "GET" || upstreamResponse.status !== 200 || !upstreamResponse.body) {
    return false;
  }

  const contentDisposition = responseHeaders.get("content-disposition") || "";
  const isAttachment = /(^|;)\s*attachment\b/i.test(contentDisposition);
  const isRewrittenText = mimeType === "text/html" || isCssMimeType(mimeType);
  if (!isAttachment || isRewrittenText) {
    return false;
  }

  return /^\d+$/.test(responseHeaders.get("content-length") || "");
}

function buildFixedLengthDownloadResponse(upstreamResponse, responseHeaders) {
  responseHeaders.set("accept-ranges", responseHeaders.get("accept-ranges") || "bytes");
  responseHeaders.delete("transfer-encoding");

  const contentLength = Number(responseHeaders.get("content-length"));
  const { readable, writable } = new FixedLengthStream(contentLength);
  upstreamResponse.body.pipeTo(writable).catch(() => writable.abort());

  return new Response(readable, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}



function rewriteForwardHeaders(headers, targetUrl, originalTargetUrl, requestContext = {}) {
  const sourceTargetUrl = originalTargetUrl || targetUrl;
  const { secFetchMode, secFetchDest } = requestContext;
  const isDocumentNavigation = secFetchMode === "navigate" || secFetchDest === "document";

  if (isDocumentNavigation) {
    headers.delete("origin");
    headers.delete("referer");
    return;
  }

  const originHeader = headers.get("origin");
  if (originHeader) {
    const originContext = resolveForwardContextUrl(originHeader, sourceTargetUrl);
    if (originContext?.isProxied) {
      headers.set("origin", originContext.url.origin);
    } else if (shouldForwardContextUrl(originContext?.url, sourceTargetUrl)) {
      headers.set("origin", retargetProxyUrl(originContext.url, sourceTargetUrl, targetUrl).origin);
    } else {
      headers.delete("origin");
    }
  }

  const refererHeader = headers.get("referer");
  if (refererHeader) {
    const refererContext = resolveForwardContextUrl(refererHeader, sourceTargetUrl);
    if (refererContext?.isProxied) {
      headers.set("referer", refererContext.url.toString());
    } else if (shouldForwardContextUrl(refererContext?.url, sourceTargetUrl)) {
      headers.set("referer", retargetProxyUrl(refererContext.url, sourceTargetUrl, targetUrl).toString());
    } else {
      headers.delete("referer");
    }
  }

  if (!headers.get("origin") && shouldSendOrigin(headers)) {
    headers.set("origin", targetUrl.origin);
  }
}

function resolveForwardContextUrl(value, sourceTargetUrl) {
  const contextUrl = safeResolveUrl(value, sourceTargetUrl);
  if (!contextUrl) {
    return null;
  }

  const proxiedTarget = parseProxyTarget(contextUrl, null);
  return proxiedTarget ? { url: proxiedTarget, isProxied: true } : { url: contextUrl, isProxied: false };
}

function retargetProxyUrl(candidateUrl, sourceTargetUrl, targetUrl) {
  const resolvedCandidate = new URL(candidateUrl);
  if (resolvedCandidate.origin === targetUrl.origin) {
    return resolvedCandidate;
  }

  if (resolvedCandidate.host === targetUrl.host && isHttpProtocol(resolvedCandidate.protocol)) {
    return resolvedCandidate;
  }

  if (resolvedCandidate.origin !== sourceTargetUrl.origin) {
    return resolvedCandidate;
  }

  const rewrittenUrl = new URL(targetUrl);
  rewrittenUrl.pathname = resolvedCandidate.pathname;
  rewrittenUrl.search = resolvedCandidate.search;
  rewrittenUrl.hash = resolvedCandidate.hash;
  return rewrittenUrl;
}

function shouldForwardContextUrl(candidateUrl, targetUrl) {
  if (!candidateUrl || !targetUrl) {
    return false;
  }

  if (!isHttpProtocol(candidateUrl.protocol)) {
    return false;
  }

  return candidateUrl.origin === targetUrl.origin || candidateUrl.host === targetUrl.host;
}

function shouldSendOrigin(headers) {
  const method = headers.get("access-control-request-method");
  return method !== null;
}


function canHaveRequestBody(method) {
  return method !== "GET" && method !== "HEAD";
}

function isWebSocketUpgrade(request) {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

async function handleWebSocket(request, targetUrl) {
  const upstreamProtocol = targetUrl.protocol === "https:" ? "wss:" : "ws:";
  const upstreamUrl = new URL(targetUrl);
  upstreamUrl.protocol = upstreamProtocol;
  const headers = new Headers(request.headers);
  headers.set("host", upstreamUrl.host);
  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
  });
  debugLogFetchInput("websocket", upstreamRequest);
  return fetch(upstreamRequest);
}

function debugLogFetchInput(label, input, init) {
  if (!DEBUG_FETCH) {
    return;
  }

  try {
    const serialized = serializeFetchInput(input, init);
    if (!matchesDebugFetchFilter(serialized.input?.url || serialized.input?.value)) {
      return;
    }
    console.log(`[debug:fetch:${label}]`, JSON.stringify(serialized));
  } catch (error) {
    console.log(`[debug:fetch:${label}]`, "failed to serialize fetch input", error?.message || String(error));
  }
}

function debugLogFetchResponse(label, response, targetUrl) {
  if (!DEBUG_FETCH) {
    return;
  }

  try {
    if (!matchesDebugFetchFilter(targetUrl?.toString() || response.url)) {
      return;
    }
    console.log(
      `[debug:fetch-response:${label}]`,
      JSON.stringify({
        targetUrl: targetUrl?.toString(),
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        redirected: response.redirected,
        url: response.url,
      })
    );
  } catch (error) {
    console.log(`[debug:fetch-response:${label}]`, "failed to serialize fetch response", error?.message || String(error));
  }
}

function matchesDebugFetchFilter(value) {
  if (!DEBUG_FETCH_HOST_FILTER) {
    return true;
  }

  if (!value) {
    return false;
  }

  try {
    return new URL(value).hostname.endsWith(DEBUG_FETCH_HOST_FILTER);
  } catch {
    return String(value).includes(DEBUG_FETCH_HOST_FILTER);
  }
}

function serializeFetchInput(input, init) {
  const request = input instanceof Request ? input : null;
  return {
    input: request
      ? serializeRequest(input)
      : {
          type: typeof input,
          value: String(input),
        },
    init: init ? serializeRequestInit(init) : undefined,
  };
}

function serializeRequest(request) {
  return {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    bodyUsed: request.bodyUsed,
    hasBody: request.body !== null,
    redirect: request.redirect,
    mode: request.mode,
    credentials: request.credentials,
    cache: request.cache,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
  };
}

function serializeRequestInit(init) {
  const serialized = { ...init };
  if (init.headers) {
    serialized.headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers;
  }
  if (init.body) {
    serialized.body = `[${typeof init.body}]`;
  }
  return serialized;
}
