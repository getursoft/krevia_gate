'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiClientError, BRAND, fieldErrors, loginSchema } from '@krevia/shared';
import { Field, FormAlert } from '@/components/Field';
import { KreviaMark } from '@/components/Logo';
import { api } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [values, setValues] = useState({ phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api.login(values);
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setFormError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="stack" aria-labelledby="login-title">
      <KreviaMark size={52} />
      <div>
        <h1 id="login-title" style={{ fontSize: '1.8rem' }}>Welcome back</h1>
        <p className="muted">Sign in to {BRAND.name} with your mobile number.</p>
      </div>
      <FormAlert message={formError} />
      <Field
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        prefix="+91"
        placeholder="98765 43210"
        value={values.phone}
        onChange={(e) => setValues({ ...values, phone: e.target.value })}
        error={errors.phone}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={values.password}
        onChange={(e) => setValues({ ...values, password: e.target.value })}
        error={errors.password}
      />
      <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="muted" style={{ textAlign: 'center' }}>
        New to {BRAND.name}? <Link href="/register">Create an account</Link>
      </p>
      <p className="subtle" style={{ textAlign: 'center' }}>
        Forgot your password? Password reset by OTP is not yet available — contact your society administrator.
      </p>
    </form>
  );
}
