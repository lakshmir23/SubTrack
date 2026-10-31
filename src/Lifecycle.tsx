import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, RefreshCw, Settings2 } from "lucide-react";
import {
  lifecycleActionSchema,
  lifecycleRenewSchema,
  lifecycleAddonSchema,
  lifecycleProcessSchema,
  type LifecycleAction,
  type LifecycleAddon,
  type LifecycleEvent,
  type LifecycleState,
  type LifecycleProcessResult,
} from "../shared/lifecycle";
import { formatMoney } from "../shared/money";
import { errorMessage, request } from "./api";
import { validateForm } from "./Auth";
import { whole } from "./Catalog";
import { formatBusinessDate, formatDate, useResource } from "./Workspace";
import {
  Button,
  ConfirmationDialog,
  Feedback,
  Field,
  Loading,
  PageHeading,
  Pagination,
  SelectField,
} from "./ui";

const labels: Record<LifecycleAction, string> = {
  pause: "Pause service",
  resume: "Resume service",
  renew: "Renew term",
  closeEarly: "Close early",
  closeTerm: "Close ended term",
};
const paths: Record<LifecycleAction, string> = {
  pause: "pause",
  resume: "resume",
  renew: "renew",
  closeEarly: "close-early",
  closeTerm: "close-term",
};
type Review =
  | { action: LifecycleAction; periods?: number }
  | { addon: LifecycleAddon; enabled: boolean };
export function ServiceDetailRoute() {
  const { id } = useParams();
  return <ServiceDetail key={id} id={id!} />;
}
function ServiceDetail({ id }: { id: string }) {
  const location = useLocation();
  const origin = (location.state as { returnTo?: string } | null)?.returnTo;
  const agreementState =
    origin?.startsWith("/finance") || origin?.startsWith("/subscriptions")
      ? { returnTo: origin }
      : undefined;
  const resource = useResource<LifecycleState>(
    `/api/subscriptions/${id}/lifecycle`,
  );
  const [override, setOverride] = useState<LifecycleState | null>(null),
    [action, setAction] = useState<LifecycleAction | "">(""),
    [periods, setPeriods] = useState("1"),
    [fields, setFields] = useState<Record<string, string>>({});
  const [review, setReview] = useState<
      (Review & { key: string; version: number }) | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const pending = useRef(false),
    receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const state = override || resource.data;
  useEffect(() => {
    setOverride(null);
  }, [resource.data]);
  useEffect(() => {
    document.title = `${state?.number || "Agreement"} service · SubTrack`;
  }, [state?.number]);
  useEffect(() => {
    if (state && !state.allowedActions.includes(action as LifecycleAction))
      setAction(state.allowedActions[0] || "");
  }, [state, action]);
  function keyFor(value: unknown) {
    const fingerprint = JSON.stringify(value);
    if (receipt.current?.fingerprint !== fingerprint)
      receipt.current = { fingerprint, key: crypto.randomUUID() };
    return receipt.current.key;
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !action || resource.busy) return;
    const values = {
      version: state.version,
      idempotencyKey: crypto.randomUUID(),
      ...(action === "renew" ? { periods: whole(periods, "periods") } : {}),
    };
    const invalid = validateForm(
      action === "renew" ? lifecycleRenewSchema : lifecycleActionSchema,
      values,
      event.currentTarget,
    );
    setFields(invalid || {});
    if (invalid) return;
    const command: Review = {
      action,
      ...(action === "renew" ? { periods: whole(periods, "periods") } : {}),
    };
    setError("");
    setReview({
      ...command,
      version: state.version,
      key: keyFor([state.version, command]),
    });
  }
  function addonReview(addon: LifecycleAddon) {
    if (!state || resource.busy) return;
    const enabled = !(addon.nextChange?.enabled ?? addon.enabled);
    const command = { addon, enabled };
    const key = keyFor([state.version, addon.lineId, enabled]);
    if (
      !lifecycleAddonSchema.safeParse({
        version: state.version,
        idempotencyKey: key,
        enabled,
      }).success
    )
      return;
    setError("");
    setReview({ ...command, version: state.version, key });
  }
  async function save() {
    if (!state || !review || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const endpoint =
      "addon" in review
        ? `addons/${review.addon.lineId}`
        : paths[review.action];
    const body = {
      version: review.version,
      idempotencyKey: review.key,
      ...("addon" in review
        ? { enabled: review.enabled }
        : review.action === "renew"
          ? { periods: review.periods }
          : {}),
    };
    try {
      const changed = await request<LifecycleState>(
        `/api/subscriptions/${id}/${endpoint}`,
        { method: "POST", body },
      );
      const previous = new Set(state.history.map((event) => event.id));
      const event = changed.history.find((item) => !previous.has(item.id));
      setOverride(changed);
      setReview(null);
      setSuccess(
        event
          ? `${event.message} Requested ${formatBusinessDate(event.requestedDate)}; effective ${formatBusinessDate(event.effectiveDate)}.`
          : "The request was saved. Review its persisted dates below.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function refresh() {
    resource.reload();
  }
  if (resource.busy && !state)
    return <Loading>Loading service policies and effective dates…</Loading>;
  if (!state)
    return (
      <>
        <PageHeading title="Service details couldn’t load." />
        <Feedback tone="error">
          {resource.error || "This agreement is unavailable."}
        </Feedback>
        <Button tone="secondary" onClick={resource.reload}>
          Retry
        </Button>
        <Link to={`/subscriptions/${id}`}>Back to agreement</Link>
      </>
    );
  const title = !review
    ? "Review service change"
    : "addon" in review
      ? `${review.enabled ? "Enable" : "Disable"} this optional line?`
      : `${labels[review.action]}?`;
  const effectiveDate =
    review && "action" in review && review.action !== "renew"
      ? state.actionEffectiveDates[review.action]
      : null;
  const history = state.history.slice((historyPage - 1) * 20, historyPage * 20);
  const scheduled = state.scheduled.filter(
    (event, index, all) =>
      !event.lineId ||
      !all
        .slice(index + 1)
        .some(
          (later) =>
            later.lineId === event.lineId &&
            later.effectiveDate === event.effectiveDate,
        ),
  );
  return (
    <>
      <Link
        className="back-link"
        to={`/subscriptions/${id}`}
        state={agreementState}
      >
        <ArrowLeft size={16} />
        Back to {state.number}
      </Link>
      <PageHeading
        title="Manage service"
        autoFocus
        description={`${state.number} · Accepted plan policies and original schedule boundaries.`}
        action={
          <Button tone="secondary" onClick={refresh} disabled={resource.busy}>
            <RefreshCw size={16} />
            Refresh service
          </Button>
        }
      />
      {resource.error && (
        <Feedback tone="error">
          {resource.error} The last-read service state remains visible.
        </Feedback>
      )}
      {success && <Feedback tone="success">{success}</Feedback>}
      <div className="service-context">
        <span
          className={`status ${state.serviceState === "Running" ? "success" : state.serviceState === "TermEnded" ? "warning" : "info"}`}
        >
          {state.serviceState === "TermEnded"
            ? "Term ended — close or renew"
            : state.serviceState}
        </span>
        <span>Business date · {formatBusinessDate(state.businessDate)}</span>
        <span>Expiry · {formatBusinessDate(state.expiryDate)} (exclusive)</span>
      </div>
      {scheduled.length > 0 && (
        <section
          className="service-scheduled"
          aria-labelledby="scheduled-title"
        >
          <h2 id="scheduled-title">Scheduled changes</h2>
          <ul>
            {scheduled.map((event) => (
              <li key={event.id}>
                <strong>{event.message}</strong>
                <span>
                  Requested {formatBusinessDate(event.requestedDate)} ·
                  effective {formatBusinessDate(event.effectiveDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="service-layout">
        <section className="panel service-change">
          <h2>Change service</h2>
          {state.allowedActions.length ? (
            <form noValidate aria-label="Service change" onSubmit={prepare}>
              <SelectField
                name="action"
                label="Service action"
                value={action}
                onChange={(event) =>
                  setAction(event.target.value as LifecycleAction)
                }
              >
                {state.allowedActions.map((item) => (
                  <option key={item} value={item}>
                    {labels[item]}
                  </option>
                ))}
              </SelectField>
              {action &&
                action !== "renew" &&
                state.actionEffectiveDates[action] && (
                  <p className="field-help">
                    Takes effect on{" "}
                    {formatBusinessDate(state.actionEffectiveDates[action]!)}.
                  </p>
                )}
              {action === "renew" && (
                <Field
                  name="periods"
                  label="Additional billing periods"
                  inputMode="numeric"
                  value={periods}
                  error={fields.periods}
                  help={`Add whole ${state.policies.interval} periods at the agreed prices. Billing dates keep the original schedule.`}
                  onChange={(event) => setPeriods(event.target.value)}
                />
              )}
              <p className="field-help">
                Changes start on an eligible billing date. Previously issued
                invoices stay unchanged.
              </p>
              <Button type="submit" disabled={resource.busy}>
                <Settings2 size={16} />
                Review service change
              </Button>
            </form>
          ) : (
            <p className="field-help">
              No service transition is currently permitted. Review the accepted
              policies and reasons below.
            </p>
          )}
          <details className="service-policy">
            <summary>Plan permissions and unavailable actions</summary>
            <dl>
              {(Object.keys(labels) as LifecycleAction[]).map((item) => (
                <div key={item}>
                  <dt>{labels[item]}</dt>
                  <dd>
                    {state.allowedActions.includes(item)
                      ? "Available"
                      : state.deniedReasons[item] ||
                        "Unavailable for this service state."}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
        <section className="panel service-period">
          <h2>Next billing period to review</h2>
          {state.nextPeriod ? (
            <>
              <p className="field-help">
                {formatBusinessDate(state.nextPeriod.start)} to{" "}
                {formatBusinessDate(state.nextPeriod.end)} · exclusive end
              </p>
              <span
                className={`status ${state.nextPeriod.billable ? "info" : "warning"}`}
              >
                {state.nextPeriod.billable
                  ? "Billable accepted base"
                  : "Non-billable"}
              </span>
              {state.nextPeriod.reason && (
                <p className="field-help">{state.nextPeriod.reason}</p>
              )}
              <dl className="service-period-lines">
                {state.nextPeriod.lines.map((line) => (
                  <div key={line.lineId}>
                    <dt>
                      {line.productName}
                      <small>
                        {line.quantity} × {formatMoney(line.unitPrice)}
                      </small>
                    </dt>
                    <dd>{formatMoney(line.subtotal)}</dd>
                  </div>
                ))}
                <div className="grand-total">
                  <dt>Accepted active base subtotal</dt>
                  <dd>{formatMoney(state.nextPeriod.subtotal)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="field-help">
              All service periods in this term have been handled.
            </p>
          )}
          <p className="footnote">{state.estimateExplanation}</p>
        </section>
      </div>
      <section
        className="service-addons"
        aria-labelledby="optional-lines-title"
      >
        <div className="section-heading">
          <h2 id="optional-lines-title">Accepted product lines</h2>
          <span>Optional changes keep their accepted unit prices.</span>
        </div>
        {state.addons.map((addon) => (
          <article key={addon.lineId}>
            <div>
              <h3>{addon.productName}</h3>
              <p>
                {addon.quantity} × {formatMoney(addon.unitPrice)} per billing
                period
              </p>
              <span className={`status ${addon.enabled ? "success" : "info"}`}>
                {addon.primary
                  ? "Required primary line"
                  : addon.enabled
                    ? "Included now"
                    : "Not included now"}
              </span>
              {addon.nextChange && (
                <p className="scheduled-line">
                  {addon.nextChange.enabled ? "Enable" : "Disable"} effective{" "}
                  {formatBusinessDate(addon.nextChange.effectiveDate)} ·
                  requested {formatBusinessDate(addon.nextChange.requestedDate)}
                </p>
              )}
              {addon.deniedReason && !addon.canToggle && (
                <p className="field-help">{addon.deniedReason}</p>
              )}
              <details className="addon-intervals">
                <summary>Effective intervals</summary>
                <ul>
                  {addon.intervals.map((interval, index) => (
                    <li key={index}>
                      {interval.enabled ? "Included" : "Excluded"} from{" "}
                      {formatBusinessDate(interval.from)}
                      {interval.to
                        ? ` until ${formatBusinessDate(interval.to)} (exclusive)`
                        : " onward"}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            {addon.canToggle && (
              <Button
                tone="secondary"
                disabled={resource.busy}
                onClick={() => addonReview(addon)}
              >
                {addon.nextChange
                  ? addon.nextChange.enabled
                    ? "Schedule optional line disabled"
                    : "Keep optional line enabled"
                  : `${addon.enabled ? "Disable" : "Enable"} optional line`}
                <span className="sr-only"> {addon.productName}</span>
              </Button>
            )}
          </article>
        ))}
      </section>
      <section
        className="agreement-history service-history"
        aria-labelledby="service-history-title"
      >
        <h2 id="service-history-title">Service history</h2>
        {history.length ? (
          <ol>
            {history.map((event) => (
              <ServiceHistoryItem key={event.id} event={event} />
            ))}
          </ol>
        ) : (
          <p className="field-help">
            No service-change request has been recorded yet.
          </p>
        )}
        {state.history.length > 20 && (
          <Pagination
            page={historyPage}
            pageSize={20}
            total={state.history.length}
            onPage={setHistoryPage}
            busy={false}
          />
        )}
      </section>
      <ConfirmationDialog
        open={!!review}
        title={title}
        description={
          review && "addon" in review
            ? "Schedule this optional line change for an eligible billing date. Earlier invoices and amounts owed stay unchanged."
            : review?.action === "renew"
              ? "Extend the term at the agreed prices for the periods shown. Renewals keep the original billing schedule. A term that ended before today needs a new quotation."
              : "Apply the agreed plan rules from the effective date shown. Existing invoices and earlier amounts owed stay unchanged."
        }
        confirmLabel={
          review && "addon" in review
            ? "Save optional line change"
            : review
              ? labels[review.action]
              : "Save change"
        }
        intent={
          review &&
          "action" in review &&
          (review.action === "closeEarly" || review.action === "closeTerm")
            ? "danger"
            : "neutral"
        }
        busy={busy}
        error={error}
        onCancel={() => setReview(null)}
        onConfirm={() => void save()}
      >
        <dl className="confirmation-summary">
          <div>
            <dt>Agreement</dt>
            <dd>{state.number}</dd>
          </div>
          <div>
            <dt>Request business date</dt>
            <dd>{formatBusinessDate(state.businessDate)}</dd>
          </div>
          {effectiveDate && (
            <div>
              <dt>Effective date</dt>
              <dd>{formatBusinessDate(effectiveDate)}</dd>
            </div>
          )}
          {review && "addon" in review && (
            <div>
              <dt>Optional line</dt>
              <dd>
                {review.addon.productName} ·{" "}
                {review.enabled ? "enable" : "disable"}
              </dd>
            </div>
          )}
          {review && "action" in review && review.action === "renew" && (
            <>
              <div>
                <dt>Existing expiry (exclusive)</dt>
                <dd>{formatBusinessDate(state.expiryDate)}</dd>
              </div>
              <div>
                <dt>Additional periods</dt>
                <dd>
                  {review.periods} {state.policies.interval} periods
                </dd>
              </div>
            </>
          )}
        </dl>
        <p className="footnote">
          {effectiveDate
            ? "This date follows the agreed billing schedule."
            : "The confirmation will show the effective date or new expiry."}{" "}
          Earlier invoices stay unchanged.
        </p>
        {error && (
          <p className="footnote">
            Cancel and refresh service details if the result is unclear or
            another change was recorded. Retrying the unchanged review returns
            the same request.
          </p>
        )}
      </ConfirmationDialog>
    </>
  );
}
function ServiceHistoryItem({ event }: { event: LifecycleEvent }) {
  return (
    <li>
      <span className="history-dot" aria-hidden="true" />
      <div>
        <strong>{event.message}</strong>
        <p>
          {event.actorName} · recorded {formatDate(event.createdAt, true)}
        </p>
        <small>
          Requested {formatBusinessDate(event.requestedDate)} · effective{" "}
          {formatBusinessDate(event.effectiveDate)} · {event.status}
        </small>
        {event.previousExpiry && event.newExpiry && (
          <small>
            Expiry {formatBusinessDate(event.previousExpiry)} →{" "}
            {formatBusinessDate(event.newExpiry)}
          </small>
        )}
      </div>
    </li>
  );
}

export function ServiceProcessing() {
  const [limit, setLimit] = useState("100"),
    [fields, setFields] = useState<Record<string, string>>({}),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<LifecycleProcessResult | null>(null);
  const pending = useRef(false);
  const [reviewLimit, setReviewLimit] = useState(100);
  useEffect(() => {
    document.title = "Process service changes · SubTrack";
  }, []);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = { limit: whole(limit, "limit") };
    const invalid = validateForm(
      lifecycleProcessSchema,
      value,
      event.currentTarget,
    );
    setFields(invalid || {});
    if (invalid) return;
    setReviewLimit(value.limit);
    setError("");
    setConfirm(true);
  }
  async function process() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await request<LifecycleProcessResult>(
        "/api/subscriptions/process-lifecycle",
        { method: "POST", body: { limit: reviewLimit } },
      );
      setResult(next);
      setConfirm(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/subscriptions">
        <ArrowLeft size={16} />
        Back to subscriptions
      </Link>
      <PageHeading
        title="Process service changes"
        description="Apply scheduled changes that are due and close ended terms according to each plan. Previous invoices and unbilled periods are kept."
      />
      <form
        className="service-processing-form"
        noValidate
        aria-label="Process due service changes"
        onSubmit={prepare}
      >
        <Field
          name="limit"
          label="Agreement limit"
          value={limit}
          inputMode="numeric"
          error={fields.limit}
          help="1–500 agreements in a bounded pass."
          onChange={(event) => setLimit(event.target.value)}
        />
        <Button type="submit">
          Review service processing
          <ArrowRight size={16} />
        </Button>
      </form>
      {result && (
        <section
          className="service-processing-result"
          aria-label="Service processing results"
        >
          <Feedback tone={result.failed ? "error" : "success"}>
            {result.processed} processed · {result.paused} paused ·{" "}
            {result.resumed} resumed · {result.closed} closed ·{" "}
            {result.termEnded} term ended · {result.failed} failed ·{" "}
            {result.remaining} remain.
          </Feedback>
          {result.items.length > 0 && (
            <ul className="outcome-list">
              {result.items.map((item, index) => (
                <li key={`${item.subscriptionId}-${index}`}>
                  <Link to={`/subscriptions/${item.subscriptionId}/service`}>
                    {item.number}
                  </Link>
                  <span
                    className={`status ${item.outcome === "failed" ? "danger" : "info"}`}
                  >
                    {item.outcome}
                  </span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          )}
          {result.remaining > 0 && (
            <p className="footnote">
              The bounded pass left more work. Review another pass to continue.
            </p>
          )}
        </section>
      )}
      <ConfirmationDialog
        open={confirm}
        title="Process due service changes?"
        description={`Check up to ${reviewLimit} agreements for changes due by the business date. Each plan’s end-date rules still apply; invoices and payments stay unchanged.`}
        confirmLabel="Process service changes"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void process()}
      />
    </>
  );
}
