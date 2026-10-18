import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
  suffix?: string;
};

export function Input({ id, label, hint, suffix, className = '', ...props }: Props) {
  return <div className="field-wrap">
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="input-shell">
      <input id={id} className={`field-input ${className}`} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {suffix && <span className="input-suffix" aria-hidden="true">{suffix}</span>}
    </div>
    {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
  </div>;
}
