/**
 * 可选的 CORS 转发代理（Cloudflare Pages Function，路径 /api/proxy）
 *
 * 只有在部署时配置了环境变量 PROXY_ALLOWED_HOSTS 才会启用，否则一律返回 404。
 * - PROXY_ALLOWED_HOSTS：允许转发的目标域名，逗号分隔，例如 "api.deepseek.com,api.openai.com"
 * - PROXY_TOKEN（可选）：访问口令；设置后前端需在「设置 → 模型服务 → 代理」中填写相同口令
 *
 * 代理只转发、不记录、不存储；请求体与响应体都以流的形式透传。
 */

interface Env {
  PROXY_ALLOWED_HOSTS?: string;
  PROXY_TOKEN?: string;
}

interface Context { request: Request; env: Env }

const DROP_REQUEST_HEADERS = ['host', 'cookie', 'origin', 'referer', 'x-target-url', 'x-proxy-token', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip'];
const PASS_RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after', 'x-request-id', 'request-id'];

export const onRequest = async ({ request, env }: Context): Promise<Response> => {
  const allowed = (env.PROXY_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return new Response('Not found', { status: 404 });
  if (env.PROXY_TOKEN && request.headers.get('x-proxy-token') !== env.PROXY_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }
  let target: URL;
  try { target = new URL(request.headers.get('x-target-url') || ''); } catch { return new Response('Missing x-target-url', { status: 400 }); }
  if (target.protocol !== 'https:') return new Response('Only https targets are allowed', { status: 400 });
  if (!allowed.includes(target.hostname.toLowerCase())) return new Response(`Host not allowed: ${target.hostname}`, { status: 403 });

  const headers = new Headers(request.headers);
  for (const h of DROP_REQUEST_HEADERS) headers.delete(h);
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
  const out = new Headers();
  for (const h of PASS_RESPONSE_HEADERS) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  out.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: out });
};
