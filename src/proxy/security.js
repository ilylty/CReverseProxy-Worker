import { isHttpProtocol } from "./url.js";

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

export function enforceTargetPolicy(targetUrl) {
  if (!isHttpProtocol(targetUrl.protocol)) {
    throw new Error("Unsupported protocol");
  }

  if (!isAllowedPort(targetUrl)) {
    throw new Error("Unsupported port");
  }

  const hostname = targetUrl.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("Blocked hostname");
  }

  if (isBlockedIpLiteral(hostname)) {
    throw new Error("Blocked IP address");
  }
}

function isAllowedPort(targetUrl) {
  return targetUrl.port === "" || targetUrl.port === "80" || targetUrl.port === "443";
}

function isBlockedIpLiteral(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const octets = hostname.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }

  if (/^\[[0-9a-f:]+\]$/i.test(hostname)) {
    const normalized = hostname.toLowerCase();
    return normalized === "[::1]" || normalized.startsWith("[fc") || normalized.startsWith("[fd") || normalized.startsWith("[fe80:");
  }

  return false;
}
