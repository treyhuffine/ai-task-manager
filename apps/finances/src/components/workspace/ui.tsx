import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ArrowUpRight, X } from "lucide-react";
import { formatMoney } from "@/lib/finance/money";
import type { FinanceClient } from "./types";

export const money = (value: number | null | undefined, currency: string) =>
  value == null ? "Not added" : formatMoney(value, currency);
export const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const dateLabel = (value: string | null, full = false) =>
  value
    ? new Date(
        value.length === 10 ? value + "T12:00:00" : value,
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(full ? { year: "numeric" as const } : {}),
      })
    : "Not updated";
export const monthScope = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return {
    startOn: month + "-01",
    endOn: new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10),
  };
};
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal" + (wide ? " modal-wide" : "")}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = useRef(false);
  const run = async (fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This action could not finish.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}
export function AskButton({
  client,
  prompt,
  children,
}: {
  client: FinanceClient;
  prompt: string;
  children: ReactNode;
}) {
  const { run, error } = useOperation();
  return (
    <>
      <button
        className="text-button"
        onClick={() =>
          void run(async () => {
            await client.navigate(
              "/__host/chat?prompt=" + encodeURIComponent(prompt),
            );
          })
        }
      >
        {children}
        <ArrowUpRight size={15} />
      </button>
      <ErrorMessage message={error} />
    </>
  );
}
export function MoneyInput({
  name,
  label: caption,
  value,
  onChange,
  required = true,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field">
      {caption}
      <input
        name={name}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}
/** The network-free guest deliberately has no allow-forms sandbox privilege.
 * Keep native controls/validation, but perform tool calls from user events. */
export function Form({
  children,
  onSubmit,
}: {
  children: ReactNode;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) onSubmit(event);
  };
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      onClick={(event) => {
        const button = (event.target as HTMLElement).closest("button");
        if (button?.type === "submit" && !button.disabled) submit(event);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLInputElement &&
          event.target.type !== "checkbox"
        )
          submit(event);
      }}
    >
      {children}
    </form>
  );
}
