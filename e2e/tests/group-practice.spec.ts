import { expect, test } from '@playwright/test';

test('count groups, save a wrong attempt and clear it after a correct redo', async ({ page }) => {
  await page.goto('/practice/groups');
  await page.getByRole('button', { name: '10 个一组' }).click();
  const group = page.getByRole('button', { name: '第 1 组，10 个' });
  await group.press('Space');
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('已数 1 组')).toBeVisible();

  const answer = page.getByLabel('一共有', { exact: true });
  await answer.fill('２０');
  await answer.press('Enter');
  await expect(page.getByText('最近 1 次作答 · 待重做 1 道', { exact: false })).toBeVisible();
  await answer.press('Enter');
  await expect(page.getByText('最近 1 次作答 · 待重做 1 道', { exact: false })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '重做：3 组，每组 10 个' }).click();
  await expect(group).toHaveAttribute('aria-pressed', 'false');
  await answer.fill('30');
  await page.getByRole('button', { name: '提交答案' }).click();
  await expect(page.getByText('答对了！', { exact: false })).toBeVisible();
  await expect(page.getByText('最近 2 次作答 · 待重做 0 道', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '下一题' }).click();
  await expect(page.getByText('4 组，每组 10 个。一共有多少个？')).toBeVisible();
});
