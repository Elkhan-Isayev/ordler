import type {
  ApprovalDecisionInput,
  PendingApproval,
  RequestGroupView,
  RequestSummary,
} from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { formatWhen } from '../issues/Comments.js';
import { Avatar, PriorityIcon } from '../issues/ui.js';
import { Link } from '../router.js';
import { ApprovalTimeline } from './ApprovalTimeline.js';
import { RequestStatusBadge, selectorLabel } from './common.js';

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    load()
      .then((value) => {
        setData(value);
        setError(undefined);
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, setData, error, setError, reload };
}

function Page({
  title,
  error,
  children,
}: {
  title: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{title}</h1>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {children}
    </div>
  );
}

/** Rows of requests; `showRequester` for queues of the receiving team. */
export function RequestTable({
  requests,
  showRequester = false,
}: {
  requests: RequestSummary[];
  showRequester?: boolean;
}) {
  const { t } = useTranslation();
  if (requests.length === 0)
    return <p className="p-8 text-center text-sm text-ink-muted">{t('requests.empty')}</p>;
  return (
    <ul>
      {requests.map((request) => (
        <li key={request.id} className="border-b border-line">
          <Link
            href={`/requests/${request.identifier}`}
            className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-hover"
          >
            <PriorityIcon priority={request.priority} />
            <span className="w-20 shrink-0 text-ink-faint">{request.identifier}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{request.title}</span>
            <span className="hidden text-xs text-ink-faint md:inline">
              {request.department.name} · {request.requestType.name}
            </span>
            {showRequester && <Avatar member={request.requester} />}
            <RequestStatusBadge status={request.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MyRequestsPage() {
  const { t } = useTranslation();
  const { data, error } = useLoad(api.myRequests);
  return (
    <Page title={t('nav.myRequests')} error={error}>
      <div className="flex justify-end px-4 pt-3">
        <Link href="/portals" className="text-sm text-accent hover:underline">
          + {t('requests.new')}
        </Link>
      </div>
      {data && <RequestTable requests={data} />}
    </Page>
  );
}

export function TeamRequestsPage({ teamKey }: { teamKey: string }) {
  const { t } = useTranslation();
  const load = useCallback(() => api.teamRequests(teamKey), [teamKey]);
  const { data, error } = useLoad(load);
  return (
    <Page title={`${teamKey} · ${t('nav.requests')}`} error={error}>
      {data && <RequestTable requests={data} showRequester />}
    </Page>
  );
}

export function DepartmentRequestsPage({ departmentId }: { departmentId: string }) {
  const { t } = useTranslation();
  const load = useCallback(() => api.departmentRequests(departmentId), [departmentId]);
  const { data, error } = useLoad(load);
  return (
    <Page title={t('nav.requests')} error={error}>
      {data && <RequestTable requests={data} showRequester />}
    </Page>
  );
}

/** Items waiting for my decision (SPEC §6.3). Deciding happens on the request page. */
export function ApprovalsPage() {
  const { t, i18n } = useTranslation();
  const { data, error } = useLoad(api.myApprovals);
  return (
    <Page title={t('nav.approvals')} error={error}>
      {data?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('approvals.empty')}</p>
      )}
      <ul>
        {data?.map((item: PendingApproval) => {
          const href = item.request
            ? `/requests/${item.request.identifier}`
            : `/request-groups/${item.group!.identifier}`;
          return (
            <li key={item.stepId} className="border-b border-line">
              <Link
                href={href}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-hover"
              >
                <span className="w-20 shrink-0 text-ink-faint">
                  {item.request?.identifier ?? item.group?.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {item.request?.title ?? item.group?.title}
                </span>
                {item.request && (
                  <span className="text-xs text-ink-muted">
                    {item.request.requester?.name} → {item.request.department.name}
                  </span>
                )}
                <span className="text-xs text-ink-faint">
                  {selectorLabel(t, item.selector, item.names)}
                </span>
                <span className="text-xs text-ink-faint">
                  {formatWhen(item.activatedAt, i18n.language)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

const GROUP_STATUS_STYLE: Record<RequestGroupView['status'], string> = {
  pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  in_progress: 'bg-accent/15 text-ink',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

/** One request to several departments: group approvals and each department's progress. */
export function RequestGroupPage({ identifier }: { identifier: string }) {
  const { t } = useTranslation();
  const load = useCallback(() => api.requestGroup(identifier), [identifier]);
  const { data, setData, error, setError } = useLoad(load);

  async function decide(stepId: string, decision: ApprovalDecisionInput): Promise<boolean> {
    try {
      const result = await api.decideApproval(stepId, decision);
      if (result.group) setData(result.group);
      return true;
    } catch (failure) {
      setError(errorKey(failure));
      return false;
    }
  }

  return (
    <Page title={data ? `${data.identifier} · ${data.title}` : identifier} error={error}>
      {data && (
        <div className="flex flex-col gap-5 p-6">
          <span
            className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${GROUP_STATUS_STYLE[data.status]}`}
          >
            {t(`requests.groupStatus.${data.status}`)}
          </span>
          <ApprovalTimeline steps={data.approvals} onDecide={decide} />
          <section aria-label={t('requests.departments')} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink">{t('requests.departments')}</h2>
            <RequestTable requests={data.children} />
          </section>
        </div>
      )}
    </Page>
  );
}
