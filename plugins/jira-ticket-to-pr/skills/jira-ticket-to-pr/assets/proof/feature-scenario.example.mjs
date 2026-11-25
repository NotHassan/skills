// One frozen module; a shared prefix, not falsely identical complete journeys.
async function openMenu({ page, baseURL, step }) {
  await step('Open workflow menu', async () => {
    await page.goto(`${baseURL}/workflows/test-workflow`);
    await page.getByRole('button', { name: 'Workflow actions' }).click();
  });
}
export async function baseline(api) {
  await openMenu(api);
  api.observe('duplicate-action-count', await api.page.getByRole('menuitem', { name: 'Duplicate', exact: true }).count());
  await api.checkpoint('menu-before');
}
export async function exercise(api) {
  await openMenu(api);
  await api.step('Duplicate the workflow', async () => {
    await api.page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    await api.page.getByRole('heading', { name: 'Test Workflow (copy)' }).waitFor();
  });
  await api.check('duplicate-created', async () => ({ pass: await api.page.getByRole('heading', { name: 'Test Workflow (copy)' }).isVisible() }));
  await api.checkpoint('duplicated');
}
