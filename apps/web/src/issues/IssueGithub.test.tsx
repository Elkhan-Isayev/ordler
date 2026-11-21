import type { GithubLinkView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { CopyBranchButton, IssueGithubLinks } from './IssueGithub.js';

afterEach(() => vi.unstubAllGlobals());

const link = (over: Partial<GithubLinkView>): GithubLinkView => ({
  id: over.ref ?? 'x',
  kind: 'branch',
  repository: 'push30/portal',
  ref: 'elkhan/help-1-fix',
  title: null,
  state: null,
  url: 'https://github.com/push30/portal/tree/elkhan/help-1-fix',
  author: 'elkhan',
  updatedAt: '2026-11-21T10:00:00Z',
  ...over,
});

describe('IssueGithubLinks', () => {
  it('lists pull requests first, with their state, then branches and commits', async () => {
    await renderWithI18n(
      <IssueGithubLinks
        links={[
          link({ kind: 'commit', ref: 'a'.repeat(40), title: 'Fix HELP-1', url: 'https://c' }),
          link({}),
          link({
            kind: 'pull_request',
            ref: '5',
            title: 'Fix login',
            state: 'merged',
            url: 'https://github.com/push30/portal/pull/5',
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Pull requestpush30/portal#5Fix loginMerged',
      'Branchpush30/portal:elkhan/help-1-fix',
      'Commitpush30/portal@aaaaaaaFix HELP-1',
    ]);
    expect(screen.getByRole('link', { name: 'push30/portal#5' })).toHaveAttribute(
      'href',
      'https://github.com/push30/portal/pull/5',
    );
  });

  it('renders nothing without links', async () => {
    await renderWithI18n(<IssueGithubLinks links={[]} />);
    expect(screen.queryByRole('region', { name: 'GitHub' })).toBeNull();
  });
});

describe('CopyBranchButton', () => {
  it('copies the branch name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await renderWithI18n(<CopyBranchButton branchName="elkhan/help-1-fix" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy branch name' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('elkhan/help-1-fix'));
    expect(await screen.findByText('Branch name copied')).toBeInTheDocument();
  });
});
