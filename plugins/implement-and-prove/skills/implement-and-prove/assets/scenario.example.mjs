// Adapt locators and setup to the actual application BEFORE sealing the contract.
// This illustrative scenario is not run automatically against an arbitrary app.
export async function exercise({ page, baseURL, step, check, checkpoint }) {
  await step('Open a deterministic test workflow', async () => {
    await page.goto(`${baseURL}/workflows/test-workflow`);
    await page.getByRole('heading', { name: 'Test Workflow' }).waitFor();
  });
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
  await step('Reload to verify persistence', async () => {
    await page.reload();
    await page.getByRole('heading', { name: 'Renamed Workflow' }).waitFor();
  });
  await check('rename-persists', async () => {
    const observed = await page.getByTestId('sidebar-workflow-name').innerText();
    return { pass: observed === 'Renamed Workflow', observed };
  });
  await checkpoint('reloaded');
}
