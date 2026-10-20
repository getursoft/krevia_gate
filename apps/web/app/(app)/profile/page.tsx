'use client';

import { useState, type FormEvent } from 'react';
import { ApiClientError, fieldErrors, updateProfileSchema } from '@krevia/shared';
import { initials, useSession } from '@/components/AppShell';
import { Field, FormAlert } from '@/components/Field';
import { api } from '@/lib/api';

export default function ProfilePage() {
  const { user, setUser, logout } = useSession();
  const [values, setValues] = useState({ fullName: user.fullName, email: user.email ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = values.fullName !== user.fullName || values.email !== (user.email ?? '');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const parsed = updateProfileSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await api.updateProfile(values);
      setUser(res.user);
      setValues({ fullName: res.user.fullName, email: res.user.email ?? '' });
      setMessage({ tone: 'success', text: 'Profile updated.' });
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page stack" style={{ gap: 20, maxWidth: 720 }}>
      <section className="card row" style={{ gap: 18 }}>
        <div className="avatar avatar-lg" aria-hidden="true">{initials(user.fullName)}</div>
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{user.fullName}</h1>
          <p className="muted" style={{ margin: 0 }}>{user.phone}</p>
          <p className="subtle" style={{ margin: 0 }}>Member since {new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
        </div>
      </section>

      <form className="card stack" onSubmit={onSubmit} noValidate aria-labelledby="edit-title">
        <h2 id="edit-title">Personal details</h2>
        <FormAlert message={message?.text} tone={message?.tone} />
        <Field label="Full name" name="fullName" autoComplete="name" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} error={errors.fullName} />
        <Field label="Email (optional)" name="email" type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} error={errors.email} />
        <Field label="Mobile number" name="phone" value={user.phone} readOnly disabled hint="Your mobile number is your sign-in ID and cannot be changed yet." />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>

      <section className="card stack" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>
        <p className="muted" style={{ margin: 0 }}>Signing out ends this session on the server.</p>
        <div><button type="button" className="btn btn-danger" onClick={logout}>Logout</button></div>
      </section>
    </div>
  );
}
