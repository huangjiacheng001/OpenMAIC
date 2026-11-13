import { expect, test } from '@playwright/test';

const events = [
  { type: 'status', status: 'answering' },
  { type: 'text', delta: '我们先试着每 5 个分一组。' },
  { type: 'done' },
];

test('one composer accepts text, retains failed input and sends a photo follow-up', async ({
  page,
}) => {
  const sent: Array<{ question: string; photo?: string; photoTurn?: number }> = [];
  await page.route('**/api/tutor', async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) {
      await route.fulfill({ status: 503, json: { code: 'unavailable' } });
      return;
    }
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    });
  });
  await page.goto('/');
  const question = page.getByRole('textbox', { name: '输入你的问题' });
  await question.fill('怎么按 5 个一组数数？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('可以再试一次');
  await expect(question).toHaveValue('怎么按 5 个一组数数？');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('我们先试着每 5 个分一组。', { exact: true })).toBeVisible();
  await expect(question).toHaveValue('');

  await page.getByTestId('tutor-photo-picker').setInputFiles({
    name: 'exercise.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a82sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByAltText('待发送的照片')).toBeVisible();
  await page.getByRole('button', { name: '发送照片', exact: true }).click();
  await expect(page.getByAltText('本轮题目照片')).toBeVisible();
  await expect(page.getByAltText('待发送的照片')).toHaveCount(0);
  expect(sent[2].photo).toMatch(/^data:image\/jpeg;base64,/);
  await question.fill('那 15 呢？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(question).toHaveValue('');
  expect(sent[3].photo).toBe(sent[2].photo);
  expect(sent[3].photoTurn).toBe(2);
  await page.getByRole('button', { name: '新对话' }).click();
  await expect(page.getByRole('link', { name: '课堂', exact: true })).toHaveAttribute(
    'href',
    '/courses',
  );
});

test('stopping a response keeps the draft and permits a new send', async ({ page }) => {
  let count = 0;
  let releaseFirst = () => {};
  await page.route('**/api/tutor', async (route) => {
    count += 1;
    if (count === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      await route.abort().catch(() => {});
      return;
    }
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    });
  });
  await page.goto('/');
  const question = page.getByRole('textbox', { name: '输入你的问题' });
  await question.fill('帮我想想分组的方法');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => count).toBe(1);
  try {
    await page.getByRole('button', { name: '停止回答' }).click();
    await expect(question).toHaveValue('帮我想想分组的方法');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(question).toHaveValue('');
    expect(count).toBe(2);
  } finally {
    releaseFirst();
  }
});

test('voice finish sends once and cancel ignores stale transcription', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSpeech {
      onstart?: () => void;
      onend?: () => void;
      onresult?: (event: { resultIndex: number; results: unknown[] }) => void;
      start() {
        this.onstart?.();
      }
      stop() {
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: '为什么天是蓝色的？' } }],
          });
          this.onend?.();
        }, 50);
      }
      abort() {
        this.stop();
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeSpeech, configurable: true });
  });
  const sent: string[] = [];
  await page.route('**/api/model-config', (route) =>
    route.fulfill({
      json: { slots: [{ slot: 'asr', effective: { status: 'unassigned' } }] },
    }),
  );
  await page.route('**/api/tutor', async (route) => {
    sent.push(route.request().postDataJSON().question);
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '语音', exact: true }).click();
  const finish = page.getByRole('button', { name: '说完了' });
  await expect(finish).toBeEnabled();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '语音', exact: true }).click();
  await finish.click();
  await expect(page.getByText('我们先试着每 5 个分一组。', { exact: true })).toBeVisible();
  expect(sent).toEqual(['为什么天是蓝色的？']);
});
