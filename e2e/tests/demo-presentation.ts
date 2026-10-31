import { expect, type Locator, type Page } from '@playwright/test';

// Recording-only presentation chrome. The application source and user records stay untouched.
export async function explain(page: Page, chapter: string, title: string, body: string) {
  await page.evaluate(({ chapter, title, body }) => {
    let panel = document.getElementById('demo-explanation');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'demo-explanation';
      panel.setAttribute('role', 'note');
      panel.style.cssText = 'position:fixed;z-index:2147483647;left:272px;right:32px;bottom:20px;padding:16px 22px;border:1px solid #42648a;border-left:4px solid #62aef0;border-radius:12px;background:rgba(12,20,31,.97);color:#f5f7fc;box-shadow:0 8px 32px #0009;font-family:Arial,sans-serif;pointer-events:none;';
      document.body.append(panel);
      // Let the final section scroll clear of the explanation panel.
      document.body.style.paddingBottom = '145px';
    }
    panel.replaceChildren();
    const label = document.createElement('div');
    label.style.cssText = 'font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#8ec5ff;margin-bottom:5px';
    label.textContent = chapter;
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:21px;line-height:1.25;font-weight:700;margin-bottom:5px';
    heading.textContent = title;
    const description = document.createElement('div');
    description.style.cssText = 'font-size:18px;line-height:1.4;color:#d4deec';
    description.textContent = body;
    panel.append(label, heading, description);
  }, { chapter, title, body });
  await expect(page.locator('#demo-explanation')).toContainText(title);
}

export async function focusSection(target: Locator, paced: boolean) {
  await expect(target).toBeVisible();
  await target.evaluate((element, paced) => {
    element.scrollIntoView({ behavior: paced ? 'smooth' : 'instant', block: 'center' });
  }, paced);
}
