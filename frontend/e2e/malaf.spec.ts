import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';

test('uploads, downloads, decrypts, and rejects a second download', async ({ page, context }) => {
  await page.goto('/');

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose file/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello malaf')
  });

  await page.getByRole('button', { name: /encrypt and upload/i }).click();
  const linkInput = page.getByLabel('Share link');
  await expect(linkInput).toHaveValue(/\/d\/[a-f0-9-]+#/);
  const shareLink = await linkInput.inputValue();

  const receiver = await context.newPage();
  await receiver.goto(shareLink);
  const downloadPromise = receiver.waitForEvent('download');
  await receiver.getByRole('button', { name: /^download$/i }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await expect(fs.readFile(path!, 'utf8')).resolves.toBe('hello malaf');

  await receiver.goto(shareLink);
  await expect(receiver.getByText(/expired or already used/i)).toBeVisible();
});
