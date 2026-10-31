import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import {
  loginSchema,
  resetRequestSchema,
  resetSchema,
  signupSchema,
} from "../shared/validation";
import type { SessionResponse } from "../shared/contracts";
import { parseAmount } from "../shared/money";
import { errorMessage, request, RequestError } from "./api";
import {
  Brand,
  Button,
  Feedback,
  Field,
  PasswordField,
  PasswordRequirements,
  useUnsavedChanges,
} from "./ui";
import { useSession } from "./session";

export function validateForm(
  schema: z.ZodType,
  value: unknown,
  form: HTMLFormElement,
): Record<string, string> | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "form";
    let message = issue.message;
    const input = form.querySelector<HTMLInputElement>(`[name="${key}"]`);
    if (issue.code === "invalid_type" && input?.inputMode === "decimal") {
      try {
        parseAmount(input.value, input.dataset.signed === "true");
      } catch (reason) {
        message = errorMessage(reason);
      }
    } else if (issue.code === "invalid_type" && input?.inputMode === "numeric")
      message = "Enter a whole number.";
    if (
      (key === "rateBps" || key === "percentBps") &&
      (issue.code === "too_big" || issue.code === "too_small")
    )
      message = "Use a percentage from 0 to 100.";
    if (!fields[key]) fields[key] = message;
  }
  window.setTimeout(
    () =>
      form
        .querySelector<HTMLInputElement>(`[name="${Object.keys(fields)[0]}"]`)
        ?.focus(),
    0,
  );
  return fields;
}
export function applyServerErrors(
  reason: unknown,
  form: HTMLFormElement,
  setFields: (fields: Record<string, string>) => void,
) {
  if (reason instanceof RequestError && Object.keys(reason.fields).length) {
    setFields(reason.fields);
    window.setTimeout(
      () =>
        form
          .querySelector<HTMLInputElement>(
            `[name="${Object.keys(reason.fields)[0]}"]`,
          )
          ?.focus(),
      0,
    );
  }
}
function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="auth-story-content">
          <h2>
            Good agreements.
            <br />
            Clear beginnings.
          </h2>
          <p>
            A shared workspace for Brightloop’s subscription business, with the
            right access for every person.
          </p>
          <ol className="agreement-trail">
            <li>
              <span>
                <Check size={17} />
              </span>
              <div>
                <strong>Set the terms</strong>
                <small>A clear agreement to work from</small>
              </div>
            </li>
            <li>
              <span>
                <Check size={17} />
              </span>
              <div>
                <strong>Keep the record</strong>
                <small>One consistent source of truth</small>
              </div>
            </li>
            <li>
              <span>
                <Check size={17} />
              </span>
              <div>
                <strong>Know the next step</strong>
                <small>The right action for your role</small>
              </div>
            </li>
          </ol>
        </div>
        <div className="auth-story-footer">
          <span className="small-loop" aria-hidden="true" />
          <span>Brightloop Software</span>
        </div>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">{children}</div>
        <footer className="auth-footer">
          <ShieldCheck size={16} strokeWidth={1.75} />
          <span>Your workspace, with access shaped around your role.</span>
        </footer>
      </main>
    </div>
  );
}
export function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    document.title = "Sign in · SubTrack";
  }, []);
  if (session.user && !session.expired)
    return <Navigate to="/workspace" replace />;
  const successMessage = (location.state as { message?: string } | null)
    ?.message;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const invalid = validateForm(loginSchema, values, form);
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setBusy(true);
    try {
      session.accept(
        await request<SessionResponse>("/api/auth/login", {
          method: "POST",
          body: values,
        }),
      );
      const target = (location.state as { returnTo?: string } | null)?.returnTo;
      navigate(
        target?.startsWith("/") && !target.startsWith("//")
          ? target
          : "/workspace",
        { replace: true },
      );
    } catch (reason) {
      setError(errorMessage(reason));
      applyServerErrors(reason, form, setFields);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <div className="auth-title-icon">
        <LockKeyhole size={22} />
      </div>
      <h1 tabIndex={-1}>Welcome back.</h1>
      <p className="auth-description">Sign in to your Brightloop workspace.</p>
      {successMessage && <Feedback tone="success">{successMessage}</Feedback>}
      <form noValidate onSubmit={submit} aria-label="Sign in">
        {error && <Feedback tone="error">{error}</Feedback>}
        <Field
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="username"
          value={values.email}
          error={fields.email}
          onChange={(event) =>
            setValues({ ...values, email: event.target.value })
          }
        />
        <PasswordField
          name="password"
          autoComplete="current-password"
          value={values.password}
          error={fields.password}
          onChange={(event) =>
            setValues({ ...values, password: event.target.value })
          }
        />
        <div className="auth-form-row">
          <Link to="/forgot-password">Forgot your password?</Link>
        </div>
        <Button type="submit" busy={busy} className="full-width">
          Sign in
          <ArrowRight />
        </Button>
      </form>
      <p className="auth-switch">
        New to Brightloop? <Link to="/signup">Create a customer account</Link>
      </p>
    </AuthFrame>
  );
}
export function Signup() {
  const session = useSession();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const guard = useUnsavedChanges(
    !!(values.name || values.email || values.password),
  );
  useEffect(() => {
    document.title = "Create account · SubTrack";
  }, []);
  if (session.user) return <Navigate to="/workspace" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const invalid = validateForm(signupSchema, values, form);
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setBusy(true);
    try {
      const next = await request<SessionResponse>("/api/auth/signup", {
        method: "POST",
        body: values,
      });
      guard.allowNavigation();
      session.accept(next);
      navigate("/workspace", {
        replace: true,
        state: { message: "Your customer account is ready." },
      });
    } catch (reason) {
      setError(errorMessage(reason));
      applyServerErrors(reason, form, setFields);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <h1 tabIndex={-1}>Your account starts here.</h1>
      <p className="auth-description">
        Create a customer account to access your own Brightloop records.
      </p>
      <form noValidate onSubmit={submit} aria-label="Create customer account">
        {error && <Feedback tone="error">{error}</Feedback>}
        <Field
          id="name"
          name="name"
          label="Full name"
          autoComplete="name"
          value={values.name}
          error={fields.name}
          onChange={(event) =>
            setValues({ ...values, name: event.target.value })
          }
        />
        <Field
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={values.email}
          error={fields.email}
          onChange={(event) =>
            setValues({ ...values, email: event.target.value })
          }
        />
        <PasswordField
          name="password"
          autoComplete="new-password"
          value={values.password}
          error={fields.password}
          onChange={(event) =>
            setValues({ ...values, password: event.target.value })
          }
        />
        <PasswordRequirements value={values.password} />
        <Button type="submit" busy={busy} className="full-width">
          Create account
          <ArrowRight />
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
      {guard.confirm}
    </AuthFrame>
  );
}
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    document.title = "Reset password · SubTrack";
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const invalid = validateForm(resetRequestSchema, { email }, form);
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setBusy(true);
    try {
      await request("/api/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setSuccess(true);
    } catch (reason) {
      setError(errorMessage(reason));
      applyServerErrors(reason, form, setFields);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <Link className="back-link" to="/login">
        <ArrowLeft size={16} />
        Back to sign in
      </Link>
      <div className="auth-title-icon">
        <Mail size={22} />
      </div>
      <h1 tabIndex={-1}>Let’s get you back in.</h1>
      <p className="auth-description">
        Enter the email address you use for Brightloop. If it’s registered,
        we’ll prepare a password reset link.
      </p>
      {success && (
        <Feedback tone="success">
          If that address is registered, a reset link has been requested. Check
          your inbox. In development outbox mode, no message is delivered to an
          inbox.
        </Feedback>
      )}
      <form noValidate onSubmit={submit} aria-label="Request password reset">
        {error && <Feedback tone="error">{error}</Feedback>}
        <Field
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          error={fields.email}
          onChange={(event) => {
            setEmail(event.target.value);
            setSuccess(false);
          }}
        />
        <Button type="submit" busy={busy} className="full-width">
          Request reset link
          <ArrowRight />
        </Button>
      </form>
      <p className="auth-switch">
        Reset links expire and can be used only once.
      </p>
    </AuthFrame>
  );
}
export function ResetPassword() {
  const navigate = useNavigate();
  const session = useSession();
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") || "",
  );
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [invalidToken, setInvalidToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const guard = useUnsavedChanges(!!password);
  useLayoutEffect(() => {
    document.title = "Choose a password · SubTrack";
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const invalid = validateForm(resetSchema, { token, password }, form);
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setBusy(true);
    try {
      await request("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      guard.allowNavigation();
      session.accept({ user: null, csrfToken: null });
      navigate("/login", {
        replace: true,
        state: { message: "Password updated. Sign in with your new password." },
      });
    } catch (reason) {
      setError(errorMessage(reason));
      setInvalidToken(
        reason instanceof RequestError && reason.code === "INVALID_RESET",
      );
      applyServerErrors(reason, form, setFields);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <Link className="back-link" to="/login">
        <ArrowLeft size={16} />
        Back to sign in
      </Link>
      <h1 tabIndex={-1}>A fresh start.</h1>
      <p className="auth-description">
        Choose a new password for your Brightloop account.
      </p>
      {!token ? (
        <Feedback tone="error">
          This reset link is missing its token.{" "}
          <Link to="/forgot-password">Request a new reset link.</Link>
        </Feedback>
      ) : (
        <form noValidate onSubmit={submit} aria-label="Set new password">
          {error && (
            <Feedback tone="error">
              {error}
              {invalidToken ? (
                <>
                  {" "}
                  <Link to="/forgot-password">Request a new reset link.</Link>
                </>
              ) : (
                <>
                  {" "}
                  <Link to="/login">Check by signing in</Link> if this request
                  may already have completed.
                </>
              )}
            </Feedback>
          )}
          {fields.token && (
            <Feedback tone="error">
              {fields.token}{" "}
              <Link to="/forgot-password">Request a new link.</Link>
            </Feedback>
          )}
          <PasswordField
            name="password"
            label="New password"
            autoComplete="new-password"
            value={password}
            error={fields.password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <PasswordRequirements value={password} />
          <Button type="submit" busy={busy} className="full-width">
            Update password
            <ArrowRight />
          </Button>
        </form>
      )}
      <p className="auth-switch">
        Updating your password signs out all existing sessions.
      </p>
      {guard.confirm}
    </AuthFrame>
  );
}
