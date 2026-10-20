import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  prefix?: string;
}

export function Field({ label, error, hint, prefix, id, ...input }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null].filter(Boolean).join(' ');
  const control = (
    <input
      id={inputId}
      className="input"
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      {...input}
    />
  );
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {prefix ? (
        <div className="input-prefix">
          <span aria-hidden="true">{prefix}</span>
          {control}
        </div>
      ) : (
        control
      )}
      {hint && !error && (
        <span id={`${inputId}-hint`} className="hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${inputId}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function FormAlert({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'success' | 'info' }) {
  if (!message) return null;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </div>
  );
}
