const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const allowedHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

export function parseYouTubeVideoId(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Informe uma URL válida do YouTube.');
  }

  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())
    || url.username || url.password || url.port || url.hash) {
    throw new Error('Use uma URL HTTPS de um domínio oficial permitido do YouTube.');
  }

  let videoId: string | null = null;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 1) videoId = parts[0]!;
  } else if (url.pathname === '/watch') {
    const ids = url.searchParams.getAll('v');
    if (ids.length === 1) videoId = ids[0]!;
  } else {
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)$/);
    if (match) videoId = match[1]!;
  }

  if (!videoId || !videoIdPattern.test(videoId)) {
    throw new Error('O identificador do vídeo do YouTube é inválido.');
  }
  return videoId;
}
