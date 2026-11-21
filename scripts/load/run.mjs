// Load test of every section of Ordler against a stack seeded by seed.mjs.
//
//   MODE=sections node scripts/load/run.mjs   each screen alone, flat out: throughput and latency
//   MODE=users    node scripts/load/run.mjs   people clicking around with think time, ramped in
//                                             stages; each keeps a realtime WebSocket open
//   MODE=idle     node scripts/load/run.mjs   open tabs that only hold a WebSocket
//
// Results go to stdout as Markdown tables. Container CPU and memory come from `docker stats`.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { BASE, Client, ipOf, random } from './common.mjs';

const env = (name, fallback) => process.env[name] ?? fallback;
const MODE = env('MODE', 'sections');
const STATE = JSON.parse(readFileSync(env('ORDLER_LOAD_STATE', '.data/load/state.json'), 'utf8'));
const CONTAINER = env('ORDLER_CONTAINER', 'ordler-load-api');
const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rnd = random(11);
const WORDS = ['onboarding', 'VPN', 'payroll', 'release', 'incident', 'budget', 'access', 'vendor'];

// ---------------------------------------------------------------------------------------------
// Measurements

class Stats {
  constructor() {
    this.samples = new Map();
    this.errors = new Map();
    this.started = Date.now();
  }
  record(name, ms, status) {
    if (!this.samples.has(name)) this.samples.set(name, []);
    this.samples.get(name).push(ms);
    if (status >= 400 || status === 0) {
      const key = `${name} ${status}`;
      this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
    }
  }
  all() {
    return [...this.samples.values()].flat();
  }
  errorCount() {
    return [...this.errors.values()].reduce((a, b) => a + b, 0);
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const ms = (value) => `${Math.round(value)}`;

/** Samples the API container: CPU % of one core, memory in MiB. */
function containerMonitor() {
  const samples = [];
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const { stdout } = await run('docker', [
          'stats',
          '--no-stream',
          '--format',
          '{{.CPUPerc}}|{{.MemUsage}}',
          CONTAINER,
        ]);
        const [cpu, mem] = stdout.trim().split('|');
        const [used] = mem.split('/');
        const mib = used.trim().endsWith('GiB') ? parseFloat(used) * 1024 : parseFloat(used);
        samples.push({ cpu: parseFloat(cpu), mem: mib });
      } catch {
        // docker stats is best effort; the test itself does not depend on it.
      }
      await sleep(1000);
    }
  })();
  return {
    stop() {
      stopped = true;
      const cpu = samples.map((s) => s.cpu);
      const mem = samples.map((s) => s.mem);
      return {
        cpu: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0,
        mem: mem.length ? Math.max(...mem) : 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// People and the screens they open

const members = STATE.members.map((m, i) => ({
  ...m,
  index: i,
  requests: STATE.requests.filter((_, r) => r % STATE.members.length === i),
  issues: STATE.teams.find((t) => t.key === m.teamKey)?.issues ?? [],
}));

function person(n) {
  const member = members[n % members.length];
  return { member, client: new Client(member.cookie, ipOf(1000 + n)) };
}

/** What a member can open, fetched once: their projects, whiteboards and editable wiki pages. */
const visible = new Map();
async function visibleTo(member, client) {
  if (!visible.has(member.id)) {
    visible.set(
      member.id,
      (async () => {
        const [projects, boards, spaces] = await Promise.all([
          client.call('GET', '/api/projects'),
          client.call('GET', '/api/whiteboards'),
          client.call('GET', '/api/wiki/spaces'),
        ]);
        const editable = (spaces.data ?? []).filter((s) => s.canEdit);
        const pages = [];
        for (const space of editable) {
          const tree = await client.call('GET', `/api/wiki/spaces/${space.department.id}`);
          const walk = (node) => {
            for (const page of node?.pages ?? []) pages.push(page.id);
            for (const folder of node?.folders ?? []) walk(folder);
          };
          walk(tree.data);
        }
        return {
          projects: (projects.data ?? []).map((p) => p.id),
          boards: (boards.data ?? []).map((b) => b.id),
          pages,
        };
      })(),
    );
  }
  return visible.get(member.id);
}

async function timed(stats, client, name, method, path, body) {
  const t = performance.now();
  let status = 0;
  let data;
  try {
    ({ status, data } = await client.call(method, path, body));
  } catch {
    status = 0;
  }
  stats.record(name, performance.now() - t, status);
  return { status, data };
}

/** A personal token per member (MCP allows 120 calls a minute per token), made once. */
const tokens = new Map();
async function tokenOf(member, client) {
  if (!tokens.has(member.id)) {
    tokens.set(
      member.id,
      client
        .ok('POST', '/api/me/tokens', { name: 'Load test agent', scopes: ['read'] })
        .then((created) => created.token),
    );
  }
  return tokens.get(member.id);
}

/** One MCP tool call, as an AI agent makes it. */
async function agent(stats, client, member, name, args) {
  const token = await tokenOf(member, client);
  const t = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const body = await response.json().catch(() => undefined);
    status = body?.result?.isError ? 500 : response.status;
  } catch {
    status = 0;
  }
  stats.record(`MCP ${name}`, performance.now() - t, status);
}

/** Each screen fires the same API calls the web app does when it opens, in parallel. */
const SCREENS = {
  inbox: (s, c) =>
    Promise.all([
      timed(s, c, 'GET /api/me', 'GET', '/api/me'),
      timed(s, c, 'GET /api/me/counts', 'GET', '/api/me/counts'),
      timed(s, c, 'GET /api/me/notifications', 'GET', '/api/me/notifications'),
    ]),
  myIssues: (s, c) => timed(s, c, 'GET /api/me/issues', 'GET', '/api/me/issues'),
  myRequests: (s, c) => timed(s, c, 'GET /api/me/requests', 'GET', '/api/me/requests'),
  approvals: (s, c) => timed(s, c, 'GET /api/me/approvals', 'GET', '/api/me/approvals'),
  teamIssues: (s, c, m) =>
    Promise.all([
      timed(s, c, 'GET /api/teams/:key', 'GET', `/api/teams/${m.teamKey}`),
      timed(s, c, 'GET /api/teams/:key/issues', 'GET', `/api/teams/${m.teamKey}/issues`),
    ]),
  issue: (s, c, m) => {
    const id = rnd.pick(m.issues);
    return Promise.all([
      timed(s, c, 'GET /api/issues/:id', 'GET', `/api/issues/${id}`),
      timed(s, c, 'GET /api/issues/:id/whiteboards', 'GET', `/api/issues/${id}/whiteboards`),
    ]);
  },
  triage: (s, c, m) =>
    timed(s, c, 'GET /api/teams/:key/triage', 'GET', `/api/teams/${m.teamKey}/triage`),
  cycles: (s, c, m) =>
    timed(s, c, 'GET /api/teams/:key/cycles', 'GET', `/api/teams/${m.teamKey}/cycles`),
  views: (s, c) => timed(s, c, 'GET /api/views', 'GET', '/api/views'),
  projects: (s, c) => timed(s, c, 'GET /api/projects', 'GET', '/api/projects'),
  project: async (s, c, m) => {
    const { projects } = await visibleTo(m, c);
    if (projects.length)
      await timed(s, c, 'GET /api/projects/:id', 'GET', `/api/projects/${rnd.pick(projects)}`);
  },
  initiatives: (s, c) => timed(s, c, 'GET /api/initiatives', 'GET', '/api/initiatives'),
  portals: (s, c) =>
    Promise.all([
      timed(s, c, 'GET /api/portals', 'GET', '/api/portals'),
      timed(
        s,
        c,
        'GET /api/request-types/:id',
        'GET',
        `/api/request-types/${rnd.pick(STATE.requestTypes)}`,
      ),
    ]),
  teamRequests: (s, c, m) =>
    timed(s, c, 'GET /api/teams/:key/requests', 'GET', `/api/teams/${m.teamKey}/requests`),
  request: (s, c, m) =>
    m.requests.length
      ? timed(s, c, 'GET /api/requests/:id', 'GET', `/api/requests/${rnd.pick(m.requests)}`)
      : undefined,
  search: (s, c) =>
    timed(s, c, 'GET /api/search', 'GET', `/api/search?q=${encodeURIComponent(rnd.pick(WORDS))}`),
  directory: (s, c) => timed(s, c, 'GET /api/directory', 'GET', '/api/directory'),
  whiteboards: (s, c) => timed(s, c, 'GET /api/whiteboards', 'GET', '/api/whiteboards'),
  whiteboard: async (s, c, m) => {
    const { boards } = await visibleTo(m, c);
    if (!boards.length) return;
    const id = rnd.pick(boards);
    await Promise.all([
      timed(s, c, 'GET /api/whiteboards/:id', 'GET', `/api/whiteboards/${id}`),
      timed(s, c, 'GET /api/whiteboards/:id/scene', 'GET', `/api/whiteboards/${id}/scene?since=0`),
    ]);
  },
  wikiHome: (s, c) => timed(s, c, 'GET /api/wiki/spaces', 'GET', '/api/wiki/spaces'),
  wikiSpace: (s, c) =>
    timed(
      s,
      c,
      'GET /api/wiki/spaces/:id',
      'GET',
      `/api/wiki/spaces/${rnd.pick(STATE.departments)}`,
    ),
  wikiPage: (s, c) => {
    const id = rnd.pick(STATE.pages);
    return Promise.all([
      timed(s, c, 'GET /api/wiki/pages/:id', 'GET', `/api/wiki/pages/${id}`),
      timed(s, c, 'GET /api/wiki/pages/:id/relations', 'GET', `/api/wiki/pages/${id}/relations`),
    ]);
  },
  wikiSearch: (s, c) =>
    timed(
      s,
      c,
      'GET /api/wiki/search',
      'GET',
      `/api/wiki/search?q=${encodeURIComponent(rnd.pick(WORDS))}`,
    ),
  wikiMapSpace: (s, c) =>
    timed(
      s,
      c,
      'GET /api/wiki/graph?department',
      'GET',
      `/api/wiki/graph?department=${rnd.pick(STATE.departments)}`,
    ),
  wikiMapCompany: (s, c) => timed(s, c, 'GET /api/wiki/graph', 'GET', '/api/wiki/graph'),
  // AI agents over MCP: a task's context, a question in plain words, the whole map
  agentIssue: (s, c, m) => agent(s, c, m, 'get_issue', { identifier: rnd.pick(m.issues) }),
  agentContextIssue: (s, c, m) =>
    agent(s, c, m, 'get_wiki_context', { issue: rnd.pick(m.issues), depth: 1 }),
  agentContextRequest: (s, c, m) =>
    m.requests.length
      ? agent(s, c, m, 'get_wiki_context', { request: rnd.pick(m.requests), depth: 1 })
      : undefined,
  agentContextQuestion: (s, c, m) =>
    agent(s, c, m, 'get_wiki_context', {
      query: `How does ${rnd.pick(WORDS)} work for a new ${rnd.pick(WORDS)}?`,
      depth: 1,
    }),
  agentSearch: (s, c, m) =>
    agent(s, c, m, 'search_wiki', { query: `${rnd.pick(WORDS)} ${rnd.pick(WORDS)} policy` }),
  agentGraph: (s, c, m) => agent(s, c, m, 'get_wiki_graph', {}),
  // Writes
  createIssue: (s, c, m) =>
    timed(s, c, 'POST /api/teams/:key/issues', 'POST', `/api/teams/${m.teamKey}/issues`, {
      title: `Load ${rnd.pick(WORDS)} ${Date.now()}`,
      description: 'Created by the load test.',
    }),
  commentIssue: (s, c, m) =>
    timed(
      s,
      c,
      'POST /api/issues/:id/comments',
      'POST',
      `/api/issues/${rnd.pick(m.issues)}/comments`,
      {
        body: 'Looks good, moving on.',
      },
    ),
  editWiki: async (s, c, m) => {
    const { pages } = await visibleTo(m, c);
    if (!pages.length) return;
    const id = rnd.pick(pages);
    const page = await timed(s, c, 'GET /api/wiki/pages/:id', 'GET', `/api/wiki/pages/${id}`);
    if (page.status !== 200) return;
    await timed(s, c, 'PATCH /api/wiki/pages/:id', 'PATCH', `/api/wiki/pages/${id}`, {
      content: `${page.data.content.slice(0, 20000)}\n\nEdited ${new Date().toISOString()}.`,
    });
  },
  commentRequest: (s, c, m) =>
    m.requests.length
      ? timed(
          s,
          c,
          'POST /api/requests/:id/comments',
          'POST',
          `/api/requests/${rnd.pick(m.requests)}/comments`,
          {
            body: 'Any update on this?',
            internal: false,
          },
        )
      : undefined,
  createRequest: (s, c) =>
    timed(s, c, 'POST /api/requests', 'POST', '/api/requests', {
      title: `Load request ${Date.now()}`,
      requestTypeId: rnd.pick(STATE.requestTypes),
    }),
  approve: async (s, c) => {
    const pending = await timed(s, c, 'GET /api/me/approvals', 'GET', '/api/me/approvals');
    const step = pending.data?.[0];
    if (!step) return;
    await timed(
      s,
      c,
      'POST /api/approvals/:id/decision',
      'POST',
      `/api/approvals/${step.stepId}/decision`,
      {
        decision: 'approve',
      },
    );
  },
};

/** How often people open each screen in the `users` mode; writes are about one action in eight. */
const WEIGHTS = {
  teamIssues: 14,
  issue: 14,
  myIssues: 7,
  inbox: 8,
  wikiPage: 10,
  wikiSpace: 4,
  wikiHome: 2,
  wikiMapSpace: 2,
  wikiMapCompany: 0.5,
  wikiSearch: 2,
  search: 4,
  request: 5,
  teamRequests: 3,
  myRequests: 3,
  approvals: 2,
  portals: 2,
  projects: 2,
  project: 2,
  initiatives: 1,
  cycles: 1,
  triage: 1,
  views: 1,
  whiteboards: 1,
  whiteboard: 1,
  directory: 1,
  commentIssue: 3,
  createIssue: 1.5,
  editWiki: 1.5,
  commentRequest: 1.5,
  createRequest: 1,
  approve: 1,
};
const WEIGHT_TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
function pickScreen() {
  let roll = rnd.next() * WEIGHT_TOTAL;
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return 'inbox';
}

/** A tab's realtime connection: the member's own topic and their team's board. */
function openSocket(member, n) {
  return new Promise((resolve) => {
    const url = `${BASE.replace(/^http/, 'ws')}/api/realtime`;
    const socket = new WebSocket(url, {
      headers: { cookie: member.cookie, origin: BASE, 'x-forwarded-for': ipOf(1000 + n) },
    });
    const done = (ok) => resolve({ socket, ok });
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'subscribe', topic: `member:${member.id}` }));
      done(true);
    };
    socket.onerror = () => done(false);
  });
}

// ---------------------------------------------------------------------------------------------
// Modes

async function sectionsMode() {
  const concurrency = Number(env('CONCURRENCY', 20));
  const seconds = Number(env('SECONDS', 15));
  const only = env('SCREENS', '').split(',').filter(Boolean);
  const names = only.length ? only : Object.keys(SCREENS);
  console.log(
    `\n### Each screen alone: ${concurrency} parallel users, no pauses, ${seconds} s each\n`,
  );
  console.log('| Screen | Screens/s | p50 ms | p95 ms | p99 ms | Errors | CPU % | Memory MiB |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const name of names) {
    const stats = new Stats();
    const monitor = containerMonitor();
    const until = Date.now() + seconds * 1000;
    let screens = 0;
    const durations = [];
    await Promise.all(
      Array.from({ length: concurrency }, async (_, n) => {
        const { member, client } = person(n);
        while (Date.now() < until) {
          const t = performance.now();
          await SCREENS[name](stats, client, member);
          durations.push(performance.now() - t);
          screens++;
        }
      }),
    );
    const box = monitor.stop();
    const errors = stats.errorCount();
    console.log(
      `| ${name} | ${(screens / seconds).toFixed(1)} | ${ms(percentile(durations, 50))} | ` +
        `${ms(percentile(durations, 95))} | ${ms(percentile(durations, 99))} | ` +
        `${errors ? `${errors} (${[...stats.errors.keys()].join(', ')})` : 0} | ` +
        `${box.cpu.toFixed(0)} | ${box.mem.toFixed(0)} |`,
    );
    await sleep(2000);
  }
}

async function usersMode() {
  const stages = env('STAGES', '25,50,100,200,300,400').split(',').map(Number);
  const stageSeconds = Number(env('STAGE_SECONDS', 60));
  const think = Number(env('THINK_MS', 5000));
  const stopP95 = Number(env('STOP_P95_MS', 3000));
  console.log(
    `\n### People working: think time ${think / 1000} s on average, ${stageSeconds} s per stage, ` +
      'one WebSocket per person\n',
  );
  console.log(
    '| People | Requests/s | p50 ms | p95 ms | p99 ms | Errors % | Sockets | CPU % | Memory MiB |',
  );
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const people = [];
  let stats = new Stats();
  const startPerson = async (n) => {
    const { member, client } = person(n);
    const { socket, ok } = await openSocket(member, n);
    const state = { stop: false, socket, ok };
    people.push(state);
    (async () => {
      await sleep(rnd.next() * think);
      while (!state.stop) {
        await SCREENS[pickScreen()](stats, client, member);
        await sleep(think * (0.5 + rnd.next()));
      }
    })();
  };
  for (const target of stages) {
    const adding = target - people.length;
    for (let i = 0; i < adding; i++) {
      await startPerson(people.length);
      await sleep(Math.min(50, 5000 / adding));
    }
    await sleep(5000); // let the new people settle before measuring
    stats = new Stats();
    const monitor = containerMonitor();
    await sleep(stageSeconds * 1000);
    const box = monitor.stop();
    const all = stats.all();
    const errorRate = all.length ? (100 * stats.errorCount()) / all.length : 0;
    const open = people.filter((p) => p.socket.readyState === WebSocket.OPEN).length;
    const p95 = percentile(all, 95);
    console.log(
      `| ${target} | ${(all.length / stageSeconds).toFixed(1)} | ${ms(percentile(all, 50))} | ${ms(p95)} | ` +
        `${ms(percentile(all, 99))} | ${errorRate.toFixed(2)} | ${open} | ${box.cpu.toFixed(0)} | ${box.mem.toFixed(0)} |`,
    );
    if (errorRate > 0) {
      console.log(
        `  errors: ${[...stats.errors.entries()].map(([k, v]) => `${k} ×${v}`).join(', ')}`,
      );
    }
    if (p95 > stopP95) {
      console.log(`  stopped: p95 above ${stopP95} ms`);
      break;
    }
  }
  if (env('DETAIL', '1') === '1') {
    console.log('\n| Endpoint (last stage) | Calls | p50 ms | p95 ms | p99 ms |');
    console.log('|---|---:|---:|---:|---:|');
    for (const [name, values] of [...stats.samples.entries()].sort(
      (a, b) => percentile(b[1], 95) - percentile(a[1], 95),
    )) {
      console.log(
        `| ${name} | ${values.length} | ${ms(percentile(values, 50))} | ${ms(percentile(values, 95))} | ${ms(percentile(values, 99))} |`,
      );
    }
  }
  for (const p of people) {
    p.stop = true;
    p.socket.close();
  }
}

async function idleMode() {
  const stages = env('STAGES', '500,1000,2000,4000').split(',').map(Number);
  console.log('\n### Open tabs that only hold a WebSocket, with one person working alongside\n');
  console.log('| Open sockets | Failed | /api/me p95 ms | CPU % | Memory MiB |');
  console.log('|---:|---:|---:|---:|---:|');
  const sockets = [];
  let failed = 0;
  for (const target of stages) {
    while (sockets.length + failed < target) {
      const batch = Math.min(100, target - sockets.length - failed);
      const opened = await Promise.all(
        Array.from({ length: batch }, (_, i) => {
          const n = sockets.length + failed + i;
          return openSocket(members[n % members.length], n);
        }),
      );
      for (const o of opened) {
        if (o.ok) sockets.push(o.socket);
        else failed++;
      }
    }
    await sleep(5000);
    const stats = new Stats();
    const monitor = containerMonitor();
    const { client } = person(0);
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      await timed(stats, client, 'me', 'GET', '/api/me');
      await sleep(200);
    }
    const box = monitor.stop();
    const open = sockets.filter((s) => s.readyState === WebSocket.OPEN).length;
    console.log(
      `| ${open} | ${failed} | ${ms(percentile(stats.all(), 95))} | ${box.cpu.toFixed(0)} | ${box.mem.toFixed(0)} |`,
    );
  }
  for (const s of sockets) s.close();
}

if (MODE === 'sections') await sectionsMode();
else if (MODE === 'users') await usersMode();
else if (MODE === 'idle') await idleMode();
else throw new Error(`Unknown MODE ${MODE}`);
process.exit(0);
