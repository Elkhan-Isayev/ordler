// One scenario per Help topic (apps/web/src/help/topics.ts): who is signed in, where the clip
// starts and what the mouse does. Selectors use the English UI, the language clips record in.

export const CLIPS = [
  {
    id: 'request-other-department',
    user: 'sam',
    start: () => '/my-requests',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: 'Service portals' }));
      await ui.click(page.getByRole('link', { name: 'New laptop' }));
      await ui.click(page.getByLabel('Title'));
      await ui.type('Laptop for the new sales intern');
      await ui.click(page.getByRole('textbox', { name: 'Description' }));
      await ui.type('Starts next week, a standard 14" laptop is enough.');
      await ui.select(page.getByLabel('Priority'), 'High');
      await ui.click(page.getByRole('button', { name: 'Submit request' }));
      await page.getByText('Awaiting decision').waitFor();
      await ui.pause(1200);
    },
  },
  {
    id: 'approval-decide',
    user: 'dana',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: /^Approvals/ }));
      await ui.click(page.getByRole('link', { name: /Laptop for our new account manager/ }));
      await ui.click(page.getByRole('textbox', { name: 'Comment', exact: true }));
      await ui.type('Approved, within this quarter budget.');
      await ui.click(page.getByRole('button', { name: 'Approve' }));
      await ui.pause(1200);
    },
  },
  {
    id: 'wiki-page',
    user: 'alex',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: 'Wiki' }));
      await ui.click(page.getByRole('link', { name: /^IT\b/ }));
      await ui.click(page.getByRole('button', { name: 'New page' }));
      await ui.click(page.locator('input[name="name"]'));
      await ui.type('Printer setup');
      await ui.click(page.getByRole('button', { name: 'Create', exact: true }));
      await ui.pause(1000);
      await ui.click(page.locator('.ProseMirror').first());
      await ui.type('Add the office printer in three steps:');
      await page.keyboard.press('Enter');
      await ui.type('- Open Settings, then Printers');
      await page.keyboard.press('Enter');
      await ui.type('Pick "Office 2nd floor"');
      await page.keyboard.press('Enter');
      await ui.type('Print a test page');
      await ui.click(page.getByRole('button', { name: 'Save' }));
      await ui.pause(1200);
    },
  },
  {
    id: 'request-several-departments',
    user: 'sam',
    start: () => '/my-requests',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: 'Service portals' }));
      await ui.click(page.getByRole('checkbox', { name: /Add Software license/ }));
      await ui.click(page.getByRole('checkbox', { name: /Add Invoice payment/ }));
      await ui.click(page.getByRole('button', { name: 'Request from 2 departments' }));
      await ui.click(page.getByLabel('Title'));
      await ui.type('Design tool for the sales team');
      await ui.click(page.getByRole('textbox', { name: 'Description' }));
      await ui.type('Five seats for a year; IT sets it up, Finance pays the invoice.');
      await ui.click(page.getByRole('button', { name: 'Submit request' }));
      await page.waitForFunction(() => location.pathname.startsWith('/request-groups/'));
      await ui.pause(1200);
    },
  },
  {
    id: 'request-add-approvals',
    user: 'sam',
    start: () => '/my-requests',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: 'Service portals' }));
      await ui.click(page.getByRole('link', { name: 'Software license' }));
      await ui.click(page.getByLabel('Title'));
      await ui.type('Renew the CRM license');
      await ui.click(page.getByRole('button', { name: 'Add approval' }));
      await ui.select(page.getByLabel('Approver'), 'Specific person');
      await ui.select(page.getByLabel('Person'), 'Chris Park');
      await ui.click(page.getByRole('button', { name: 'Submit request' }));
      await page.getByText('Awaiting decision').first().waitFor();
      await ui.pause(1200);
    },
  },
  {
    id: 'issue-create',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('button', { name: 'Helpdesk' }));
      await ui.click(page.getByRole('link', { name: 'Issues', exact: true }));
      await ui.click(page.getByRole('button', { name: 'New issue' }));
      const dialog = page.getByRole('dialog', { name: 'New issue in Helpdesk' });
      await ui.click(dialog.getByLabel('Title'));
      await ui.type('Replace the meeting room projector');
      await ui.click(dialog.getByRole('textbox', { name: 'Description' }));
      await ui.type('The image flickers since last week.');
      await ui.select(dialog.getByLabel('Priority'), 'High');
      await ui.click(dialog.getByRole('button', { name: 'Create issue' }));
      await ui.pause(1500);
    },
  },
  {
    id: 'whiteboard-diagram',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: 'Whiteboards' }));
      await ui.click(page.getByLabel('Whiteboard title'));
      await ui.type('New hire onboarding');
      await ui.click(page.getByRole('button', { name: 'Create', exact: true }));
      await page.waitForFunction(() => /^\/whiteboards\/./.test(location.pathname));
      await page.locator('.excalidraw').waitFor();
      await ui.pause(1000);
      await ui.select(page.getByLabel('Insert…'), 'Flowchart');
      await ui.pause(1500);
    },
  },
  {
    id: 'wiki-table',
    user: 'alex',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('link', { name: 'Wiki' }));
      await ui.click(page.getByRole('link', { name: /^IT\b/ }));
      await ui.click(page.getByRole('button', { name: 'New page' }));
      await ui.click(page.locator('input[name="name"]'));
      await ui.type('Office equipment');
      await ui.click(page.getByRole('button', { name: 'Create', exact: true }));
      await ui.pause(1000);
      await ui.click(page.locator('.ProseMirror').first());
      await ui.type('Who looks after what:');
      await page.keyboard.press('Enter');
      await ui.click(page.getByRole('button', { name: 'Insert table' }));
      // Tab moves to the next cell, so the mouse rests while the table fills in.
      for (const [i, cell] of [
        'Item',
        'Owner',
        'Status',
        'Printer',
        'Chris Park',
        'Working',
        'Projector',
        'Chris Park',
        'Repair',
      ].entries()) {
        if (i > 0) await page.keyboard.press('Tab');
        await ui.type(cell);
      }
      await ui.click(page.getByRole('button', { name: 'Save' }));
      await ui.pause(1200);
    },
  },
];
