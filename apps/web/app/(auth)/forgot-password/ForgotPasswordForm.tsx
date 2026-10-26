'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiClientError, fieldErrors, passwordResetConfirmSchema, passwordResetRequestSchema } from '@krevia/shared';
import { Field, FormAlert } from '@/components/Field';
import { KreviaMark } from '@/components/Logo';
import { api } from '@/lib/api';

/**
 * Two steps: request a 6-digit code for a mobile number, then set a new
 * password with it. The first step answers the same way whether or not the
 * number is registered.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [values, setValues] = useState({ phone: '', code: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: e.target.value });

  async function run(action: () => Promise<void>) {
    setAlert(null);
    setSubmitting(true);
    try {
      await action();
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setAlert({ tone: 'error', text: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  function onRequest(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordResetRequestSchema.safeParse({ phone: values.phone });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      const res = await api.requestPasswordReset({ phone: values.phone });
      setStep('confirm');
      setAlert({ tone: 'info', text: res.message });
    });
  }

  function onConfirm(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordResetConfirmSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      await api.confirmPasswordReset(values);
      router.replace('/login?reset=1');
    });
  }

  return (
    <div className="stack">
      <KreviaMark size={52} />
      <div>
        <h1 style={{ fontSize: '1.8rem' }}>Reset your password</h1>
        <p className="muted">
          {step === 'request'
            ? 'Enter your mobile number and we will send you a 6-digit code.'
            : 'Enter the code we sent and choose a new password. You will be signed out on all devices.'}
        </p>
      </div>
      <FormAlert message={alert?.text} tone={alert?.tone} />
      {step === 'request' ? (
        <form onSubmit={onRequest} noValidate className="stack" aria-label="Request a reset code">
          <Field label="Mobile number" name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" prefix="+91" placeholder="98765 43210" value={values.phone} onChange={set('phone')} error={errors.phone} />
          <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form onSubmit={onConfirm} noValidate className="stack" aria-label="Choose a new password">
          <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={values.code} onChange={set('code')} error={errors.code} />
          <Field label="New password" name="password" type="password" autoComplete="new-password" hint="At least 8 characters with a letter and a number." value={values.password} onChange={set('password')} error={errors.password} />
          <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Set new password'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setStep('request'); setAlert(null); }}>Use a different number or resend the code</button>
        </form>
      )}
      <p className="muted" style={{ textAlign: 'center' }}><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}
