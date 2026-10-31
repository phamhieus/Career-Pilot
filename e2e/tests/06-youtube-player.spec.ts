import { expect, test } from '@playwright/test';
import { parseYouTubeUrl } from '../../apps/web/src/lib/youtube';
import { api, signUp } from './helpers';

const PYTHON = 'PLhQjrBD2T3817j24-GogXmWqO5Q5vYy0V';

test('TC-YT-01 supports playlists, watch links and short links without embedding arbitrary origins', () => {
  const playlist = parseYouTubeUrl(`https://www.youtube.com/watch?v=OvKCESUCWII&list=${PYTHON}`)!;
  expect(playlist.kind).toBe('playlist');
  expect(new URL(playlist.embedUrl).hostname).toBe('www.youtube-nocookie.com');
  expect(new URL(playlist.embedUrl).searchParams.get('list')).toBe(PYTHON);
  expect(parseYouTubeUrl('https://youtu.be/OvKCESUCWII')?.kind).toBe('video');
  expect(parseYouTubeUrl('https://www.youtube.com/shorts/OvKCESUCWII')?.kind).toBe('video');
  expect(parseYouTubeUrl('https://www.youtube-nocookie.com/embed/OvKCESUCWII')?.kind).toBe('video');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=OvKCESUCWII', 'https://evil.test/playlist?list=' + PYTHON, 'https://user:pass@youtube.com/watch?v=OvKCESUCWII', 'http://youtube.com/watch?v=OvKCESUCWII', 'https://youtube.com/watch?v=invalid', 'https://youtube.com/results?list=' + PYTHON]) expect(parseYouTubeUrl(url)).toBeNull();
});

test('TC-YT-02 embeds a recommended series, remembers selection, and supports a custom playlist', async ({ page }) => {
  // Verify our player integration independently of third-party network availability.
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>Playlist player fixture</body></html>' }));
  await signUp(page, { sample: true });
  // An existing document-first plan must also expose the embedded series.
  const plan = await api(page, 'post', '/api/learning', { roleSlug: 'ai-engineer', learningFormat: 'docs' });
  await page.goto(`/learning/${plan.id}`);
  const player = page.getByRole('region', { name: 'YouTube learning player for AI Engineer', exact: true });
  const frame = player.locator('iframe');
  await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/videoseries\?list=PLlrx/);
  await expect(frame).toHaveAttribute('allowfullscreen', '');
  await player.getByRole('combobox').selectOption('cs50-python');
  await expect(frame).toHaveAttribute('src', new RegExp(PYTHON));
  await page.reload();
  await expect(player.getByRole('combobox')).toHaveValue('cs50-python');
  await expect(frame).toHaveAttribute('src', new RegExp(PYTHON));
  await player.getByText('Use another YouTube playlist or video', { exact: true }).click();
  await player.getByLabel('YouTube playlist or video URL', { exact: true }).fill('https://evil.test/video');
  await player.getByRole('button', { name: 'Watch here', exact: true }).click();
  await expect(player.getByRole('alert')).toBeVisible();
  await player.getByLabel('YouTube playlist or video URL', { exact: true }).fill('https://www.youtube.com/playlist?list=PLhQjrBD2T382v1MBjNOhPu9SiJ1fsD4C0');
  await player.getByRole('button', { name: 'Watch here', exact: true }).click();
  await expect(frame).toHaveAttribute('src', /list=PLhQjrBD2T382v1MBjNOhPu9SiJ1fsD4C0/);
  await page.getByText('Choose learning material: documents, project or YouTube', { exact: true }).first().click();
  await page.getByRole('button', { name: 'YouTube videos', exact: true }).first().click();
  await expect(page.locator('iframe')).toHaveCount(2); // Main series + the opened task only.
  await page.getByText('Choose learning material: documents, project or YouTube', { exact: true }).first().click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const playerBox = await frame.boundingBox();
  expect(playerBox!.width).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/learning');
  await expect(player.locator('iframe')).toHaveAttribute('src', /list=PLhQjrBD2T382v1MBjNOhPu9SiJ1fsD4C0/);
  await expect(page.getByRole('link', { name: 'Open tasks & full learning plan' })).toHaveAttribute('href', `/learning/${plan.id}`);
});
