import type { ReactNode } from "react";

import { inputClass, labelClass } from "./ui";

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

/** A labelled form control with an optional hint. */
export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps {
  name: string;
  /** Element id; defaults to `name`. Set it when a page has several forms with the same field. */
  id?: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  autoComplete?: string;
}

export function TextField({
  name,
  id = name,
  label,
  hint,
  defaultValue,
  required,
  maxLength,
  multiline,
  autoComplete = "off",
}: TextFieldProps) {
  const shared = {
    id,
    name,
    defaultValue,
    required,
    maxLength,
    autoComplete,
    "aria-describedby": hint ? `${id}-hint` : undefined,
    className: inputClass,
  };
  return (
    <Field id={id} label={label} hint={hint}>
      {multiline ? (
        <textarea rows={4} {...shared} />
      ) : (
        <input type="text" {...shared} />
      )}
    </Field>
  );
}
