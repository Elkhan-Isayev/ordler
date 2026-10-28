import type { ApprovalDecisionInput, ApprovalStepStatus, ApprovalStepView } from '@ordler/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { formatWhen } from '../issues/Comments.js';
import { selectorLabel } from './common.js';

const STEP_STYLE: Record<ApprovalStepStatus, string> = {
  waiting: 'border-line text-ink-faint',
  active: 'border-amber-500 text-amber-700 dark:text-amber-300',
  approved: 'border-emerald-500 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-red-500 text-red-700 dark:text-red-300',
  changes_requested: 'border-amber-500 text-amber-700 dark:text-amber-300',
  skipped: 'border-line text-ink-faint opacity-70',
};

/**
 * Approval steps in order with their approvers and decisions (SPEC §6.3). Whoever may decide
 * the active step gets Approve / Request changes / Reject; deciding needs a signed-in session.
 */
export function ApprovalTimeline({
  steps,
  onDecide,
}: {
  steps: ApprovalStepView[];
  onDecide: (stepId: string, decision: ApprovalDecisionInput) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  if (steps.length === 0) return null;
  return (
    <section aria-label={t('approvals.title')} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">{t('approvals.title')}</h2>
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-label={t('approvals.stepN', { n: index + 1 })}
            className={`flex flex-col gap-2 rounded-lg border-l-4 bg-sidebar p-3 text-sm ${STEP_STYLE[step.status]}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">
                {selectorLabel(t, step.selector, step.names)}
              </span>
              {step.level === 'group' && (
                <span className="text-xs text-ink-faint">{t('approvals.groupLevel')}</span>
              )}
              {step.origin === 'requester_added' && (
                <span className="text-xs text-ink-faint">{t('approvals.addedByRequester')}</span>
              )}
              <span className="ml-auto text-xs">{t(`approvals.status.${step.status}`)}</span>
            </div>
            {step.approvers.length > 0 && (
              <p className="text-xs text-ink-muted">
                {t(step.rule === 'all' ? 'approvals.allOf' : 'approvals.anyOf', {
                  people: step.approvers.map((a) => a.name).join(', '),
                })}
              </p>
            )}
            {step.decisions.map((decision) => (
              <p key={decision.id} className="text-xs text-ink">
                <span className="font-medium">
                  {decision.approver?.name ?? t('issues.someone')}
                </span>
                {decision.onBehalfOf && (
                  <span className="text-ink-muted">
                    {' '}
                    {t('approvals.onBehalfOf', { name: decision.onBehalfOf.name })}
                  </span>
                )}
                : {t(`approvals.decision.${decision.decision}`)}
                {decision.comment && <span className="text-ink-muted"> — {decision.comment}</span>}
                <span className="text-ink-faint">
                  {' '}
                  · {formatWhen(decision.createdAt, i18n.language)}
                </span>
              </p>
            ))}
            {step.status === 'skipped' && (
              <p className="text-xs text-ink-faint">{t('approvals.skippedNote')}</p>
            )}
            {step.escalatedAt && step.status === 'active' && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t('approvals.escalated')}
              </p>
            )}
            {step.timeout && step.status === 'active' && !step.escalatedAt && (
              <p className="text-xs text-ink-faint">
                {t(`approvals.timeoutNote.${step.timeout.action}`, { hours: step.timeout.hours })}
              </p>
            )}
            {step.decidesFor && (
              <p className="text-xs text-ink-muted">
                {t('approvals.decidingFor', { name: step.decidesFor.name })}
              </p>
            )}
            {step.canDecide && (
              <DecisionForm
                onDecide={(decision) => onDecide(step.id, decision)}
                allowChanges={step.level === 'request'}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DecisionForm({
  onDecide,
  allowChanges,
}: {
  onDecide: (decision: ApprovalDecisionInput) => Promise<boolean>;
  allowChanges: boolean;
}) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(decision: ApprovalDecisionInput['decision']) {
    setBusy(true);
    const ok = await onDecide({ decision, ...(comment.trim() ? { comment: comment.trim() } : {}) });
    setBusy(false);
    if (ok) setComment('');
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        aria-label={t('approvals.comment')}
        placeholder={t('approvals.commentPlaceholder')}
        className={inputClass}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void run('approve')}
        >
          {t('approvals.approve')}
        </button>
        {allowChanges && (
          <button
            type="button"
            className={ghostButtonClass}
            disabled={busy || !comment.trim()}
            onClick={() => void run('request_changes')}
          >
            {t('approvals.requestChanges')}
          </button>
        )}
        <button
          type="button"
          className={`${ghostButtonClass} text-red-600`}
          disabled={busy || !comment.trim()}
          onClick={() => void run('reject')}
        >
          {t('approvals.reject')}
        </button>
      </div>
      <p className="text-xs text-ink-faint">{t('approvals.commentHint')}</p>
    </div>
  );
}
