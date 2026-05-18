import { isAlreadyProxiedUrl, isHttpProtocol, parseProxyTarget, safeResolveUrl, toProxyOrigin, toProxyPath, toProxyUrl } from "./url.js";

const BLOCKED_RESPONSE_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "report-to",
  "nel",
  "permissions-policy",
  "x-frame-options",
  "frame-options",
  "alt-svc",
];

export function rewriteHtmlResponse(upstreamResponse, proxyOrigin, targetUrl) {
  return new HTMLRewriter()
    .on("head", new HeadInjector(targetUrl, proxyOrigin))
    .on("meta[name]", new MetaNameRewriter())
    .on("a[href]", new AttributeRewriter("href", targetUrl, proxyOrigin))
    .on("link[href]", new AttributeRewriter("href", targetUrl, proxyOrigin))
    .on("link[imagesrcset]", new SrcsetRewriter("imagesrcset", targetUrl, proxyOrigin))
    .on("img[src]", new AttributeRewriter("src", targetUrl, proxyOrigin))
    .on("img[srcset]", new SrcsetRewriter("srcset", targetUrl, proxyOrigin))
    .on("script[src]", new AttributeRewriter("src", targetUrl, proxyOrigin))
    .on("iframe[src]", new AttributeRewriter("src", targetUrl, proxyOrigin))
    .on("source[src]", new AttributeRewriter("src", targetUrl, proxyOrigin))
    .on("source[srcset]", new SrcsetRewriter("srcset", targetUrl, proxyOrigin))
    .on("video[src]", new AttributeRewriter("src", targetUrl, proxyOrigin))
    .on("video[poster]", new AttributeRewriter("poster", targetUrl, proxyOrigin))
    .on("audio[src]", new AttributeRewriter("src", targetUrl, proxyOrigin))
    .on("form[action]", new AttributeRewriter("action", targetUrl, proxyOrigin))
    .on("*[style]", new StyleAttributeRewriter(targetUrl, proxyOrigin))
    .on("meta[http-equiv]", new MetaRefreshRewriter(targetUrl, proxyOrigin))
    .transform(normalizeHtmlRewriteResponse(upstreamResponse));
}

export function rewriteTextAsset(body, targetUrl, proxyOrigin, mimeType) {
  if (isCssMimeType(mimeType)) {
    let rewrittenBody = rewriteAbsoluteUrls(body, targetUrl, proxyOrigin);
    rewrittenBody = rewriteCssRootRelativeUrls(rewrittenBody, targetUrl, proxyOrigin);
    return rewrittenBody;
  }

  return body;
}

export function rewriteResponseHeaders(sourceHeaders, requestUrl, targetUrl) {
  const headers = new Headers(sourceHeaders);
  normalizeSingletonResponseHeaders(headers);

  for (const headerName of BLOCKED_RESPONSE_HEADERS) {
    headers.delete(headerName);
  }

  const location = headers.get("location");
  if (location) {
    const rewrittenLocation = rewriteNavigationalUrl(location, targetUrl, requestUrl.origin, requestUrl);
    headers.set("location", rewrittenLocation);
  }

  const setCookie = headers.get("set-cookie");
  if (setCookie) {
    headers.set("set-cookie", rewriteSetCookie(setCookie));
  }

  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("referrer-policy", "unsafe-url");
  return headers;
}

export function restorePassthroughContentMetadata(headers, sourceHeaders, mimeType) {
  const identityContentLength = sourceHeaders.get("x-identity-content-length");
  if (!identityContentLength || !/^\d+$/.test(identityContentLength)) {
    return;
  }

  const contentDisposition = headers.get("content-disposition") || "";
  const isAttachment = /(^|;)\s*attachment\b/i.test(contentDisposition);
  const isRewrittenText = mimeType === "text/html" || isCssMimeType(mimeType);
  if (isRewrittenText || !isAttachment) {
    return;
  }

  if (!headers.has("content-range")) {
    headers.set("content-length", identityContentLength);
    return;
  }

  headers.set(
    "content-range",
    headers.get("content-range").replace(/\/\d+$/, `/${identityContentLength}`),
  );
}

export function normalizeAttachmentValidationHeaders(headers, sourceHeaders, mimeType) {
  const contentDisposition = headers.get("content-disposition") || "";
  const isAttachment = /(^|;)\s*attachment\b/i.test(contentDisposition);
  const isRewrittenText = mimeType === "text/html" || isCssMimeType(mimeType);
  if (!isAttachment || isRewrittenText) {
    return;
  }

  const sourceEtag = sourceHeaders.get("etag") || headers.get("etag");
  if (!sourceEtag) {
    return;
  }

  const normalizedEtag = sourceEtag.replace(/^W\//i, "");
  headers.set("etag", normalizedEtag);
}

export function extractTotalLengthFromContentRange(contentRange) {
  if (!contentRange) {
    return null;
  }

  const match = contentRange.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

export function getNormalizedSingletonHeaderValue(headers, headerName) {
  const value = headers.get(headerName) || "";
  return value ? takeFirstCombinedHeaderValue(value) : "";
}

export function isCssMimeType(mimeType) {
  return mimeType === "text/css";
}

function rewriteAbsoluteUrls(text, targetUrl, proxyOrigin) {
  const targetOrigin = targetUrl.origin;
  const targetHost = escapeRegExp(targetUrl.host);
  const schemeLessTargetOrigin = `//${targetUrl.host}`;
  const proxyOriginForTarget = toProxyOrigin(targetUrl, proxyOrigin);

  let rewritten = text;
  rewritten = rewritten.replaceAll(targetOrigin, proxyOriginForTarget);
  rewritten = rewritten.replace(new RegExp(`(["'\\(=:\\s])//${targetHost}`, "g"), `$1${proxyOriginForTarget}`);
  rewritten = rewritten.replaceAll(schemeLessTargetOrigin, proxyOriginForTarget);
  return rewritten;
}

function rewriteCssRootRelativeUrls(text, targetUrl, proxyOrigin) {
  const rootProxyPath = toProxyPath(targetUrl.origin + "/").replace(/\/$/, "");
  return text
    .replace(/url\((['"]?)(\/(?!\/)[^)'"\s]+)\1\)/g, (_match, quote, path) => `url(${quote}${rootProxyPath}${path}${quote})`)
    .replace(/@import\s+(['"])(\/(?!\/)[^'"]+)\1/g, (_match, quote, path) => `@import ${quote}${rootProxyPath}${path}${quote}`);
}

function rewriteSetCookie(cookie) {
  return cookie
    .replace(/Domain=[^;]+/ig, "")
    .replace(/;\s*SameSite=None/ig, "; SameSite=Lax")
    .replace(/;\s*Partitioned/ig, "")
    .replace(/;;+/g, ";");
}

function rewriteNavigationalUrl(value, currentTargetUrl, proxyOrigin, requestUrl = null) {
  const candidate = safeResolveUrl(value, currentTargetUrl);
  if (!candidate) {
    return value;
  }

  if (isAlreadyProxiedUrl(candidate, proxyOrigin)) {
    return candidate.toString();
  }

  if (!isHttpProtocol(candidate.protocol)) {
    return value;
  }

  const proxiedLocation = toProxyUrl(candidate, proxyOrigin);
  if (requestUrl && proxiedLocation === requestUrl.toString()) {
    return candidate.toString();
  }

  return proxiedLocation;
}

function normalizeSingletonResponseHeaders(headers) {
  const contentType = headers.get("content-type");
  if (contentType) {
    headers.set("content-type", takeFirstCombinedHeaderValue(contentType));
  }
}

function takeFirstCombinedHeaderValue(value) {
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) {
    return value.trim();
  }

  return value.slice(0, commaIndex).trim();
}

function normalizeHtmlRewriteResponse(upstreamResponse) {
  const contentType = upstreamResponse.headers.get("content-type");
  if (!contentType || !contentType.includes(",")) {
    return upstreamResponse;
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.set("content-type", takeFirstCombinedHeaderValue(contentType));
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

class AttributeRewriter {
  constructor(attributeName, currentTargetUrl, proxyOrigin) {
    this.attributeName = attributeName;
    this.currentTargetUrl = currentTargetUrl;
    this.proxyOrigin = proxyOrigin;
  }

  element(element) {
    const value = element.getAttribute(this.attributeName);
    if (!value) {
      return;
    }

    const rewrittenValue = rewriteAttributeValue(value, this.currentTargetUrl, this.proxyOrigin);
    if (rewrittenValue) {
      element.setAttribute(this.attributeName, rewrittenValue);
    }
  }
}

class SrcsetRewriter {
  constructor(attributeName, currentTargetUrl, proxyOrigin) {
    this.attributeName = attributeName;
    this.currentTargetUrl = currentTargetUrl;
    this.proxyOrigin = proxyOrigin;
  }

  element(element) {
    const value = element.getAttribute(this.attributeName);
    if (!value) {
      return;
    }

    const rewritten = rewriteSrcsetValue(value, this.currentTargetUrl, this.proxyOrigin);
    if (rewritten !== value) {
      element.setAttribute(this.attributeName, rewritten);
    }
  }
}

class StyleAttributeRewriter {
  constructor(currentTargetUrl, proxyOrigin) {
    this.currentTargetUrl = currentTargetUrl;
    this.proxyOrigin = proxyOrigin;
  }

  element(element) {
    const value = element.getAttribute("style");
    if (!value) {
      return;
    }

    const rewritten = rewriteCssRootRelativeUrls(
      rewriteAbsoluteUrls(value, this.currentTargetUrl, this.proxyOrigin),
      this.currentTargetUrl,
      this.proxyOrigin,
    );
    if (rewritten !== value) {
      element.setAttribute("style", rewritten);
    }
  }
}

class MetaRefreshRewriter {
  constructor(currentTargetUrl, proxyOrigin) {
    this.currentTargetUrl = currentTargetUrl;
    this.proxyOrigin = proxyOrigin;
  }

  element(element) {
    const httpEquiv = element.getAttribute("http-equiv");
    if (!httpEquiv || httpEquiv.toLowerCase() !== "refresh") {
      return;
    }

    const content = element.getAttribute("content");
    if (!content) {
      return;
    }

    const rewritten = content.replace(
      /url\s*=\s*(.+)$/i,
      (_match, value) => `url=${rewriteAttributeValue(value.trim(), this.currentTargetUrl, this.proxyOrigin) || value.trim()}`,
    );
    element.setAttribute("content", rewritten);
  }
}

class MetaNameRewriter {
  element(element) {
    const name = element.getAttribute("name");
    if (!name || name.toLowerCase() !== "referrer") {
      return;
    }

    element.setAttribute("content", "unsafe-url");
  }
}

class HeadInjector {
  constructor(currentTargetUrl, proxyOrigin) {
    this.currentTargetUrl = currentTargetUrl;
    this.proxyOrigin = proxyOrigin;
  }

  element(element) {
    element.prepend(`<script>${buildRuntimeShim(this.currentTargetUrl, this.proxyOrigin)}</script>`, {
      html: true,
    });
  }
}

function rewriteAttributeValue(value, currentTargetUrl, proxyOrigin) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("data:") || trimmed.startsWith("javascript:") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return null;
  }

  const candidateUrl = safeResolveUrl(trimmed, currentTargetUrl);
  if (!candidateUrl || !isHttpProtocol(candidateUrl.protocol)) {
    return null;
  }

  if (isAlreadyProxiedUrl(candidateUrl, proxyOrigin)) {
    return candidateUrl.toString();
  }

  return toProxyUrl(candidateUrl, proxyOrigin);
}

function rewriteSrcsetValue(value, currentTargetUrl, proxyOrigin) {
  return value.replace(/(^|,)\s*([^\s,]+)([^,]*)/g, (match, prefix, urlPart, descriptorPart) => {
    const rewrittenUrl = rewriteAttributeValue(urlPart, currentTargetUrl, proxyOrigin);
    if (!rewrittenUrl) {
      return match;
    }

    return `${prefix} ${rewrittenUrl}${descriptorPart}`;
  });
}

function buildRuntimeShim(currentTargetUrl, proxyOrigin) {
  const target = JSON.stringify(currentTargetUrl.href);
  const origin = JSON.stringify(proxyOrigin);

  return `(function () {
  var proxyOrigin = ${origin};
  var currentTarget = new URL(${target});

  function isAlreadyProxied(value) {
    if (value.origin !== proxyOrigin) {
      return false;
    }
    var parts = value.pathname.split('/').filter(Boolean);
    return parts.length >= 2 && (parts[0] === 'http' || parts[0] === 'https');
  }

  function isHttpUrl(url) {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  function restoreTargetOrigin(value) {
    if (value.origin !== proxyOrigin || isAlreadyProxied(value)) {
      return value;
    }
    return new URL(value.pathname + value.search + value.hash, currentTarget.origin + '/');
  }

  function toProxy(input, base) {
    try {
      var value = input instanceof URL ? input : new URL(String(input), base || currentTarget);
      value = restoreTargetOrigin(value);
      if (isAlreadyProxied(value)) {
        return value.toString();
      }
      if (!isHttpUrl(value)) {
        return String(input);
      }
      return proxyOrigin + '/' + value.protocol.slice(0, -1) + '/' + value.host + value.pathname + value.search + value.hash;
    } catch (_error) {
      return String(input);
    }
  }

  function rewriteArg(value) {
    if (typeof value === 'string' || value instanceof URL) {
      return toProxy(value, currentTarget);
    }
    return value;
  }

  function rewriteDomUrlAttribute(element, attributeName, value) {
    if (typeof value !== 'string') {
      return value;
    }
    var lowerName = String(attributeName || '').toLowerCase();
    if (lowerName !== 'src' && lowerName !== 'href' && lowerName !== 'poster' && lowerName !== 'action') {
      return value;
    }
    return rewriteArg(value);
  }

  function normalizeFormAction(form) {
    var actionAttr = form.getAttribute('action');
    if (actionAttr && actionAttr.trim()) {
      return actionAttr;
    }
    return currentTarget.pathname + currentTarget.search + currentTarget.hash;
  }

  function prepareFormForSubmission(form) {
    if (!form || typeof form.getAttribute !== 'function') {
      return;
    }

    var action = normalizeFormAction(form);
    form.setAttribute('action', rewriteArg(action));
  }

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' || input instanceof URL) {
      return nativeFetch.call(this, rewriteArg(input), init);
    }
    if (input instanceof Request) {
      var proxiedUrl = rewriteArg(input.url);
      return nativeFetch.call(this, new Request(proxiedUrl, input), init);
    }
    return nativeFetch.call(this, input, init);
  };

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    arguments[1] = rewriteArg(url);
    return nativeOpen.apply(this, arguments);
  };

  var NativeWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    var normalized = new URL(String(url), currentTarget);
    normalized.protocol = normalized.protocol === 'http:' ? 'ws:' : normalized.protocol === 'https:' ? 'wss:' : normalized.protocol;
    var proxied = toProxy(normalized.href.replace(/^ws/, 'http'), currentTarget).replace(/^http/, 'ws');
    return protocols === undefined ? new NativeWebSocket(proxied) : new NativeWebSocket(proxied, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;

  var NativeEventSource = window.EventSource;
  window.EventSource = function (url, config) {
    return new NativeEventSource(rewriteArg(url), config);
  };
  window.EventSource.prototype = NativeEventSource.prototype;

  var nativeOpenWindow = window.open;
  window.open = function (url, targetName, features) {
    if (url != null) {
      url = rewriteArg(url);
    }
    return nativeOpenWindow.call(this, url, targetName, features);
  };

  var nativePushState = history.pushState;
  var nativeReplaceState = history.replaceState;
  history.pushState = function (state, title, url) {
    if (url != null) {
      url = rewriteArg(url);
    }
    return nativePushState.call(this, state, title, url);
  };
  history.replaceState = function (state, title, url) {
    if (url != null) {
      url = rewriteArg(url);
    }
    return nativeReplaceState.call(this, state, title, url);
  };

  var nativeAssign = window.location.assign.bind(window.location);
  var nativeReplace = window.location.replace.bind(window.location);
  window.location.assign = function (url) {
    return nativeAssign(rewriteArg(url));
  };
  window.location.replace = function (url) {
    return nativeReplace(rewriteArg(url));
  };

  var nativeFormSubmit = window.HTMLFormElement && window.HTMLFormElement.prototype.submit;
  if (nativeFormSubmit) {
    window.HTMLFormElement.prototype.submit = function () {
      prepareFormForSubmission(this);
      return nativeFormSubmit.call(this);
    };
  }

  var nativeRequestSubmit = window.HTMLFormElement && window.HTMLFormElement.prototype.requestSubmit;
  if (nativeRequestSubmit) {
    window.HTMLFormElement.prototype.requestSubmit = function (submitter) {
      prepareFormForSubmission(this);
      return nativeRequestSubmit.call(this, submitter);
    };
  }

  var nativeSetAttribute = window.Element && window.Element.prototype.setAttribute;
  if (nativeSetAttribute) {
    window.Element.prototype.setAttribute = function (name, value) {
      if (arguments.length >= 2) {
        arguments[1] = rewriteDomUrlAttribute(this, name, value);
      }
      return nativeSetAttribute.apply(this, arguments);
    };
  }

  function wrapUrlPropertySetter(prototype, propertyName) {
    if (!prototype) {
      return;
    }
    var descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    if (!descriptor || typeof descriptor.set !== 'function' || typeof descriptor.get !== 'function') {
      return;
    }

    Object.defineProperty(prototype, propertyName, {
      configurable: descriptor.configurable !== false,
      enumerable: descriptor.enumerable === true,
      get: descriptor.get,
      set: function (value) {
        descriptor.set.call(this, rewriteDomUrlAttribute(this, propertyName, value));
      }
    });
  }

  wrapUrlPropertySetter(window.HTMLScriptElement && window.HTMLScriptElement.prototype, 'src');
  wrapUrlPropertySetter(window.HTMLImageElement && window.HTMLImageElement.prototype, 'src');
  wrapUrlPropertySetter(window.HTMLImageElement && window.HTMLImageElement.prototype, 'srcset');
  wrapUrlPropertySetter(window.HTMLLinkElement && window.HTMLLinkElement.prototype, 'href');
  wrapUrlPropertySetter(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'src');
  wrapUrlPropertySetter(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'srcset');
  wrapUrlPropertySetter(window.HTMLIFrameElement && window.HTMLIFrameElement.prototype, 'src');
  wrapUrlPropertySetter(window.HTMLFormElement && window.HTMLFormElement.prototype, 'action');

  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) {
      return;
    }
    var href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    anchor.setAttribute('href', rewriteArg(href));
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || typeof form.getAttribute !== 'function') {
      return;
    }

    prepareFormForSubmission(form);
  }, true);
})();`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
