'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiClientError, BRAND, fieldErrors, registerSchema } from '@krevia/shared';
import { Field, FormAlert } from '@/components/Field';
import { KreviaMark } from '@/components/Logo';
import { api } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';

export function RegisterForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [values, setValues] = useState({ fullName: '', phone: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [key]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api.register(values);
      // Invitation links send people here with ?next=/invite?token=…; otherwise start the join flow.
      router.replace(safeNext(next, '/society/join'));
      router.refresh();
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setFormError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="stack" aria-labelledby="register-title">
      <KreviaMark size={52} />
      <div>
        <h1 id="register-title" style={{ fontSize: '1.8rem' }}>Create your account</h1>
        <p className="muted">Join your society on {BRAND.name}.</p>
      </div>
      <FormAlert message={formError} />
      <Field label="Full name" name="fullName" autoComplete="name" value={values.fullName} onChange={set('fullName')} error={errors.fullName} />
      <Field
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        prefix="+91"
        placeholder="98765 43210"
        value={values.phone}
        onChange={set('phone')}
        error={errors.phone}
        hint="10-digit Indian mobile number. You will use it to sign in."
      />
      <Field label="Email (optional)" name="email" type="email" autoComplete="email" value={values.email} onChange={set('email')} error={errors.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={set('password')}
        error={errors.password}
        hint="At least 8 characters, with a letter and a number."
      />
      <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
      <p className="muted" style={{ textAlign: 'center' }}>
        Already registered? <Link href={next ? `/login?next=${encodeURIComponent(safeNext(next))}` : '/login'}>Sign in</Link>
      </p>
    </form>
  );
}
