import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Database,
  LayoutDashboard,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Settings2,
  FileText,
  ReceiptText,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type {
  Delivery,
  Page,
  Role,
  User,
  WorkspaceSummary,
} from "../shared/contracts";
import { staffSchema } from "../shared/validation";
import { errorMessage, request } from "./api";
import { applyServerErrors, validateForm } from "./Auth";
import { useSession } from "./session";
import {
  Brand,
  Button,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PageHeading,
  Pagination,
  PasswordField,
  PasswordRequirements,
  SearchField,
  useUnsavedChanges,
} from "./ui";

const roleLabels: Record<Role, string> = {
  admin: "Administrator",
  staff: "Internal staff",
  customer: "Customer",
};
export function RequireSession({
  roles,
  inlineDenied = false,
}: {
  roles?: Role[];
  inlineDenied?: boolean;
}) {
  const { user } = useSession();
  const location = useLocation();
  if (!user)
    return (
      <Navigate
        to="/login"
        state={{ returnTo: location.pathname + location.search }}
        replace
      />
    );
  if (roles && !roles.includes(user.role))
    return <AccessDenied inline={inlineDenied} />;
  return <Outlet />;
}
export function AccessDenied({ inline = false }: { inline?: boolean }) {
  useEffect(() => {
    document.title = "Access restricted · SubTrack";
  }, []);
  return (
    <section aria-label="Access restricted">
      {!inline && <PageHeading title="Access restricted" />}
      <EmptyState
        icon={<ShieldCheck size={28} />}
        title="This area is restricted."
        action={
          <Link className="button" to="/workspace">
            Back to your workspace
            <ArrowRight size={18} />
          </Link>
        }
      >
        Your account doesn’t have permission to open this page. Your own
        workspace is still available.
      </EmptyState>
    </section>
  );
}
export function WorkspaceShell() {
  const session = useSession();
  const user = session.user!;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const navigation = useRef<HTMLElement>(null);
  const location = useLocation();
  useEffect(() => {
    const nav = navigation.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = active.offsetLeft - nav.offsetLeft - 12;
    }
  }, [location.pathname]);
  async function logout() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await request("/api/auth/logout", { method: "POST", body: {} });
      session.accept({ user: null, csrfToken: null });
      navigate("/login", { replace: true });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          <span className="workspace-emblem">
            <Building2 size={19} />
          </span>
          <div>
            <strong>Brightloop</strong>
            <small>
              {user.role === "customer"
                ? "Customer portal"
                : "Operations workspace"}
            </small>
          </div>
        </div>
        <nav
          className="primary-nav"
          aria-label="Main navigation"
          ref={navigation}
        >
          <NavLink to="/workspace" end>
            <LayoutDashboard size={19} />
            Workspace
          </NavLink>
          <NavLink to="/subscriptions">
            <FileText size={19} />
            Subscriptions
          </NavLink>
          <NavLink to="/billing/invoices">
            <ReceiptText size={19} />
            {user.role === "customer" ? "Invoices" : "Billing"}
          </NavLink>
          {user.role !== "customer" && (
            <NavLink to="/customers">
              <UsersRound size={19} />
              Customers
            </NavLink>
          )}
          {user.role !== "customer" && (
            <NavLink to="/configuration">
              <Settings2 size={19} />
              Configuration
            </NavLink>
          )}
          {user.role === "admin" && (
            <>
              <NavLink to="/staff">
                <ShieldCheck size={19} />
                Team access
              </NavLink>
              <NavLink to="/deliveries">
                <Mail size={19} />
                Email activity
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="identity-mini">
            <span className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role]}</small>
            </div>
          </div>
          <Button
            tone="ghost"
            className="logout-button"
            onClick={() => void logout()}
            busy={busy}
          >
            <LogOut size={18} />
            Sign out
          </Button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <span>
            {user.role === "customer"
              ? "Your Brightloop account"
              : "Brightloop Software"}
          </span>
          <span className="status info">
            <ShieldCheck size={13} />
            {roleLabels[user.role]}
          </span>
        </header>
        <main id="main" className="page-content">
          {error && <Feedback tone="error">{error}</Feedback>}
          {session.expired && (
            <Feedback tone="error">
              Your session has expired. <Link to="/login">Sign in again</Link>{" "}
              before continuing.
            </Feedback>
          )}
          {session.connectionWarning && (
            <Feedback>
              {session.connectionWarning} Your current entries are preserved.
            </Feedback>
          )}
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>SubTrack for Brightloop Software</span>
          <span>Asia/Kolkata business time</span>
        </footer>
      </div>
    </div>
  );
}
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(null);
      setError("");
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError("");
    request<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, busy, reload: () => setRevision((value) => value + 1) };
}
export function Workspace() {
  const { user } = useSession();
  const { data, error, busy, reload } =
    useResource<WorkspaceSummary>("/api/workspace");
  const location = useLocation();
  const message = (location.state as { message?: string } | null)?.message;
  useEffect(() => {
    document.title = "Workspace · SubTrack";
  }, []);
  return (
    <>
      <PageHeading
        title={user?.role === "customer" ? "Your workspace" : "Workspace"}
        description={`Welcome, ${user?.name.split(" ")[0]}. Here’s your Brightloop account at a glance.`}
        action={
          <Button tone="secondary" onClick={reload} disabled={busy}>
            <RefreshCw size={17} />
            Refresh
          </Button>
        }
      />
      {message && <Feedback tone="success">{message}</Feedback>}
      {error ? (
        <Feedback tone="error">
          {error}{" "}
          <button className="text-button" onClick={reload}>
            Retry
          </button>
        </Feedback>
      ) : busy && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <section className="welcome-panel">
              <div className="welcome-main">
                <span className="welcome-icon">
                  <ShieldCheck size={26} strokeWidth={1.6} />
                </span>
                <h2>
                  {user?.role === "customer"
                    ? "Your agreements, together."
                    : "Every agreement has a next step."}
                </h2>
                <p>
                  {user?.role === "customer"
                    ? "Review the subscriptions linked to your Brightloop account, including their service dates and agreed prices."
                    : "Prepare a quotation, review the commercial terms and follow each agreement into active service."}
                </p>
                {user?.role !== "customer" ? (
                  <Link className="button" to="/subscriptions/new">
                    <Plus size={18} />
                    New subscription
                  </Link>
                ) : (
                  <Link className="button" to="/subscriptions">
                    View subscriptions
                    <ArrowRight size={18} />
                  </Link>
                )}
              </div>
              <div className="account-sheet">
                <h3>Account details</h3>
                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>{user?.name}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{user?.email}</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>{user && roleLabels[user.role]}</dd>
                  </div>
                  <div>
                    <dt>Member since</dt>
                    <dd>{formatDate(user?.createdAt || "")}</dd>
                  </div>
                </dl>
              </div>
            </section>
            {user?.role !== "customer" && (
              <section
                className="workspace-directory"
                aria-labelledby="directory-title"
              >
                <div className="section-heading">
                  <h2 id="directory-title">People in your workspace</h2>
                  <span className="muted">From saved account records</span>
                </div>
                <div className="directory-row">
                  <div className="directory-symbol">
                    <UsersRound size={21} />
                  </div>
                  <div>
                    <h3>Customers</h3>
                    <p>Registered customer accounts</p>
                  </div>
                  <strong className="directory-count">
                    {data.customers.toLocaleString("en-IN")}
                  </strong>
                  <Link className="directory-link" to="/customers">
                    View customers
                    <ArrowRight size={17} />
                  </Link>
                </div>
                {user?.role === "admin" && (
                  <div className="directory-row">
                    <div className="directory-symbol">
                      <ShieldCheck size={21} />
                    </div>
                    <div>
                      <h3>Internal staff</h3>
                      <p>People with operational access</p>
                    </div>
                    <strong className="directory-count">
                      {data.staff.toLocaleString("en-IN")}
                    </strong>
                    <Link className="directory-link" to="/staff">
                      Manage team
                      <ArrowRight size={17} />
                    </Link>
                  </div>
                )}
              </section>
            )}
            <div className="workspace-health">
              <span>
                <Database size={16} />
                <strong>Database connected</strong>
              </span>
              <span>
                {formatBusinessDate(data.businessDate)} · {data.timezone}
              </span>
              {user?.role === "admin" && (
                <span>
                  Email:{" "}
                  {data.mailMode === "smtp"
                    ? "SMTP configured"
                    : "Development outbox"}
                </span>
              )}
            </div>
            {user?.role === "admin" && data.mailMode === "outbox" && (
              <p className="footnote">
                Development outbox generates messages locally. It does not
                deliver them to an inbox.
              </p>
            )}
          </>
        )
      )}
    </>
  );
}
export function useListQuery() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const pageValue = Number(params.get("page") || "1");
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const [draft, setDraft] = useState(query);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    setDraft(query);
  }, [query]);
  function commit(value = draft) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value.trim()) next.set("q", value.trim());
        else next.delete("q");
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    if (composing || draft.trim() === query) return;
    const timeout = window.setTimeout(() => commit(draft), 300);
    return () => clearTimeout(timeout);
  }, [draft, query, composing]);
  return {
    query,
    page,
    draft,
    setDraft: (value: string) => {
      setDraft(value);
      if (!value) commit("");
    },
    commit: () => commit(),
    setComposing,
    setPage: (value: number) => {
      const next = new URLSearchParams(params);
      if (value > 1) next.set("page", String(value));
      else next.delete("page");
      setParams(next);
    },
  };
}
export function PeopleList({ kind }: { kind: "staff" | "customers" }) {
  const query = useListQuery();
  const { data, error, busy, reload } = useResource<Page<User>>(
    `/api/${kind}?q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20`,
  );
  const location = useLocation();
  const message = (location.state as { message?: string } | null)?.message;
  const staff = kind === "staff";
  useEffect(() => {
    document.title = `${staff ? "Team access" : "Customers"} · SubTrack`;
  }, [staff]);
  useEffect(() => {
    if (data && query.page > Math.max(1, Math.ceil(data.total / data.pageSize)))
      query.setPage(Math.max(1, Math.ceil(data.total / data.pageSize)));
  }, [data, query.page]);
  return (
    <>
      <PageHeading
        title={staff ? "Team access" : "Customers"}
        description={
          staff
            ? "Internal staff can work across customer records. Only administrators can add team members."
            : "Customer accounts registered with Brightloop. Each customer has separate access to their own records."
        }
        action={
          staff ? (
            <Link className="button" to="/staff/new">
              <Plus size={18} />
              Add staff member
            </Link>
          ) : undefined
        }
      />
      {message && <Feedback tone="success">{message}</Feedback>}
      <section
        className="list-panel"
        aria-label={staff ? "Staff accounts" : "Customer accounts"}
      >
        <div className="list-toolbar">
          <SearchField
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <span className="list-count">
            {data
              ? `${data.total.toLocaleString("en-IN")} ${staff ? (data.total === 1 ? "team member" : "team members") : data.total === 1 ? "customer" : "customers"}`
              : "Saved accounts"}
          </span>
        </div>
        <div className="table-region" aria-busy={busy}>
          {error ? (
            <div className="list-error">
              <Feedback tone="error">{error}</Feedback>
              <Button tone="secondary" onClick={reload}>
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : busy ? (
            <Loading>Loading {staff ? "team members" : "customers"}…</Loading>
          ) : !data?.items.length ? (
            <EmptyState
              icon={
                staff ? <ShieldCheck size={26} /> : <UsersRound size={26} />
              }
              title={
                query.query
                  ? "No matching accounts."
                  : staff
                    ? "Your team starts here."
                    : "No customer accounts yet."
              }
              action={
                query.query ? (
                  <Button tone="secondary" onClick={() => query.setDraft("")}>
                    Clear search
                  </Button>
                ) : staff ? (
                  <Link className="button" to="/staff/new">
                    <Plus size={18} />
                    Add staff member
                  </Link>
                ) : undefined
              }
            >
              {query.query
                ? "Try a different name or email address."
                : staff
                  ? "Add a staff member to give them operational access."
                  : "Customer accounts appear here after they sign up."}
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">
                {staff ? "Internal staff" : "Customer"} accounts, page{" "}
                {query.page}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email address</th>
                  <th scope="col">Access</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((person) => (
                  <tr key={person.id}>
                    <td data-label="Name">
                      <span className="person-cell">
                        <span className="avatar small">
                          {person.name.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{person.name}</strong>
                      </span>
                    </td>
                    <td data-label="Email address">{person.email}</td>
                    <td data-label="Access">
                      <span className="status info">
                        {roleLabels[person.role]}
                      </span>
                    </td>
                    <td data-label="Joined" className="date-cell">
                      {formatDate(person.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={query.page}
          pageSize={data?.pageSize || 20}
          total={data?.total || 0}
          onPage={query.setPage}
          busy={busy}
        />
      </section>
    </>
  );
}
export function AddStaff() {
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
    document.title = "Add staff member · SubTrack";
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const invalid = validateForm(staffSchema, values, form);
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setBusy(true);
    try {
      await request("/api/staff", { method: "POST", body: values });
      guard.allowNavigation();
      navigate("/staff", {
        state: {
          message: `${values.name.trim()} was added to the internal team.`,
        },
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
    <>
      <Link className="back-link" to="/staff">
        <ArrowLeft size={16} />
        Back to team access
      </Link>
      <PageHeading
        title="Add staff member"
        description="Create an internal account with operational access to Brightloop customer records."
      />
      <div className="form-layout">
        <form
          className="panel edit-form"
          noValidate
          onSubmit={submit}
          aria-label="Add staff member"
        >
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
            label="Initial password"
            autoComplete="new-password"
            value={values.password}
            error={fields.password}
            help="Share the initial password through your approved secure channel."
            onChange={(event) =>
              setValues({ ...values, password: event.target.value })
            }
          />
          <PasswordRequirements value={values.password} />
          <div className="form-actions">
            <Link className="button secondary" to="/staff">
              Cancel
            </Link>
            <Button type="submit" busy={busy}>
              <Plus size={18} />
              Add staff member
            </Button>
          </div>
        </form>
        <aside className="form-aside">
          <ShieldCheck size={25} strokeWidth={1.6} />
          <h2>Internal staff access</h2>
          <p>
            Staff work across customer accounts. They can’t add other staff or
            change administrator-owned configuration.
          </p>
          <p className="muted">
            The account is saved immediately. No invitation email is sent by
            this action.
          </p>
        </aside>
      </div>
      {guard.confirm}
    </>
  );
}
export function Deliveries() {
  const [params, setParams] = useSearchParams();
  const parsed = Number(params.get("page") || "1");
  const page = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  const { data, error, busy, reload } = useResource<Page<Delivery>>(
    `/api/deliveries?page=${page}&pageSize=20`,
  );
  useEffect(() => {
    document.title = "Email activity · SubTrack";
  }, []);
  const statusLabels: Record<Delivery["status"], string> = {
    generated: "Generated / queued",
    sending: "Sending",
    accepted: "Accepted by SMTP",
    failed: "Failed",
    unknown: "Delivery uncertain",
  };
  return (
    <>
      <PageHeading
        title="Email activity"
        description="Message generation and handoff records. Reset links and message bodies stay out of this view."
        action={
          <Button tone="secondary" onClick={reload} disabled={busy}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <Feedback>
        A generated or queued message is not evidence of inbox delivery.
        “Accepted by SMTP” means the mail server accepted the message; it does
        not verify inbox arrival.
      </Feedback>
      <section className="list-panel" aria-label="Email activity">
        <div className="table-region" aria-busy={busy}>
          {error ? (
            <div className="list-error">
              <Feedback tone="error">{error}</Feedback>
              <Button tone="secondary" onClick={reload}>
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : busy ? (
            <Loading>Loading email activity…</Loading>
          ) : !data?.items.length ? (
            <EmptyState
              icon={<Mail size={26} />}
              title="No email activity yet."
            >
              Password reset requests for registered accounts appear here when a
              message is generated.
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">Email activity, page {page}</caption>
              <thead>
                <tr>
                  <th scope="col">Message</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((delivery) => (
                  <tr key={delivery.id}>
                    <td data-label="Message">
                      <strong>{delivery.subject}</strong>
                      {delivery.error && (
                        <small className="delivery-error">
                          {delivery.error}
                        </small>
                      )}
                    </td>
                    <td data-label="Recipient">{delivery.recipient}</td>
                    <td data-label="Status">
                      <span
                        className={`status ${delivery.status === "failed" ? "danger" : delivery.status === "accepted" ? "success" : "warning"}`}
                      >
                        {statusLabels[delivery.status]}
                      </span>
                    </td>
                    <td data-label="Created" className="date-cell">
                      {formatDate(delivery.createdAt, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={page}
          pageSize={data?.pageSize || 20}
          total={data?.total || 0}
          onPage={(value) =>
            setParams(value > 1 ? { page: String(value) } : {})
          }
          busy={busy}
        />
      </section>
    </>
  );
}
export function NotFound() {
  useEffect(() => {
    document.title = "Page not found · SubTrack";
  }, []);
  return (
    <main className="standalone-page" id="main">
      <Brand />
      <PageHeading title="Page not found" />
      <EmptyState
        icon={<UserRound size={28} />}
        title="We can’t find that page."
        action={
          <Link className="button" to="/workspace">
            Back to your workspace
            <ArrowRight size={18} />
          </Link>
        }
      >
        The address may have changed. Return to your workspace to continue.
      </EmptyState>
    </main>
  );
}
export function SessionBoundary({ children }: { children: ReactNode }) {
  const { loading, error, refresh } = useSession();
  if (loading)
    return (
      <main className="initial-loading">
        <Brand />
        <Loading>Opening your workspace…</Loading>
      </main>
    );
  if (error)
    return (
      <main className="standalone-page">
        <Brand />
        <div className="connection-failure">
          <PageHeading title="Your workspace couldn’t load." />
          <Feedback tone="error">{error}</Feedback>
          <Button onClick={() => void refresh()}>
            <RefreshCw />
            Retry connection
          </Button>
        </div>
      </main>
    );
  return children;
}
export function formatDate(value: string, time = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
    ...(time
      ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" }
      : {}),
  }).format(date);
}
export function formatBusinessDate(value: string) {
  return formatDate(`${value}T12:00:00+05:30`);
}
