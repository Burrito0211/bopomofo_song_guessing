/**
 * 即時競賽的伺服器端。平常這個網站是純靜態的，但「第一個答對的人拿分」
 * 一定要有一個公正第三方來排先後順序，所以多了這支 Worker。
 *
 * 路由：
 *   /api/room/<CODE>/ws   → WebSocket，交給該房間的 Durable Object
 *   其他                   → 照舊回傳靜態檔案
 *
 * 一個房間 = 一個 Durable Object，用房號當 id，所以同一個房號的人一定
 * 會連到同一個實例，順序才有意義。
 */
import { Room } from './room.js';

export { Room };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/room\/([0-9A-Za-z]{1,8})\/ws$/);

    if (match) {
      const code = match[1].toUpperCase();
      const id = env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
