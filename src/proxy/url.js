export function parseUserTarget(input) {
  let value = input.trim();
  if (!value) {
    throw new Error("Please enter a URL or search keyword");
  }

  if (!/^https?:\/\//i.test(value)) {
    if (looksLikeWebUrlCandidate(value)) {
      value = `https://${value}`;
    } else {
      return new URL(`https://duckduckgo.com/?q=${encodeURIComponent(value)}`);
    }
  }

  const targetUrl = new URL(value);
  if (!isHttpProtocol(targetUrl.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  return targetUrl;
}

export function parseProxyTarget(requestUrl, refererValue) {
  const normalizedTarget = normalizeProxyTargetFromUrl(requestUrl);
  if (!normalizedTarget) {
    return null;
  }

  return recoverTargetFromReferer(normalizedTarget, refererValue, requestUrl);
}

export function toProxyUrl(target, proxyOrigin) {
  const targetUrl = target instanceof URL ? target : new URL(target);
  return `${proxyOrigin}${toProxyPath(targetUrl)}`;
}

export function toProxyPath(target) {
  const targetUrl = target instanceof URL ? target : new URL(target);
  const path = targetUrl.pathname || "/";
  const query = targetUrl.search || "";
  return `/${targetUrl.protocol.slice(0, -1)}/${targetUrl.host}${path}${query}`;
}

export function toProxyOrigin(targetUrl, proxyOrigin) {
  return `${proxyOrigin}/${targetUrl.protocol.slice(0, -1)}/${targetUrl.host}`;
}

export function isAlreadyProxiedUrl(candidateUrl, proxyOrigin) {
  return candidateUrl.origin === proxyOrigin && parseProxyTarget(candidateUrl, null) !== null;
}

export function recoverRelativeNavigationTarget(requestUrl, refererUrl) {
  if (!refererUrl || requestUrl.origin !== refererUrl.origin) {
    return null;
  }

  if (requestUrl.pathname.startsWith("/http/") || requestUrl.pathname.startsWith("/https/")) {
    return null;
  }

  const refererTarget = parseProxyTarget(refererUrl, null);
  if (!refererTarget) {
    return null;
  }

  const recoveredTarget = new URL(refererTarget);
  recoveredTarget.pathname = requestUrl.pathname;
  recoveredTarget.search = requestUrl.search;
  recoveredTarget.hash = requestUrl.hash;
  return recoveredTarget;
}

export function normalizeProxyTargetFromUrl(requestUrl) {
  let currentUrl = requestUrl;
  for (let depth = 0; depth < 6; depth += 1) {
    const parsed = parseSingleProxyTarget(currentUrl);
    if (!parsed) {
      return null;
    }

    const nested = findNestedProxyTarget(parsed.targetUrl);
    if (!nested) {
      return parsed.targetUrl;
    }

    currentUrl = nested;
  }

  return parseSingleProxyTarget(currentUrl)?.targetUrl ?? null;
}

export function findNestedProxyTarget(targetUrl) {
  const marker = "/https/";
  const httpMarker = "/http/";
  const pathWithQuery = `${targetUrl.pathname}${targetUrl.search}`;
  let markerIndex = pathWithQuery.indexOf(marker);
  let markerLength = marker.length;

  if (markerIndex === -1) {
    markerIndex = pathWithQuery.indexOf(httpMarker);
    markerLength = httpMarker.length;
  }

  if (markerIndex === -1) {
    return null;
  }

  const nestedPath = pathWithQuery.slice(markerIndex + 1);
  const slashIndex = nestedPath.indexOf("/");
  if (slashIndex === -1) {
    return null;
  }

  const nestedScheme = nestedPath.slice(0, slashIndex);
  if (nestedScheme !== "http" && nestedScheme !== "https") {
    return null;
  }

  return new URL(`https://placeholder.invalid/${nestedPath}`);
}

export function safeResolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

export function isHttpProtocol(protocol) {
  return protocol === "http:" || protocol === "https:";
}

function looksLikeWebUrlCandidate(value) {
  if (!value || /\s/.test(value)) {
    return false;
  }

  if (value.startsWith("//")) {
    return false;
  }

  const hostCandidate = value.split(/[/?#]/, 1)[0];
  if (!hostCandidate) {
    return false;
  }

  if (/^\[[0-9a-f:]+\](?::\d+)?$/i.test(hostCandidate)) {
    return true;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(hostCandidate)) {
    return true;
  }

  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i.test(hostCandidate);
}

function recoverTargetFromReferer(targetUrl, refererValue, requestUrl) {
  if (targetUrl.host !== requestUrl.host) {
    return targetUrl;
  }

  const refererUrl = safeResolveUrl(refererValue || "", requestUrl);
  if (!refererUrl || refererUrl.origin !== requestUrl.origin) {
    return targetUrl;
  }

  const refererTarget = normalizeProxyTargetFromUrl(refererUrl);
  if (!refererTarget) {
    return targetUrl;
  }

  const recoveredTarget = new URL(refererTarget);
  recoveredTarget.pathname = targetUrl.pathname;
  recoveredTarget.search = targetUrl.search;
  recoveredTarget.hash = targetUrl.hash;
  return recoveredTarget;
}

function parseSingleProxyTarget(requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const [scheme, host, ...rest] = parts;
  if (scheme !== "http" && scheme !== "https") {
    return null;
  }

  const targetUrl = new URL(`${scheme}://${host}/`);
  targetUrl.pathname = `/${rest.join("/")}`;
  targetUrl.search = requestUrl.search;
  return { scheme, host, targetUrl };
}
