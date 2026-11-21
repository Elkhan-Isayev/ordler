// Fills a fresh Ordler (first-run setup not done yet) with a company's worth of data through the
// public API, so every section has realistic volume: departments, teams, members with sessions,
// issues, projects, initiatives, whiteboards, request types with approvals, requests and a wiki
// of linked pages. Writes member sessions to $ORDLER_LOAD_STATE for run.mjs.
//
//   ORDLER_URL=http://localhost:3100 node scripts/load/seed.mjs
//
// Use only against a throwaway database: it creates an owner with a published test password.
import { writeFileSync } from 'node:fs';
import { BASE, Client, PASSWORD, ipOf, pool, random } from './common.mjs';

const size = (name, fallback) => Number(process.env[name] ?? fallback);
const DEPARTMENTS = size('DEPARTMENTS', 10);
const TEAMS_PER_DEPARTMENT = size('TEAMS_PER_DEPARTMENT', 2);
const MEMBERS = size('MEMBERS', 200);
const ISSUES_PER_TEAM = size('ISSUES_PER_TEAM', 150);
const PAGES_PER_DEPARTMENT = size('PAGES_PER_DEPARTMENT', 200);
const FOLDERS_PER_DEPARTMENT = size('FOLDERS_PER_DEPARTMENT', 6);
const REQUESTS = size('REQUESTS', 1000);
const CONCURRENCY = size('SEED_CONCURRENCY', 8);
const STATE = process.env.ORDLER_LOAD_STATE ?? '.data/load/state.json';

const rnd = random(7);
const NAMES = [
  'Engineering',
  'Product',
  'Design',
  'Sales',
  'Marketing',
  'Finance',
  'People',
  'Legal',
  'Support',
  'Operations',
  'Security',
  'Data',
  'Procurement',
  'Facilities',
  'Partners',
];
const TOPICS = [
  'onboarding',
  'VPN',
  'laptop',
  'payroll',
  'vacation',
  'release',
  'incident',
  'contract',
  'budget',
  'hiring',
  'security review',
  'access',
  'travel',
  'expenses',
  'roadmap',
  'pricing',
  'support macro',
  'escalation',
  'backup',
  'deployment',
  'on-call',
  'office',
  'vendor',
  'audit',
];
const KINDS = ['Guide', 'Policy', 'Runbook', 'FAQ', 'Checklist', 'Process', 'Overview', 'How-to'];
const RELATION_TYPES = ['related', 'part_of', 'depends_on', 'supersedes', 'references'];

const started = Date.now();
const log = (message) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${message}`);

const owner = new Client();
const setup = await owner.call('POST', '/api/setup', {
  companyName: 'Load Test Co',
  defaultLocale: 'en',
  owner: { name: 'Load Owner', email: 'owner@load.test', password: PASSWORD },
});
if (setup.status !== 201) {
  throw new Error(`Setup refused (${setup.status}): seed a fresh database only.`);
}
log(`owner set up on ${BASE}`);

const roles = await owner.ok('GET', '/api/admin/roles');
const roleId = (key) => roles.find((r) => r.key === key)?.id;
const memberRole = roleId('member');
const leadRole = roleId('team_lead') ?? memberRole;

// Departments and teams.
const departments = await pool(NAMES.slice(0, DEPARTMENTS), 1, async (name) => {
  const { id } = await owner.ok('POST', '/api/admin/departments', { name });
  // Organization-wide wikis, so the company map spans every department.
  await owner.ok('PATCH', `/api/wiki/spaces/${id}`, { visibility: 'organization' });
  return { id, name, teams: [], members: [] };
});
const teams = [];
for (const department of departments) {
  for (let t = 0; t < TEAMS_PER_DEPARTMENT; t++) {
    const key = `${department.name.slice(0, 3).toUpperCase()}${t + 1}`;
    const { id } = await owner.ok('POST', `/api/admin/departments/${department.id}/teams`, {
      name: `${department.name} ${t + 1}`,
      key,
      isPrivate: false,
    });
    const team = { id, key, departmentId: department.id, members: [], issues: [] };
    department.teams.push(team);
    teams.push(team);
  }
}
log(`${departments.length} departments, ${teams.length} teams`);

// Members: invited into a team, then they accept with a password, which signs them in.
const members = await pool(
  Array.from({ length: MEMBERS }, (_, i) => i),
  CONCURRENCY,
  async (i) => {
    const team = teams[i % teams.length];
    const lead = i < teams.length;
    const email = `member${String(i + 1).padStart(4, '0')}@load.test`;
    const invite = await owner.ok('POST', '/api/admin/members', {
      email,
      name: `Member ${i + 1}`,
      role: { roleId: lead ? leadRole : memberRole, scope: { type: 'team', id: team.id } },
      teamIds: [team.id],
    });
    const token = invite.inviteUrl.split('/invite/')[1];
    const client = new Client('', ipOf(i + 1));
    await client.ok('POST', '/api/invites/accept', {
      token,
      name: `Member ${i + 1}`,
      password: PASSWORD,
    });
    const member = { id: invite.member.id, email, cookie: client.cookie, teamKey: team.key };
    team.members.push(member);
    departments.find((d) => d.id === team.departmentId).members.push(member);
    return member;
  },
);
log(`${members.length} members signed in`);

// Issues, assigned across the team.
await pool(teams, 4, async (team) => {
  for (let n = 0; n < ISSUES_PER_TEAM; n++) {
    const assignee = team.members.length ? rnd.pick(team.members).id : null;
    const issue = await owner.ok('POST', `/api/teams/${team.key}/issues`, {
      title: `${rnd.pick(KINDS)}: ${rnd.pick(TOPICS)} #${n + 1}`,
      description: `Work on the ${rnd.pick(TOPICS)} item. `.repeat(1 + rnd.int(6)),
      priority: rnd.pick(['none', 'low', 'medium', 'high', 'urgent']),
      assigneeId: assignee,
    });
    team.issues.push(issue.identifier);
  }
});
log(`${teams.length * ISSUES_PER_TEAM} issues`);

// Projects, initiatives and whiteboards.
const projects = [];
for (const team of teams) {
  for (let p = 0; p < 3; p++) {
    const project = await owner
      .ok('POST', '/api/projects', {
        name: `${team.key} ${rnd.pick(TOPICS)} project ${p + 1}`,
        teamIds: [team.id],
        memberIds: team.members.slice(0, 5).map((m) => m.id),
        status: rnd.pick(['planned', 'in_progress']),
      })
      .catch((error) => (log(`project skipped: ${error.message}`), undefined));
    if (project) projects.push(project.id);
  }
}
for (let i = 0; i < 6; i++) {
  await owner.ok('POST', '/api/initiatives', { name: `Initiative ${i + 1}` }).catch(() => {});
}
const whiteboards = [];
for (const team of teams) {
  for (let w = 0; w < 2; w++) {
    const board = await owner.ok('POST', '/api/whiteboards', {
      team: team.key,
      title: `${team.key} board ${w + 1}`,
    });
    whiteboards.push(board.id);
  }
}
log(`${projects.length} projects, ${whiteboards.length} whiteboards`);

// One request type per department, approved by someone from that department.
const requestTypes = [];
for (const department of departments) {
  const approver = department.members[0];
  const type = await owner.ok('POST', `/api/admin/departments/${department.id}/request-types`, {
    name: `${department.name} help`,
    description: `Ask ${department.name} for help.`,
    targetTeamId: department.teams[0].id,
    approvalSteps: approver
      ? [{ selector: { type: 'user', memberId: approver.id }, rule: 'any' }]
      : [],
  });
  requestTypes.push({ id: type.id, departmentId: department.id });
}
const requests = await pool(
  Array.from({ length: REQUESTS }, (_, i) => i),
  CONCURRENCY,
  async (i) => {
    const requester = members[i % members.length];
    const type = rnd.pick(requestTypes);
    const created = await new Client(requester.cookie).ok('POST', '/api/requests', {
      title: `Need help with ${rnd.pick(TOPICS)} (${i + 1})`,
      description: 'Details of the request. '.repeat(1 + rnd.int(4)),
      requestTypeId: type.id,
      priority: rnd.pick(['none', 'low', 'medium', 'high']),
    });
    return created.identifier;
  },
);
log(`${requestTypes.length} request types, ${requests.length} requests`);

// Wiki: folders and pages per department, linked by [[Title]], issue links and typed relations.
const pages = [];
for (const department of departments) {
  const folders = [null];
  for (let f = 0; f < FOLDERS_PER_DEPARTMENT; f++) {
    const folder = await owner.ok('POST', '/api/wiki/folders', {
      department: department.id,
      name: `${rnd.pick(KINDS)}s ${f + 1}`,
    });
    folders.push(folder.id);
  }
  department.folders = folders;
}
const plan = departments.flatMap((department) =>
  Array.from({ length: PAGES_PER_DEPARTMENT }, (_, n) => ({
    department,
    title: `${department.name} ${rnd.pick(TOPICS)} ${rnd.pick(KINDS).toLowerCase()} ${n + 1}`,
    folderId: rnd.pick(department.folders),
  })),
);
await pool(plan, CONCURRENCY, async (page, i) => {
  // Link back to pages written before this one, so every [[Title]] resolves.
  const earlier = pages.slice(Math.max(0, pages.length - 300));
  const links = Array.from({ length: Math.min(earlier.length, rnd.int(4)) }, () =>
    rnd.pick(earlier),
  );
  const team = rnd.pick(page.department.teams);
  const issue = team.issues.length ? rnd.pick(team.issues) : undefined;
  const content = [
    `# ${page.title}`,
    '',
    `This page explains ${rnd.pick(TOPICS)} for ${page.department.name}.`,
    ...links.map((l) => `- See [[${l.title}]].`),
    issue ? `- Tracked in [${issue}](/issue/${issue}).` : '',
    '',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(3 + rnd.int(20)),
  ].join('\n');
  const created = await owner.ok('POST', '/api/wiki/pages', {
    department: page.department.id,
    folderId: page.folderId,
    title: page.title,
    content,
  });
  pages.push({ id: created.id, title: page.title, departmentId: page.department.id });
  if (i % 200 === 0) log(`${pages.length} wiki pages`);
});
let relations = 0;
await pool(pages, CONCURRENCY, async (page) => {
  const count = rnd.int(3);
  for (let r = 0; r < count; r++) {
    const target =
      rnd.next() < 0.8
        ? { targetKind: 'wiki_page', target: rnd.pick(pages).id }
        : {
            targetKind: 'request',
            target: rnd.pick(requests),
          };
    const result = await owner.call('POST', `/api/wiki/pages/${page.id}/relations`, {
      ...target,
      type: rnd.pick(RELATION_TYPES),
    });
    if (result.status < 300) relations++;
  }
});
log(`${pages.length} wiki pages, ${relations} typed relations`);

writeFileSync(
  STATE,
  JSON.stringify(
    {
      owner: owner.cookie,
      members: members.map((m) => ({ id: m.id, cookie: m.cookie, teamKey: m.teamKey })),
      departments: departments.map((d) => d.id),
      teams: teams.map((t) => ({ key: t.key, issues: t.issues })),
      projects,
      whiteboards,
      requests,
      requestTypes: requestTypes.map((t) => t.id),
      pages: pages.map((p) => p.id),
    },
    null,
    1,
  ),
);
log(`done; state in ${STATE}`);
