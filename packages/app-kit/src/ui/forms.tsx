import { createContext, useContext, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type Ref } from "react";
import { DangerIcon } from "./icons.js";
import { currencyDigits, minorToDecimal, parseMoneyInput } from "./format.js";
import { cx } from "./util.js";

interface FieldContextValue { id: string; describedBy?: string; invalid: boolean; required: boolean }
const FieldContext = createContext<FieldContextValue | null>(null);
/** Ids and state for a custom control inside a `Field`. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Visually hide the label but keep it for assistive technology. */
  hideLabel?: boolean;
  children?: ReactNode;
  className?: string;
  /** Use this id for the control instead of a generated one. */
  id?: string;
}

/**
 * A labeled form field. Controls inside it pick up the id, description and
 * invalid state automatically. Required fields say so in text.
 */
export function Field({ label, hint, error, required = false, hideLabel, children, className, id }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `ri-field${generated.replace(/:/g, "")}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cx("ri-field", className)}>
        <label htmlFor={controlId} className={hideLabel ? "ri-sr-only" : "ri-field__label"}>
          {label}
          {required && <span className="ri-field__required">Required</span>}
        </label>
        {children}
        {hint && <p id={hintId} className="ri-field__hint">{hint}</p>}
        {error && (
          <p id={errorId} className="ri-field__error">
            <DangerIcon />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

type FieldShortcut = { label?: ReactNode; hint?: ReactNode; error?: ReactNode; hideLabel?: boolean };
function withField(props: FieldShortcut & { required?: boolean; id?: string; className?: string }, control: ReactNode) {
  if (props.label === undefined) return control;
  return <Field label={props.label} hint={props.hint} error={props.error} required={props.required} hideLabel={props.hideLabel} id={props.id} className={props.className}>{control}</Field>;
}
function controlProps(field: FieldContextValue | null, own: { id?: string; required?: boolean; "aria-describedby"?: string }) {
  return {
    id: field?.id ?? own.id,
    required: own.required ?? field?.required,
    "aria-invalid": field?.invalid || undefined,
    "aria-describedby": [field?.describedBy, own["aria-describedby"]].filter(Boolean).join(" ") || undefined,
  };
}

export interface TextInputProps extends FieldShortcut, Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange(value: string): void;
  ref?: Ref<HTMLInputElement>;
}
/** A text input. With `label` it renders its own `Field`. */
export function TextInput({ label, hint, error, hideLabel, value, onChange, className, ref, type = "text", ...rest }: TextInputProps) {
  return withField({ label, hint, error, hideLabel, required: rest.required, id: rest.id }, <TextInputControl {...rest} ref={ref} type={type} value={value} onChange={onChange} className={className} />);
}
function TextInputControl({ value, onChange, className, ref, ...rest }: Omit<TextInputProps, "label" | "hint" | "error" | "hideLabel">) {
  const field = useField();
  return <input ref={ref} {...rest} {...controlProps(field, rest)} className={cx("ri-input", className)} value={value} onChange={(event) => onChange(event.target.value)} />;
}

export interface TextAreaProps extends FieldShortcut, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange(value: string): void;
  ref?: Ref<HTMLTextAreaElement>;
}
/** A multi-line text input. With `label` it renders its own `Field`. */
export function TextArea({ label, hint, error, hideLabel, ...rest }: TextAreaProps) {
  return withField({ label, hint, error, hideLabel, required: rest.required, id: rest.id }, <TextAreaControl {...rest} />);
}
function TextAreaControl({ value, onChange, className, ref, ...rest }: Omit<TextAreaProps, "label" | "hint" | "error" | "hideLabel">) {
  const field = useField();
  return <textarea ref={ref} {...rest} {...controlProps(field, rest)} className={cx("ri-textarea", className)} value={value} onChange={(event) => onChange(event.target.value)} />;
}

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends FieldShortcut, Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: string;
  onChange(value: string): void;
  options: SelectOption[];
  /** A first empty option such as "Choose a trip". */
  placeholder?: string;
}
/** A native select. With `label` it renders its own `Field`. */
export function Select({ label, hint, error, hideLabel, ...rest }: SelectProps) {
  return withField({ label, hint, error, hideLabel, required: rest.required, id: rest.id }, <SelectControl {...rest} />);
}
function SelectControl({ value, onChange, options, placeholder, className, ...rest }: Omit<SelectProps, "label" | "hint" | "error" | "hideLabel">) {
  const field = useField();
  return (
    <select {...rest} {...controlProps(field, rest)} className={cx("ri-select", className)} value={value} onChange={(event) => onChange(event.target.value)}>
      {placeholder !== undefined && <option value="" disabled={rest.required}>{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked" | "type"> {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}
/** A checkbox with its label and an optional hint. */
export function Checkbox({ label, hint, checked, onChange, className, id, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `ri-check${generated.replace(/:/g, "")}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <label className={cx("ri-check", className)} htmlFor={inputId}>
      <input {...rest} id={inputId} type="checkbox" checked={checked} aria-describedby={hintId} onChange={(event) => onChange(event.target.checked)} />
      <span className="ri-check__text">
        <span className="ri-check__label">{label}</span>
        {hint && <span id={hintId} className="ri-check__hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface RadioOption { value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }
/** A group of native radio buttons with a legend. Arrow keys move the choice. */
export function RadioGroup({ label, options, value, onChange, name, hint, error, className }: { label: ReactNode; options: RadioOption[]; value: string; onChange(value: string): void; name?: string; hint?: ReactNode; error?: ReactNode; className?: string }) {
  const generated = useId();
  const groupName = name ?? `ri-radio${generated.replace(/:/g, "")}`;
  const hintId = hint ? `${groupName}-hint` : undefined;
  const errorId = error ? `${groupName}-error` : undefined;
  return (
    <fieldset className={cx("ri-fieldset", className)} aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}>
      <legend>{label}</legend>
      <div className="ri-choice-list">
        {options.map((option) => {
          const id = `${groupName}-${option.value.replace(/[^A-Za-z0-9_-]/g, "_")}`;
          const optionHint = option.hint ? `${id}-hint` : undefined;
          return (
            <label key={option.value} className="ri-check" htmlFor={id}>
              <input id={id} type="radio" name={groupName} value={option.value} checked={value === option.value} disabled={option.disabled} aria-describedby={optionHint} onChange={() => onChange(option.value)} />
              <span className="ri-check__text">
                <span className="ri-check__label">{option.label}</span>
                {option.hint && <span id={optionHint} className="ri-check__hint">{option.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {hint && <p id={hintId} className="ri-field__hint">{hint}</p>}
      {error && <p id={errorId} className="ri-field__error"><DangerIcon /><span>{error}</span></p>}
    </fieldset>
  );
}

export interface DateInputProps extends FieldShortcut, Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type" | "min" | "max"> {
  /** A local date `YYYY-MM-DD`, or empty. */
  value: string | null;
  onChange(value: string | null): void;
  min?: string;
  max?: string;
}
/** A native date input over local `YYYY-MM-DD` dates. Never a midnight timestamp. */
export function DateInput({ label, hint, error, hideLabel, ...rest }: DateInputProps) {
  return withField({ label, hint, error, hideLabel, required: rest.required, id: rest.id }, <DateControl {...rest} />);
}
function DateControl({ value, onChange, className, ...rest }: Omit<DateInputProps, "label" | "hint" | "error" | "hideLabel">) {
  const field = useField();
  return <input {...rest} {...controlProps(field, rest)} type="date" className={cx("ri-input", className)} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />;
}

export interface MoneyValue {
  /** Integer minor units, or null when empty or not yet valid. */
  amountMinor: number | null;
  /** ISO 4217 code. */
  currency: string;
}
export interface MoneyInputProps {
  label: ReactNode;
  value: MoneyValue;
  /** Called on every change. `valid` is false while the typed text cannot be read as an amount. */
  onChange(value: MoneyValue, state: { valid: boolean; error: string | null }): void;
  currencies?: string[];
  hint?: ReactNode;
  /** An error from the caller, shown in place of the parse error. */
  error?: ReactNode;
  required?: boolean;
  allowNegative?: boolean;
  className?: string;
}
const DEFAULT_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "MXN"];
/**
 * An amount and an ISO currency. Emits integer minor units and the currency,
 * never a float. Typed text is kept while it is being edited.
 */
export function MoneyInput({ label, value, onChange, currencies = DEFAULT_CURRENCIES, hint, error, required, allowNegative, className }: MoneyInputProps) {
  const [text, setText] = useState(() => (value.amountMinor === null ? "" : minorToDecimal(value.amountMinor, value.currency)));
  const [parseError, setParseError] = useState<string | null>(null);
  const currencyId = useId();
  // Follow a new value from the caller unless it is what the typed text already means.
  useEffect(() => {
    const parsed = parseMoneyInput(text, value.currency, { allowNegative });
    if (parsed.ok && parsed.minor === value.amountMinor) return;
    if (!parsed.ok && value.amountMinor === null) return;
    setText(value.amountMinor === null ? "" : minorToDecimal(value.amountMinor, value.currency));
    setParseError(null);
  }, [value.amountMinor, value.currency]);
  const emit = (nextText: string, currency: string) => {
    const parsed = parseMoneyInput(nextText, currency, { allowNegative });
    const message = parsed.ok ? null : parsed.error;
    setParseError(message);
    onChange({ amountMinor: parsed.ok ? parsed.minor : null, currency }, { valid: parsed.ok, error: message });
  };
  const options = currencies.includes(value.currency) ? currencies : [value.currency, ...currencies];
  const digits = currencyDigits(value.currency);
  return (
    <Field label={label} hint={hint} error={error ?? parseError} required={required} className={className}>
      <MoneyControls>
        {(field) => (
          <div className="ri-money">
            <input
              id={field?.id}
              className="ri-input"
              inputMode={digits ? "decimal" : "numeric"}
              autoComplete="off"
              value={text}
              required={required}
              aria-invalid={field?.invalid || undefined}
              aria-describedby={field?.describedBy}
              placeholder={digits ? "0.00" : "0"}
              onChange={(event) => {
                setText(event.target.value);
                emit(event.target.value, value.currency);
              }}
            />
            <select
              id={currencyId}
              className="ri-select"
              aria-label="Currency"
              value={value.currency}
              onChange={(event) => emit(text, event.target.value)}
            >
              {options.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        )}
      </MoneyControls>
    </Field>
  );
}
function MoneyControls({ children }: { children: (field: FieldContextValue | null) => ReactNode }) {
  return <>{children(useField())}</>;
}
