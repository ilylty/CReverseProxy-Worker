import { toProxyUrl } from "./proxy/url.js";

const HOME_WALLPAPER_FALLBACK_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuAo29WTKrrnFgq85-0kTYKtx0OrXtSdgI0zIg6oihcNP5hBDQpZRNIxURPq5pY9V-LowO-__FcQShRFkqzuVB6Ca9rIgAK-XZlWUlqVPY2LgCmB2Hw0g_dhKZnUNl275Or25SF89NsqtgRnYGADTCJILh4SM9tvQMhbbPWa-XQnYF3YAxFR-8Jb8XBUoDizFvABD4gHIRD9LANhBx9cCGBiSWYTLNpMshSmpp5yNs4-KxZTJM8fmIEGX06R4v4P3I0ZKKzdE2VigKo";
const HOME_WALLPAPER_API_URL =
  "https://binary-proxy-3.1415926.ddns-ip.net/?url=https%3A%2F%2Fapi%2Elimestart%2Ecn%2Fbackend%2Fbing-wallpaper-v3%3Flang%3Dzh-CN&_proxy_referer=https%3A%2F%2Fwww%2Elimestart%2Ecn%2F&_proxy_origin=https%3A%2F%2Fwww%2Elimestart%2Ecn&_proxy_User-Agent=Mozilla%2F5%2E0%20%28Windows%20NT%2010%2E0%3B%20Win64%3B%20x64%29%20AppleWebKit%2F537%2E36%20%28KHTML%2C%20like%20Gecko%29%20Chrome%2F132%2E0%2E0%2E0%20Safari%2F537%2E36";
const DEBUG_FETCH = false;

export async function renderHome(proxyOrigin) {
  const wallpaper = await fetchHomeWallpaper();
  const recommendedSites = [
    {
      label: "DuckDuckGo",
      url: "https://duckduckgo.com/",
      description: "Search & jump portal for private browsing.",
      icon: "shield_with_heart",
      iconClass: "bg-orange-500/20 text-orange-400 group-hover:bg-orange-500/30",
    },
    {
      label: "Wikipedia",
      url: "https://www.wikipedia.org/",
      description: "Encyclopedia & quick lookup for reliable information.",
      icon: "menu_book",
      iconClass: "bg-primary/20 text-primary group-hover:bg-primary/30",
    },
    {
      label: "GitHub Trending",
      url: "https://github.com/trending",
      description: "Popular open source projects and code communities.",
      icon: "terminal",
      iconClass: "bg-on-surface/10 text-on-surface group-hover:bg-on-surface/20",
    },
    {
      label: "Hacker News",
      url: "https://news.ycombinator.com/",
      description: "Tech community insights and global industry news.",
      icon: "newspaper",
      iconClass: "bg-tertiary-container/20 text-tertiary group-hover:bg-tertiary-container/30",
    },
    {
      label: "MDN Web Docs",
      url: "https://developer.mozilla.org/",
      description: "Frontend and Web documentation for developers.",
      icon: "code_blocks",
      iconClass: "bg-secondary-container/30 text-secondary group-hover:bg-secondary-container/40",
    },
    {
      label: "Cloudflare Docs",
      url: "https://developers.cloudflare.com/",
      description: "Workers and platform edge documentation.",
      icon: "cloud_done",
      iconClass: "bg-primary-container/20 text-primary-container group-hover:bg-primary-container/30",
    },
  ];
  const recommendedMarkup = recommendedSites
    .map(
      ({ label, url, description, icon, iconClass }) => `<a class="glass-panel rounded-xl p-6 flex items-start gap-4 hover:scale-[1.02] hover:bg-white/10 hover:backdrop-blur-2xl transition-all duration-300 group" href="${escapeHtml(toProxyUrl(url, proxyOrigin))}">
        <div class="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${escapeHtml(iconClass)}">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">${escapeHtml(icon)}</span>
        </div>
        <div>
          <h3 class="font-headline-lg text-[18px] text-on-surface font-semibold mb-1">${escapeHtml(label)}</h3>
          <p class="font-body-md text-sm text-on-surface-variant/80">${escapeHtml(description)}</p>
        </div>
      </a>`
    )
    .join("");
  const wallpaperUrl = JSON.stringify(wallpaper.url);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Portal | High-Speed Encrypted Access</title>
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
  <style>
    @import url(https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap);

    :root { color-scheme: dark; }

    body {
      font-family: "Geist", sans-serif;
      margin: 0;
      padding: 0;
      overflow-x: hidden;
    }

    .material-symbols-outlined {
      font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
    }

    .glass-panel {
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .glass-panel-heavy {
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .hero-bg {
      background-image: url(${wallpaperUrl});
      background-size: cover;
      background-position: center;
      background-attachment: fixed;
    }

    .search-submit {
      display: inline-flex;
      width: auto;
      align-self: flex-end;
      flex: 0 0 auto;
      justify-content: center;
      border: 0;
      border-radius: 9999px;
      background: #8ed5ff;
      color: #00354a;
      text-align: center;
    }

    .search-submit:hover {
      background: #38bdf8;
    }

    @media (min-width: 640px) {
      .search-input-shell {
        flex: 1 1 auto;
      }

      .search-submit {
        width: fit-content;
        align-self: auto;
      }
    }
  </style>
  <script>
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "secondary-fixed-dim": "#bdc2ff",
            "on-secondary-container": "#a8afff",
            tertiary: "#ffc176",
            "surface-bright": "#363a3b",
            "error-container": "#93000a",
            secondary: "#bdc2ff",
            "inverse-on-surface": "#2d3133",
            "outline-variant": "#3e484f",
            "tertiary-fixed-dim": "#ffb960",
            "on-secondary": "#131e8c",
            "on-surface": "#e0e3e5",
            "on-tertiary-container": "#613b00",
            "on-primary-fixed-variant": "#004c69",
            "on-tertiary": "#472a00",
            "primary-container": "#38bdf8",
            "surface-container-low": "#191c1e",
            outline: "#87929a",
            "on-primary-container": "#004965",
            "on-secondary-fixed": "#000767",
            error: "#ffb4ab",
            "tertiary-container": "#f1a02b",
            "on-primary-fixed": "#001e2c",
            "surface-container-lowest": "#0b0f10",
            "secondary-container": "#2f3aa3",
            primary: "#8ed5ff",
            "on-primary": "#00354a",
            "inverse-surface": "#e0e3e5",
            "surface-variant": "#323537",
            "surface-container-highest": "#323537",
            "surface-dim": "#101415",
            "secondary-fixed": "#e0e0ff",
            "on-tertiary-fixed": "#2a1700",
            "on-secondary-fixed-variant": "#2f3aa3",
            "tertiary-fixed": "#ffddb8",
            "surface-tint": "#7bd0ff",
            "surface-container-high": "#272a2c",
            "surface-container": "#1d2022",
            "on-error-container": "#ffdad6",
            "on-background": "#e0e3e5",
            "on-error": "#690005",
            "inverse-primary": "#00668a",
            "primary-fixed": "#c4e7ff",
            "on-tertiary-fixed-variant": "#653e00",
            "on-surface-variant": "#bdc8d1",
            surface: "#101415",
            background: "#101415",
            "primary-fixed-dim": "#7bd0ff",
          },
          borderRadius: {
            DEFAULT: "0.25rem",
            lg: "0.5rem",
            xl: "0.75rem",
            full: "9999px",
          },
          spacing: {
            "stack-xl": "64px",
            "stack-md": "32px",
            "container-max": "1100px",
            "margin-mobile": "16px",
            gutter: "24px",
          },
          fontFamily: {
            "headline-lg-mobile": ["Geist"],
            "body-md": ["Geist"],
            display: ["Geist"],
            "label-md": ["Geist"],
            "headline-lg": ["Geist"],
          },
          fontSize: {
            "headline-lg-mobile": ["24px", { lineHeight: "1.2", fontWeight: "600" }],
            "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
            display: ["48px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
            "label-md": ["14px", { lineHeight: "1", letterSpacing: "0.05em", fontWeight: "500" }],
            "headline-lg": ["32px", { lineHeight: "1.2", fontWeight: "600" }],
          },
        },
      },
    };
  </script>
</head>
<body class="bg-background text-on-background selection:bg-primary/30 min-h-screen hero-bg">
  <div class="fixed inset-0 bg-black/30 pointer-events-none"></div>
  <main class="relative z-10 pt-32 pb-stack-xl flex flex-col items-center">
    <section class="w-full max-w-container-max px-margin-mobile md:px-gutter flex flex-col items-center mb-stack-xl">
      <div class="mb-8 flex justify-center w-full">
        <div class="flex flex-col items-center gap-6">
          <h1 class="text-6xl md:text-8xl font-black tracking-tightest text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-primary-fixed-dim/50 drop-shadow-[0_0_15px_rgba(255,255,255,0.15)] text-center transition-all duration-700 hover:tracking-tighter">Cloudflare Reverse Proxy</h1>
        </div>
      </div>
      <form method="get" action="/" class="w-full max-w-3xl glass-panel-heavy rounded-[28px] sm:rounded-full p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-0 group transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/50">
        <div class="search-input-shell flex items-center min-h-[54px] min-w-0 rounded-[20px] sm:rounded-full px-4 sm:px-6 bg-white/0 sm:bg-transparent border border-white/10 sm:border-0">
          <span class="material-symbols-outlined text-on-surface-variant shrink-0">search</span>
          <input name="url" type="text" inputmode="search" autocapitalize="off" autocomplete="off" spellcheck="false" class="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-on-background placeholder:text-on-surface-variant/50 px-3 sm:px-4 font-body-md text-body-md min-w-0" placeholder="Search the web securely..." required>
        </div>
        <button type="submit" class="search-submit font-label-md text-label-md px-8 py-3 transition-all duration-200 active:scale-95 whitespace-nowrap shadow-lg shadow-primary/20">Search</button>
      </form>
    </section>
    <section class="w-full max-w-container-max px-margin-mobile md:px-gutter">
      <h2 class="font-headline-lg text-headline-lg mb-8 text-on-background/90 text-center md:text-left">Recommended</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        ${recommendedMarkup}
      </div>
    </section>
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function fetchHomeWallpaper() {
  const fallbackWallpaper = {
    url: HOME_WALLPAPER_FALLBACK_URL,
    title: "首页背景",
    copyright: "Fallback wallpaper",
  };

  try {
    const fetchInit = {
      headers: {
        accept: "application/json",
      },
    };
    debugLogFetchInput("home-wallpaper", HOME_WALLPAPER_API_URL, fetchInit);
    const response = await fetch(HOME_WALLPAPER_API_URL, fetchInit);

    if (!response.ok) {
      return fallbackWallpaper;
    }

    const payload = await response.json();
    const image = payload?.info?.images?.[0];
    if (!image?.url) {
      return fallbackWallpaper;
    }

    return {
      url: image.url.startsWith("http") ? image.url : `https://www.bing.com${image.url}`,
      title: image.title || "Bing Daily Wallpaper",
      copyright: image.copyright || "",
    };
  } catch {
    return fallbackWallpaper;
  }
}

function debugLogFetchInput(label, input, init) {
  if (!DEBUG_FETCH) {
    return;
  }

  try {
    console.log(`[debug:fetch:${label}]`, JSON.stringify(serializeFetchInput(input, init)));
  } catch (error) {
    console.log(`[debug:fetch:${label}]`, "failed to serialize fetch input", error?.message || String(error));
  }
}

function serializeFetchInput(input, init) {
  const request = input instanceof Request ? input : null;
  return {
    input: request
      ? {
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          bodyUsed: request.bodyUsed,
          hasBody: request.body !== null,
        }
      : {
          type: typeof input,
          value: String(input),
        },
    init: init ? serializeRequestInit(init) : undefined,
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
