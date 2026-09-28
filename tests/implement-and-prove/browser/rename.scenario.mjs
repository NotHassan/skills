export async function exercise({ page, baseURL, step, check, checkpoint }) {
  await step('Open workflow settings', async () => {
    await page.goto(baseURL);
    await page.getByRole('heading', { name: 'Workflow settings' }).waitFor();
  });
  await checkpoint('initial');
  await page.waitForTimeout(450); // Readability only, not a correctness signal.
  await step('Rename and save', async () => {
    await page.getByLabel('Name', { exact: true }).fill('Renamed Workflow');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  });
  await check('sidebar-updates', async () => {
    const observed = await page.getByTestId('sidebar-workflow-name').innerText();
    return { pass: observed === 'Renamed Workflow', observed };
  });
  await checkpoint('saved');
  await page.waitForTimeout(900); // Preserve the reported state visibly in the clip.
  await step('Reload to verify saved state', async () => {
    await page.reload();
    await page.getByRole('heading', { name: 'Workflow settings' }).waitFor();
  });
  await check('rename-persists', async () => {
    const observed = await page.getByTestId('sidebar-workflow-name').innerText();
    return { pass: observed === 'Renamed Workflow', observed };
  });
  await checkpoint('reloaded');
}
