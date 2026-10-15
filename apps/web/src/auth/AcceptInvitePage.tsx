import { PASSWORD_MIN_LENGTH, type MeResponse } from '@ordler/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from './errors.js';
import { Card, FormError, PrimaryButton, TextField } from './form.js';

/** `/invite/<token>`: the invitee chooses a name and password and lands in the workspace. */
export function AcceptInvitePage({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: (me: MeResponse) => void;
}) {
  const { t } = useTranslation();
  const [invite, setInvite] = useState<{ email: string; companyName: string } | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .peekInvite(token)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [token]);

  if (invite === undefined)
    return (
      <Card title="Ordler" subtitle={t('auth.loading')}>
        {null}
      </Card>
    );
  if (invite === null)
    return (
      <Card title="Ordler" subtitle={t('invite.invalid')}>
        {null}
      </Card>
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    if (password.length < PASSWORD_MIN_LENGTH) return setError(t('errors.password_too_short'));
    if (password !== String(form.get('passwordConfirm')))
      return setError(t('errors.password_mismatch'));
    setBusy(true);
    setError(undefined);
    try {
      onAccepted(
        await api.acceptInvite({ token, name: String(form.get('name')).trim(), password }),
      );
    } catch (failure) {
      setError(t(errorKey(failure)));
      setBusy(false);
    }
  }

  return (
    <Card
      title={t('invite.title', { company: invite.companyName })}
      subtitle={t('invite.subtitle', { email: invite.email })}
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <TextField label={t('invite.name')} name="name" required autoComplete="name" />
        <TextField
          label={t('invite.password')}
          name="password"
          type="password"
          required
          autoComplete="new-password"
          hint={t('setup.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        />
        <TextField
          label={t('invite.passwordConfirm')}
          name="passwordConfirm"
          type="password"
          required
          autoComplete="new-password"
        />
        <FormError message={error} />
        <PrimaryButton type="submit" disabled={busy}>
          {t('invite.submit')}
        </PrimaryButton>
      </form>
    </Card>
  );
}
