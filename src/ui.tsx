import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Check,
  CircleCheck,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { Link, useBlocker, useLocation } from "react-router-dom";
import { passwordChecks } from "../shared/validation";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="SubTrack home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path
            d="M11 15h13a6 6 0 0 1 0 12H13m16-2H16a6 6 0 0 1 0-12h11"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && "SubTrack"}
    </Link>
  );
}
export function Button({
  children,
  busy = false,
  tone = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  tone?: "primary" | "secondary" | "ghost";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`button ${tone === "primary" ? "" : tone} ${className}`}
      aria-busy={busy || undefined}
      disabled={busy || props.disabled}
    >
      <span className={busy ? "button-content hidden" : "button-content"}>
        {children}
      </span>
      {busy && (
        <span className="button-busy">
          <LoaderCircle className="spinner" size={19} />
          <span className="sr-only">Working…</span>
        </span>
      )}
    </button>
  );
}
export function Feedback({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "error";
  children: ReactNode;
}) {
  const Icon =
    tone === "error" ? TriangleAlert : tone === "success" ? CircleCheck : Info;
  return (
    <div
      className={`feedback ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
export function Loading({
  children = "Loading workspace…",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="loading-region" role="status">
      <LoaderCircle className="spinner" size={26} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
export function Field({
  label,
  error,
  help,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  help?: string;
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const description = [
    help ? `${fieldId}-help` : "",
    error ? `${fieldId}-error` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={description || undefined}
        {...props}
      />
      {help && (
        <span className="field-help" id={`${fieldId}-help`}>
          {help}
        </span>
      )}
      <span className="field-error" id={`${fieldId}-error`}>
        {error || "\u00a0"}
      </span>
    </div>
  );
}
export function PasswordField({
  label = "Password",
  error,
  help,
  id = "password",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  error?: string;
  help?: string;
}) {
  const [visible, setVisible] = useState(false);
  const description = [help ? `${id}-help` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="secret-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={description || undefined}
          {...props}
        />
        <button
          type="button"
          className="secret-toggle"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {help && (
        <span className="field-help" id={`${id}-help`}>
          {help}
        </span>
      )}
      <span className="field-error" id={`${id}-error`}>
        {error || "\u00a0"}
      </span>
    </div>
  );
}
export function PasswordRequirements({ value }: { value: string }) {
  const checks = passwordChecks(value);
  const requirements = [
    [checks.length, "9–128 characters"],
    [checks.uppercase, "Uppercase letter"],
    [checks.lowercase, "Lowercase letter"],
    [checks.special, "Special character"],
  ] as const;
  return (
    <ul className="password-requirements" aria-label="Password requirements">
      {requirements.map(([met, text]) => (
        <li key={text} className={met ? "met" : ""}>
          <Check size={13} aria-hidden="true" />
          <span>{text}</span>
          <span className="sr-only">{met ? " included" : " required"}</span>
        </li>
      ))}
    </ul>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  onCommit,
  onComposition,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onComposition: (active: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="search-field">
      <Search size={18} aria-hidden="true" />
      <input
        ref={ref}
        aria-label="Search by name or email"
        type="search"
        maxLength={100}
        placeholder="Search by name or email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => onComposition(true)}
        onCompositionEnd={() => onComposition(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onCommit();
          }
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  busy,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  busy: boolean;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span role="status">
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
          : "0 records"}
      </span>
      <nav aria-label="List pagination">
        <Button
          tone="secondary"
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span aria-current="page">
          Page {page} of {lastPage}
        </span>
        <Button
          tone="secondary"
          disabled={busy || page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
export function RouteFocus() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document
      .querySelector<HTMLHeadingElement>("main h1")
      ?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
export function useUnsavedChanges(dirty: boolean) {
  const allow = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allow.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (blocker.state === "blocked") {
      previousFocus.current = document.activeElement as HTMLElement | null;
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      previousFocus.current?.focus();
    }
  }, [blocker.state]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty && !allow.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const confirm = (
    <dialog
      className="confirmation-dialog"
      ref={dialog}
      aria-labelledby="discard-title"
      aria-describedby="discard-description"
      onCancel={(event) => {
        event.preventDefault();
        if (blocker.state === "blocked") blocker.reset();
      }}
    >
      <h2 id="discard-title">Leave this form?</h2>
      <p id="discard-description">Your unsaved entries will be discarded.</p>
      <div className="dialog-actions">
        <Button
          tone="secondary"
          autoFocus
          onClick={() => blocker.state === "blocked" && blocker.reset()}
        >
          Keep editing
        </Button>
        <Button
          onClick={() => blocker.state === "blocked" && blocker.proceed()}
        >
          Discard entries
        </Button>
      </div>
    </dialog>
  );
  return {
    allowNavigation: () => {
      allow.current = true;
    },
    confirm,
  };
}
