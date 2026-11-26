import { createHash, randomBytes } from 'node:crypto';

/** Opens Helpdesk's issue list from the sidebar. */
async function helpdeskIssues(ui) {
  await ui.click(ui.page.getByRole('button', { name: 'Helpdesk' }));
  await ui.click(ui.page.getByRole('link', { name: 'Issues', exact: true }));
}

/** Right-clicks an issue row and picks `item` under the `menu` submenu. */
async function fromContextMenu(ui, row, menu, item) {
  const { page } = ui;
  await ui.moveTo(row);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await ui.pause(500);
  const context = page.getByRole('menu').first();
  const opener = context.getByRole('menuitem', { name: menu });
  await ui.click(opener);
  // Slide sideways into the submenu first: crossing the next row would open its submenu.
  const target = page.getByRole('menuitemradio', { name: item, exact: true });
  const [from, to] = [await opener.boundingBox(), await target.boundingBox()];
  await page.mouse.move(to.x + 12, from.y + from.height / 2, { steps: 12 });
  await ui.click(target);
}

/** An S256 PKCE pair, as an MCP client makes before sending the member to sign in. */
function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

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
    id: 'request-receive',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      // Requests sent to IT land in the queue of the team the request type routes to.
      await ui.click(page.getByRole('button', { name: 'Helpdesk' }));
      await ui.click(page.getByRole('link', { name: 'Requests', exact: true }).last());
      await ui.click(page.getByRole('link', { name: /VPN access for a trip to Berlin/ }));
      await ui.click(page.getByRole('button', { name: 'Accept' }));
      const properties = page.getByRole('complementary');
      await ui.select(properties.getByLabel('Assignee'), 'Jordan Reyes');

      await ui.caption('A comment is visible to the requester.');
      await ui.click(page.getByRole('textbox', { name: 'New comment' }));
      await ui.type('Jordan will set up your VPN access today.');
      await ui.click(page.getByRole('button', { name: 'Comment', exact: true }));
      await ui.pause(900);

      await ui.caption('An internal comment stays inside your team.');
      await ui.click(page.getByRole('textbox', { name: 'New comment' }));
      await ui.type('Use the travel profile, it expires after two weeks.');
      await ui.click(page.getByLabel('Internal (team only)'));
      await ui.click(page.getByRole('button', { name: 'Comment', exact: true }));
      await ui.pause(900);

      await ui.caption('Create an issue to track the work in your team.');
      await ui.click(page.getByRole('button', { name: /Create issue/ }));
      const linked = page.getByRole('region', { name: 'Linked issues' }).getByRole('link').first();
      await ui.moveTo(linked);
      await ui.pause(1200);
      await ui.caption('Then assign the issue to the person who will do it.');
      await ui.click(linked);
      await ui.select(page.getByRole('complementary').getByLabel('Assignee'), 'Jordan Reyes');
      await ui.pause(1500);
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
  {
    id: 'issue-blocking',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await helpdeskIssues(ui);
      await ui.click(page.getByRole('link', { name: /Install the new projector/ }));
      await ui.click(page.getByRole('button', { name: 'Add relation' }));
      await ui.select(page.getByLabel('Relation type'), 'Blocked by');
      await ui.click(page.getByLabel('Search issues by ID or title'));
      await ui.type('order a new');
      await ui.click(
        page.getByRole('listbox', { name: 'Matching issues' }).getByRole('button', {
          name: /Order a new projector/,
        }),
      );
      await page.getByRole('list', { name: 'Blocked by' }).waitFor();
      await ui.pause(1200);
      // The other issue now lists this one under "Blocking".
      await ui.click(
        page.getByRole('list', { name: 'Blocked by' }).getByRole('link', {
          name: /Order a new projector/,
        }),
      );
      await page.getByRole('list', { name: 'Blocking' }).waitFor();
      await ui.moveTo(page.getByRole('list', { name: 'Blocking' }));
      await ui.pause(1200);
      // Lists mark the waiting issue as blocked.
      await ui.click(page.getByRole('link', { name: 'Issues', exact: true }));
      await ui.moveTo(page.getByRole('img', { name: 'Blocked' }).first());
      await ui.pause(1200);
    },
  },
  {
    id: 'cycle-enable',
    user: 'dana',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('button', { name: 'Accounting' }));
      await ui.click(page.locator('a[href="/teams/ACC/settings"]'));
      const form = page.getByRole('form', { name: 'Cycle settings' });
      await ui.click(form.getByLabel('Plan cycles for this team'));
      await ui.select(form.getByLabel('Length'), '2 weeks');
      await ui.select(form.getByLabel('Starts on'), 'Monday');
      await ui.click(form.getByRole('button', { name: 'Save' }));
      await form.getByRole('status').waitFor();
      await ui.pause(800);
      await ui.click(page.getByRole('link', { name: /Cycles · Current/ }));
      await ui.pause(1500);
    },
  },
  {
    id: 'cycle-add-issue',
    user: 'chris',
    start: () => '/inbox',
    async run(ui, state) {
      const { page } = ui;
      await helpdeskIssues(ui);
      await ui.click(page.getByRole('link', { name: /Set up the guest Wi-Fi/ }));
      await ui.select(
        page.getByRole('complementary').getByLabel('Cycle', { exact: true }),
        `${state.currentCycle} · Current`,
      );
      await ui.pause(1200);
      // A new issue can start in the cycle straight away.
      await ui.click(page.getByRole('link', { name: 'Issues', exact: true }));
      await ui.click(page.getByRole('button', { name: 'New issue' }));
      const dialog = page.getByRole('dialog', { name: 'New issue in Helpdesk' });
      await ui.click(dialog.getByLabel('Title'));
      await ui.type('Check the UPS batteries');
      await ui.select(
        dialog.getByLabel('Cycle', { exact: true }),
        `${state.currentCycle} · Current`,
      );
      await ui.click(dialog.getByRole('button', { name: 'Create issue' }));
      await ui.pause(1500);
    },
  },
  {
    id: 'cycle-from-backlog',
    user: 'chris',
    start: () => '/inbox',
    async run(ui, state) {
      const { page } = ui;
      await helpdeskIssues(ui);
      await ui.select(page.getByLabel('Cycle', { exact: true }), 'No cycle');
      await ui.pause(800);
      for (const title of ['Label the network cables', 'Clean up old user accounts']) {
        const row = page.getByRole('link', { name: new RegExp(title) });
        await fromContextMenu(ui, row, 'Status', 'Todo');
        await fromContextMenu(ui, row, 'Cycle', state.currentCycle);
        await ui.pause(800);
      }
      await ui.click(page.getByRole('link', { name: /Cycles · Current/ }));
      await ui.pause(1500);
    },
  },
  {
    id: 'cycle-to-backlog',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('button', { name: 'Helpdesk' }));
      await ui.click(page.getByRole('link', { name: /Cycles · Current/ }));
      await ui.click(page.getByRole('link', { name: /Fix the door badge reader/ }));
      const properties = page.getByRole('complementary');
      await ui.select(properties.getByLabel('Cycle', { exact: true }), 'No cycle');
      await ui.select(properties.getByLabel('Status'), 'Backlog');
      await ui.moveTo(page.getByText(/removed from the cycle/).last());
      await ui.pause(1500);
    },
  },
  {
    id: 'cycle-progress',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('button', { name: 'Helpdesk' }));
      await ui.click(page.getByRole('link', { name: /Cycles · Current/ }));
      await ui.pause(800);
      await ui.moveTo(page.getByText(/of \d+ done/).first());
      await ui.pause(800);
      await ui.moveTo(page.getByRole('img', { name: /Burn-up/ }).first());
      await ui.pause(1200);
      await ui.click(page.getByRole('link', { name: 'Open on the board' }));
      await ui.pause(1500);
    },
  },
  {
    id: 'cycle-board-assignee',
    user: 'chris',
    start: () => '/inbox',
    async run(ui) {
      const { page } = ui;
      await ui.click(page.getByRole('button', { name: 'Helpdesk' }));
      await ui.click(page.getByRole('link', { name: /Cycles · Current/ }));
      // The cycle's board opens already filtered to that cycle.
      await ui.click(page.getByRole('link', { name: 'Open on the board' }));
      const filters = page.getByRole('group', { name: 'Filters' });
      await ui.moveTo(filters.getByLabel('Cycle', { exact: true }));
      await ui.pause(900);
      await ui.select(filters.getByLabel('Assignee'), 'Jordan Reyes');
      await ui.pause(1500);
      await ui.select(filters.getByLabel('Assignee'), 'Chris Park');
      await ui.pause(1500);
      await ui.select(filters.getByLabel('Assignee'), 'Any assignee');
      await ui.pause(1200);
    },
  },
  {
    id: 'mcp-connect-claude',
    user: 'alex',
    start: () => '/settings/tokens',
    async run(ui) {
      const { page } = ui;
      const address = page.locator('code').filter({ hasText: /\/mcp$/ });
      await ui.caption('1. In Ordler, open Settings → Access tokens and copy the MCP address.');
      await ui.moveTo(address);
      await address.click({ clickCount: 3 });
      await ui.pause(1800);
      await ui.caption(
        '2. In Claude, open Settings → Connectors → Add custom connector,\npaste the address and click Connect.',
      );
      await ui.pause(3500);

      // What Claude does next: it registers itself and opens Ordler's consent page.
      const origin = new URL(page.url()).origin;
      const redirect = 'https://claude.ai/api/mcp/auth_callback';
      const client = await (
        await page.request.post(`${origin}/api/oauth/register`, {
          data: {
            client_name: 'Claude',
            redirect_uris: [redirect],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          },
        })
      ).json();
      // The callback belongs to Claude; the clip ends on a neutral page instead of leaving.
      await page.route(`${redirect}**`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#444;font:500 20px system-ui,sans-serif">Back in Claude: Ordler is connected.</body>',
        }),
      );
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: redirect,
        code_challenge: pkce().challenge,
        code_challenge_method: 'S256',
        state: 'help-clip',
        resource: `${origin}/mcp`,
      });
      await page.goto(`${origin}/oauth/authorize?${query}`);
      await page.getByRole('button', { name: 'Allow' }).waitFor();
      await ui.caption('3. Ordler asks you to allow Claude. Check what it may do and click Allow.');
      await ui.pause(1500);
      await ui.click(page.getByRole('button', { name: 'Allow' }));
      await page.waitForURL(`${redirect}**`);
      await ui.caption(
        'Claude now works in Ordler as you. Revoke it any time under Access tokens.',
      );
      await ui.pause(2500);
    },
  },
  {
    id: 'mcp-token',
    user: 'alex',
    start: () => '/settings/tokens',
    async run(ui) {
      const { page } = ui;
      const form = page.getByRole('form', { name: 'New token' });
      await ui.caption(
        'For clients without sign-in (Claude Code, scripts): create a personal token.',
      );
      await ui.click(form.getByLabel('Name'));
      await ui.type('Claude Code');
      await ui.click(form.getByRole('button', { name: 'Create token' }));
      await page.getByText('Copy your token now').waitFor();
      await ui.click(page.getByRole('button', { name: 'Copy', exact: true }));
      await ui.caption(
        'Then add Ordler to Claude Code in a terminal:\nclaude mcp add --transport http ordler <MCP address> --header "Authorization: Bearer <token>"',
      );
      await ui.pause(4500);
    },
  },
];
