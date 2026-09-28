async function open(api) {
  await api.step('Open existing workflow', async () => {
    await api.page.goto(api.baseURL);
    await api.page.getByRole('heading', { name: 'Workflow settings' }).waitFor();
  });
}
export async function baseline(api) {
  await open(api);
  api.observe('duplicate-action-count', await api.page.getByRole('button', { name: 'Duplicate', exact: true }).count());
  await api.checkpoint('before-controls');
}
export async function exercise(api) {
  await open(api);
  await api.step('Duplicate the workflow', async () => {
    await api.page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await api.page.locator('#copy').waitFor({ state: 'visible' });
  });
  await api.check('duplicate-created', async () => {
    const observed = await api.page.locator('#copy').innerText();
    return { pass: observed === 'Test Workflow (copy)', observed };
  });
  await api.checkpoint('copy-created');
}
