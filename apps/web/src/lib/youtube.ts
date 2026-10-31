export interface YouTubeEmbed { embedUrl: string; watchUrl: string; kind: 'playlist' | 'video' }

/** Construct trusted embed URLs from YouTube links; never embed a supplied URL directly. */
export function parseYouTubeUrl(value: string): YouTubeEmbed | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'];
    if (!hosts.includes(url.hostname)) return null;
    const path = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'youtu.be' ? path.length !== 1 : !['watch', 'playlist', 'embed', 'shorts', 'live'].includes(path[0])) return null;
    const list = url.searchParams.get('list');
    if (list && /^[A-Za-z0-9_-]{10,100}$/.test(list)) {
      return { kind: 'playlist', embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&playsinline=1&rel=0`, watchUrl: `https://www.youtube.com/playlist?list=${list}` };
    }
    const video = url.hostname === 'youtu.be' ? path[0] : path[0] === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(path[0]) ? path[1] : null;
    if (!video || !/^[A-Za-z0-9_-]{11}$/.test(video)) return null;
    return { kind: 'video', embedUrl: `https://www.youtube-nocookie.com/embed/${video}?playsinline=1&rel=0`, watchUrl: `https://www.youtube.com/watch?v=${video}` };
  } catch { return null; }
}
