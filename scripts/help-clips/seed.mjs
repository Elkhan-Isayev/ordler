// Demo workspace for the Help clips: a few departments, a requester, an approver, request types
// with approvals and one request already waiting for a decision. Fictional names only.
// Run through record.sh, which points ORDLER_URL at a fresh instance.
import { writeFileSync } from 'node:fs';
import { Client } from '../load/common.mjs';

/** Test-only password for the throwaway demo database; never used anywhere real. */
export const DEMO_PASSWORD = 'help-clips-demo-1';
const STATE = process.env.HELP_CLIPS_STATE ?? '.data/help-clips/state.json';

const owner = new Client();
const setup = await owner.call('POST', '/api/setup', {
  companyName: 'Demo Company',
  defaultLocale: 'en',
  owner: { name: 'Alex Morgan', email: 'alex@demo.test', password: DEMO_PASSWORD },
});
if (setup.status !== 201) throw new Error(`Setup refused (${setup.status}): use a fresh database.`);

const roles = await owner.ok('GET', '/api/admin/roles');
const roleId = (key) => roles.find((r) => r.key === key)?.id;

async function department(name, team, key) {
  const { id } = await owner.ok('POST', '/api/admin/departments', { name });
  await owner.ok('PATCH', `/api/wiki/spaces/${id}`, { visibility: 'organization' });
  const created = await owner.ok('POST', `/api/admin/departments/${id}/teams`, {
    name: team,
    key,
    isPrivate: false,
  });
  return { id, teamId: created.id, key };
}

const it = await department('IT', 'Helpdesk', 'HELP');
const finance = await department('Finance', 'Accounting', 'ACC');
const sales = await department('Sales', 'Sales', 'SAL');
await department('People', 'Recruiting', 'REC');

async function member(name, email, team, role) {
  const invite = await owner.ok('POST', '/api/admin/members', {
    email,
    name,
    role: { roleId: roleId(role) ?? roleId('member'), scope: { type: 'team', id: team.teamId } },
    teamIds: [team.teamId],
  });
  const client = new Client();
  await client.ok('POST', '/api/invites/accept', {
    token: invite.inviteUrl.split('/invite/')[1],
    name,
    password: DEMO_PASSWORD,
  });
  return { id: invite.member.id, email, client };
}

const sam = await member('Sam Lee', 'sam@demo.test', sales, 'member');
const dana = await member('Dana Fox', 'dana@demo.test', finance, 'team_lead');
const chris = await member('Chris Park', 'chris@demo.test', it, 'team_lead');

const byDana = [{ selector: { type: 'user', memberId: dana.id }, rule: 'any' }];
const types = {};
// The last column lets requesters add their own approvals (the "add approvals" clip).
for (const [dept, name, description, approvalSteps, allowRequesterApprovals] of [
  [it, 'New laptop', 'Order a laptop for a new or existing employee.', byDana, false],
  [it, 'VPN access', 'Remote access to the company network.', [], false],
  [it, 'Software license', 'Buy or renew a license for a tool.', byDana, true],
  [finance, 'Expense reimbursement', 'Get money back for a work expense.', [], false],
  [finance, 'Invoice payment', 'Pay a supplier invoice.', [], false],
  [sales, 'Discount approval', 'Offer a customer a special price.', [], false],
]) {
  const type = await owner.ok('POST', `/api/admin/departments/${dept.id}/request-types`, {
    name,
    description,
    targetTeamId: dept.teamId,
    approvalSteps,
    allowRequesterApprovals,
  });
  types[name] = type.id;
}

// Waits for Dana in the "approve or reject" clip.
const waiting = await sam.client.ok('POST', '/api/requests', {
  title: 'Laptop for our new account manager',
  description: 'Starts on Monday, needs a 14" laptop with the standard sales tools.',
  requestTypeId: types['New laptop'],
  priority: 'high',
});

for (const [title, content] of [
  ['VPN setup guide', '# VPN setup guide\n\nInstall the client, sign in, pick the office.'],
  ['Laptop policy', '# Laptop policy\n\nEvery employee gets one laptop, replaced every 3 years.'],
]) {
  await owner.ok('POST', '/api/wiki/pages', { department: it.id, title, content });
}

writeFileSync(
  STATE,
  JSON.stringify(
    {
      password: DEMO_PASSWORD,
      users: { alex: 'alex@demo.test', sam: sam.email, dana: dana.email, chris: chris.email },
      departments: { it: it.id, finance: finance.id, sales: sales.id },
      waitingRequest: waiting.identifier,
    },
    null,
    1,
  ),
);
console.log(`demo workspace ready on ${process.env.ORDLER_URL}`);
