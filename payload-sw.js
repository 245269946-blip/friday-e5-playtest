// Recreate the original Godot files from content-addressed gzip parts.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

let manifest;
function loadManifest() {
  manifest ??= fetch('./payload-manifest.json', { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error('游戏资源清单下载失败。');
    return response.json();
  }).catch((error) => {
    manifest = undefined;
    throw error;
  });
  return manifest;
}

async function originalFile(name) {
  const { files } = await loadManifest();
  const asset = files[name];
  const cache = await caches.open('friday-e5-payload-v1').catch(() => null);
  let index = 0;
  let reader = null;
  let cacheWrite;

  const compressed = new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (index === asset.parts.length) {
            controller.close();
            return;
          }
          const url = new URL(asset.parts[index++], self.registration.scope);
          let response = await cache?.match(url);
          if (!response) {
            response = await fetch(url);
            if (!response.ok) throw new Error('游戏资源下载失败。请刷新重试。');
            if (cache) cacheWrite = cache.put(url, response.clone()).catch(() => undefined);
          }
          reader = response.body.getReader();
        }
        const { value, done } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        reader = null;
        await cacheWrite;
        cacheWrite = undefined;
      }
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
  return new Response(compressed.pipeThrough(new DecompressionStream('gzip')), {
    headers: {
      'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
      'Content-Length': String(asset.bytes),
      'Cache-Control': 'no-store',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  for (const name of ['index.pck', 'index.wasm']) {
    if (url.href === new URL(name, self.registration.scope).href) {
      event.respondWith(originalFile(name));
      return;
    }
  }
});
