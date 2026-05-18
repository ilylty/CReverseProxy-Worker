# Cloudflare Reverse Proxy Worker

这是一个运行在 Cloudflare Workers 上的页面代理，提供一个统一入口，将目标站点映射到当前域名下的代理路径。

## Demo

- 演示地址：`https://rpb.ilylty.bond/`

## 功能

- 首页输入目标网址或搜索词后，跳转到当前域名下的代理路径
- 代理普通 HTTP 请求
- 支持相对路径恢复，避免同源相对导航直接失效
- 重写 `Location` 跳转头
- 重写 HTML 属性里的 `href`、`src`、`srcset`、`action`、`poster`
- 注入前端 shim，兜底 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`window.open`、`history.pushState`、`history.replaceState`、表单提交
- 对 `text/html` 执行流式 HTMLRewriter 改写
- 对 `text/css` 做基础文本重写
- `text/event-stream` 走流式透传
- `websocket` 升级请求单独转发
- 拦截常见私网/本地地址和非 `80`、`443` 端口，避免明显 SSRF

## 路径格式

代理后的目标地址会映射为：

```text
https://rpb.ilylty.bond/https/github.com/
https://rpb.ilylty.bond/http/example.com/path?x=1
```

仓库当前依赖这个编码格式：

```text
/<scheme>/<host>/<path>?<query>
```

例如：

```text
/https/developer.mozilla.org/en-US/docs/
/http/example.com/demo?a=1&b=2
```

## Project Structure

这是一个单 Worker 项目，不是传统的 Node 服务端应用。运行入口由 `wrangler.jsonc` 指向 `src/index.js`。

- `src/index.js`：Worker 入口、请求分流、上游请求构建、重定向跟随、WebSocket 转发
- `src/home.js`：首页渲染和壁纸获取
- `src/proxy/url.js`：目标 URL 解析、代理路径编码、相对导航恢复
- `src/proxy/security.js`：SSRF 防护、端口限制、主机名和 IP 规则
- `src/proxy/rewrite.js`：HTML/CSS/响应头改写、浏览器 runtime shim 注入

## 本地开发

```bash
npx wrangler dev
```

## 部署

```bash
npx wrangler deploy
```

## 验证建议

如果你改了 URL 解析、重写逻辑或头处理，建议至少手动验证这些场景：

- 首页输入 URL 后正常跳转
- 代理页面里的相对静态资源可以加载
- 表单提交不会跳出代理路径
- 上游 30x 跳转能正常改写
- `text/event-stream` 可以持续透传
- `websocket` 升级请求可以建立连接

## 当前限制

- 复杂登录态、严格 CSP、强反爬站点不保证可用
- JS 重写不是通用 AST 级处理，无法覆盖所有动态运行时场景
- CSS 和 HTML 重写仍然是启发式处理，不可能覆盖所有前端框架行为
- `Set-Cookie` 当前只做了保守改写，复杂认证流程可能失败
- 某些站点依赖多域资源、Service Worker、SRI、浏览器完整同源语义时，代理可能仍会失效
