import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Play,
  ReceiptText,
} from "lucide-react";
import type { Page, User } from "../shared/contracts";
import {
  billingRunInputSchema,
  type BillingQueue,
  type BillingRun,
  type BillingRunItem,
} from "../shared/billing-workbench";
import { formatMoney } from "../shared/money";
import { request, errorMessage } from "./api";
import { validateForm } from "./Auth";
import { whole, RecordSelect } from "./Catalog";
import { BillingNavigation } from "./BillingNavigation";
import {
  formatBusinessDate,
  formatDate,
  useListQuery,
  useResource,
} from "./Workspace";
import {
  Button,
  ConfirmationDialog,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PageHeading,
  Pagination,
  SearchField,
  SelectField,
} from "./ui";

const runPath = (id: string) => `/billing/runs/${id}`;
const runTone = (status: BillingRun["status"], failed = 0) =>
  status === "failed"
    ? "danger"
    : status === "completed"
      ? failed
        ? "warning"
        : "success"
      : "info";
const runLabel = (run: BillingRun) =>
  run.status === "completed" && run.failed
    ? "Completed with failures"
    : run.status[0].toUpperCase() + run.status.slice(1);
const outcomeLabels: Record<BillingRunItem["outcome"], string> = {
  processing: "Processing",
  created: "Created",
  alreadyExisting: "Already exists",
  nonbillable: "Non-billable",
  failed: "Failed",
};
function BillingRunCounts({ run }: { run: BillingRun }) {
  return (
    <dl className="run-counts">
      <div>
        <dt>Created</dt>
        <dd>{run.created}</dd>
      </div>
      <div>
        <dt>Already exists</dt>
        <dd>{run.alreadyExisting}</dd>
      </div>
      <div>
        <dt>Non-billable</dt>
        <dd>{run.nonbillable}</dd>
      </div>
      <div>
        <dt>Failed</dt>
        <dd>{run.failed}</dd>
      </div>
      <div>
        <dt>
          {run.status === "queued" || run.status === "running"
            ? "Due subscriptions at start"
            : "Due subscriptions after run"}
        </dt>
        <dd>{run.remainingDueSubscriptions}</dd>
      </div>
    </dl>
  );
}
function ListFailure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="list-error">
      <Feedback tone="error">{error}</Feedback>
      <Button tone="secondary" onClick={retry}>
        <RefreshCw size={16} />
        Retry
      </Button>
    </div>
  );
}
export function BillingWorkbench() {
  const query = useListQuery();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "exceptions" ? "exceptions" : "due";
  const customerId = params.get("customerId") || "";
  const queue = useResource<BillingQueue>(
    `/api/billing/queue?view=${view}&q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}`,
  );
  const navigate = useNavigate();
  const [limit, setLimit] = useState("250"),
    [scope, setScope] = useState("all"),
    [fields, setFields] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState<{
    limit: number;
    subscriptionIds?: string[];
  } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    document.title = "Due workbench · SubTrack";
  }, []);
  useEffect(() => {
    if (queue.data && queue.data.page !== query.page)
      query.setPage(queue.data.page);
  }, [queue.data, query.page]);
  function filter(name: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      next.delete("page");
      return next;
    });
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      limit: whole(limit, "limit"),
      ...(scope === "page"
        ? {
            subscriptionIds: [
              ...new Set(
                queue.data?.items.map((item) => item.subscriptionId) || [],
              ),
            ],
          }
        : {}),
      idempotencyKey: key,
    };
    const invalid = validateForm(
      billingRunInputSchema,
      payload,
      event.currentTarget,
    );
    setFields(invalid || {});
    if (invalid) return;
    setReview(payload);
    setError("");
    setConfirm(true);
  }
  async function start() {
    if (!review || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const run = await request<BillingRun>("/api/billing/runs", {
        method: "POST",
        body: { ...review, idempotencyKey: key },
      });
      navigate(runPath(run.id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Due workbench"
        description="Recover owed periods in original schedule order. Each subscription advances only after its period outcome is safely saved."
        action={
          <Button tone="secondary" disabled={queue.busy} onClick={queue.reload}>
            <RefreshCw size={17} />
            Refresh queue
          </Button>
        }
      />
      <BillingNavigation />
      {queue.data && (
        <div className="queue-context">
          <span>
            Business date · {formatBusinessDate(queue.data.businessDate)}
          </span>
          <span>{queue.data.summary.dueSubscriptions} due subscriptions</span>
          <span
            className={queue.data.summary.failedPeriods ? "overdue-label" : ""}
          >
            {queue.data.summary.failedPeriods} failed periods
          </span>
          <span>
            {queue.data.summary.canceledInvoices} canceled invoice exceptions
          </span>
        </div>
      )}
      {view === "due" && (
        <form
          className="billing-run-form"
          aria-label="Start billing run"
          noValidate
          onSubmit={prepare}
        >
          <div>
            <h2>A bounded run. Every outcome kept.</h2>
            <p>
              Generate Draft invoices for up to the selected number of periods.
              Confirmation remains a separate review.
            </p>
          </div>
          <Field
            name="limit"
            label="Period limit"
            inputMode="numeric"
            value={limit}
            error={fields.limit}
            help="1–500 periods per run."
            onChange={(event) => setLimit(event.target.value)}
          />
          <SelectField
            label="Run scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            help={
              scope === "all"
                ? "Includes all due subscriptions, regardless of queue filters."
                : "Uses only subscriptions shown on the current page."
            }
          >
            <option value="all">All due subscriptions</option>
            <option value="page">This page’s subscriptions</option>
          </SelectField>
          <Button
            type="submit"
            disabled={
              queue.busy ||
              !queue.data?.summary.dueSubscriptions ||
              (scope === "page" && !queue.data?.items.length)
            }
          >
            <Play size={16} />
            Review billing run
          </Button>
        </form>
      )}
      <section className="list-panel" aria-label="Billing queue">
        <div className="list-toolbar subscription-filters">
          <SearchField
            label="Search billing queue"
            placeholder="Search agreement or customer"
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <div className="filter-control queue-view-filter">
            <SelectField
              label="Queue view"
              value={view}
              onChange={(event) => filter("view", event.target.value)}
            >
              <option value="due">Due subscriptions</option>
              <option value="exceptions">Failed / canceled exceptions</option>
            </SelectField>
          </div>
          <div className="filter-control customer-filter">
            <RecordSelect<User>
              resource="customers"
              name="customerFilter"
              label="Customer"
              emptyLabel="All customers"
              value={customerId}
              onChange={(value) => filter("customerId", value)}
            />
          </div>
          <span className="list-count">
            {queue.data?.total || 0}{" "}
            {view === "due" ? "subscriptions" : "exceptions"}
          </span>
        </div>
        <div className="table-region" aria-busy={queue.busy}>
          {queue.error ? (
            <ListFailure error={queue.error} retry={queue.reload} />
          ) : queue.busy ? (
            <Loading>Loading the billing queue…</Loading>
          ) : !queue.data?.items.length ? (
            <EmptyState
              title={
                view === "due"
                  ? "No due subscriptions in this view."
                  : "No billing exceptions in this view."
              }
              icon={<ReceiptText size={26} />}
            >
              Try another search or customer filter. Saved runs retain their
              period-by-period outcomes.
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">
                {view === "due"
                  ? "Oldest unprocessed due period per subscription"
                  : "Persisted billing exceptions"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Agreement</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Period</th>
                  <th scope="col">State / reason</th>
                  <th scope="col" className="money-cell">
                    Active accepted base
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.data.items.map((item) => (
                  <tr
                    key={`${item.subscriptionId}-${item.periodStart}-${item.outcome}`}
                  >
                    <td data-label="Agreement">
                      <Link
                        className="record-link"
                        to={`/subscriptions/${item.subscriptionId}`}
                      >
                        {item.subscriptionNumber}
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                    <td data-label="Customer">{item.customerName}</td>
                    <td data-label="Period" className="subscription-dates">
                      {formatBusinessDate(item.periodStart)}
                      <span className="row-secondary">
                        to {formatBusinessDate(item.periodEnd)} · exclusive
                      </span>
                    </td>
                    <td data-label="State / reason">
                      <span
                        className={`status ${item.outcome === "failed" ? "danger" : item.outcome === "canceled" ? "warning" : "info"}`}
                      >
                        {item.outcome === "due"
                          ? item.billable
                            ? "Due"
                            : "Non-billable period"
                          : item.outcome === "failed"
                            ? "Failed · retryable"
                            : "Canceled"}
                      </span>
                      {item.reason && (
                        <span className="row-secondary">{item.reason}</span>
                      )}
                      {item.invoiceId && (
                        <Link
                          className="table-action"
                          to={`/billing/invoices/${item.invoiceId}`}
                        >
                          {item.invoiceNumber} <ArrowRight size={13} />
                        </Link>
                      )}
                    </td>
                    <td
                      data-label="Active accepted base"
                      className="money-cell"
                    >
                      {formatMoney(item.acceptedSubtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={query.page}
          pageSize={queue.data?.pageSize || 20}
          total={queue.data?.total || 0}
          busy={queue.busy}
          onPage={query.setPage}
        />
      </section>
      <p className="footnote">
        The due queue shows the oldest unprocessed period per subscription, not
        every owed period. Active accepted bases exclude generation-date
        discounts and tax; non-billable periods show zero and still need a saved
        outcome. A canceled invoice occupies its period until an explicit
        replacement; routine runs cannot rebill it.
      </p>
      <ConfirmationDialog
        open={confirm}
        title="Start this billing run?"
        description={`Process up to ${review?.limit || 0} periods, oldest owed first. Each created invoice is a Draft, not collectible until confirmed.`}
        confirmLabel="Start billing run"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void start()}
      >
        <dl className="confirmation-summary">
          <div>
            <dt>Scope</dt>
            <dd>
              {review?.subscriptionIds
                ? `${review.subscriptionIds.length} subscriptions from this page`
                : "All due subscriptions"}
            </dd>
          </div>
        </dl>
        {error && (
          <p className="footnote">
            <Link to="/billing/runs">Check saved runs</Link> before retrying an
            unclear result. Retrying this unchanged review returns the same
            run.
          </p>
        )}
      </ConfirmationDialog>
    </>
  );
}

export function BillingRunList() {
  const query = useListQuery();
  const runs = useResource<Page<BillingRun>>(
    `/api/billing/runs?q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20`,
  );
  useEffect(() => {
    document.title = "Billing runs · SubTrack";
  }, []);
  useEffect(() => {
    if (runs.data && runs.data.page !== query.page)
      query.setPage(runs.data.page);
  }, [runs.data, query.page]);
  return (
    <>
      <PageHeading
        title="Billing runs"
        description="Saved batches and retries, with each period outcome retained."
        action={
          <Link className="button" to="/billing/workbench">
            Open due workbench
            <ArrowRight size={17} />
          </Link>
        }
      />
      <BillingNavigation />
      <section className="list-panel" aria-label="Billing runs">
        <div className="list-toolbar subscription-filters">
          <SearchField
            label="Search billing runs"
            placeholder="Find a run number"
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <span className="list-count">{runs.data?.total || 0} runs</span>
          <Button tone="secondary" onClick={runs.reload} disabled={runs.busy}>
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
        <div className="table-region" aria-busy={runs.busy}>
          {runs.error ? (
            <ListFailure error={runs.error} retry={runs.reload} />
          ) : runs.busy ? (
            <Loading>Loading saved runs…</Loading>
          ) : !runs.data?.items.length ? (
            <EmptyState
              title={
                query.query
                  ? "No billing runs match this search."
                  : "No billing runs yet."
              }
              icon={<ReceiptText size={26} />}
            >
              {query.query
                ? "Try another run number or clear the search."
                : "Start a bounded run from the due workbench."}
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">Billing runs</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Status</th>
                  <th scope="col">Period outcomes</th>
                  <th scope="col">Started by</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.items.map((run) => (
                  <tr key={run.id}>
                    <td data-label="Run">
                      <Link className="record-link" to={runPath(run.id)}>
                        {run.number}
                        <ArrowRight size={14} />
                      </Link>
                      <span className="row-secondary">
                        Limit {run.limit} periods
                      </span>
                    </td>
                    <td data-label="Status">
                      <span
                        className={`status ${runTone(run.status, run.failed)}`}
                      >
                        {runLabel(run)}
                      </span>
                    </td>
                    <td data-label="Period outcomes">
                      {run.processed} processed
                      <span className="row-secondary">
                        {run.created} created · {run.failed} failed
                      </span>
                    </td>
                    <td data-label="Started by">{run.actorName}</td>
                    <td data-label="Created" className="date-cell">
                      {formatDate(run.createdAt, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={query.page}
          pageSize={runs.data?.pageSize || 20}
          total={runs.data?.total || 0}
          busy={runs.busy}
          onPage={query.setPage}
        />
      </section>
    </>
  );
}

export function BillingRunDetail() {
  const { id } = useParams();
  return <BillingRunRecord key={id} id={id!} />;
}
function BillingRunRecord({ id }: { id: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const outcome = params.get("outcome") || "";
  const parsed = Number(params.get("page") || "1"),
    page = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  const header = useResource<BillingRun>(`/api/billing/runs/${id}`);
  const items = useResource<Page<BillingRunItem>>(
    `/api/billing/runs/${id}/items?page=${page}&pageSize=20${outcome ? `&outcome=${encodeURIComponent(outcome)}` : ""}`,
  );
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const pending = useRef(false);
  const run = header.data;
  const active = run?.status === "queued" || run?.status === "running";
  useEffect(() => {
    document.title = `${run?.number || "Billing run"} · SubTrack`;
  }, [run?.number]);
  useEffect(() => {
    if (!active || header.error) return;
    const timer = window.setTimeout(() => {
      header.reload();
      items.reload();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [run, active, header.error]);
  useEffect(() => {
    if (run && !active) items.reload();
  }, [run?.status]);
  useEffect(() => {
    if (items.data && items.data.page !== page) pageTo(items.data.page);
  }, [items.data, page]);
  function pageTo(value: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value > 1) next.set("page", String(value));
      else next.delete("page");
      return next;
    });
  }
  async function retry() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await request<BillingRun>(`/api/billing/runs/${id}/retry`, {
        method: "POST",
        body: { idempotencyKey: key },
      });
      setConfirm(false);
      navigate(runPath(next.id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!run && header.busy)
    return <Loading>Loading the saved billing run…</Loading>;
  if (!run)
    return (
      <>
        <PageHeading title="This billing run couldn’t load." />
        <ListFailure
          error={header.error || "The run is unavailable."}
          retry={header.reload}
        />
        <Link to="/billing/runs">Back to runs</Link>
      </>
    );
  return (
    <>
      <Link className="back-link" to="/billing/runs">
        <ArrowLeft size={16} />
        Back to billing runs
      </Link>
      <PageHeading
        title={run.number}
        autoFocus
        description={`Started by ${run.actorName} · ${formatDate(run.createdAt, true)}`}
        action={
          <div className="heading-actions">
            <Button
              tone="secondary"
              onClick={() => {
                header.reload();
                items.reload();
              }}
              disabled={header.busy}
            >
              <RefreshCw size={16} />
              Refresh results
            </Button>
            {!active && run.failed > 0 && (
              <Button
                onClick={() => {
                  setError("");
                  setConfirm(true);
                }}
              >
                Retry failed periods
              </Button>
            )}
          </div>
        }
      />
      {header.error && (
        <Feedback tone="error">
          {header.error} Saved results remain visible. Refresh to check the
          current state.
        </Feedback>
      )}
      <section className="run-summary" aria-label="Run results">
        <div className="run-summary-heading">
          <span className={`status ${runTone(run.status, run.failed)}`}>
            {runLabel(run)}
          </span>
          <strong>
            {run.processed} periods processed · limit {run.limit}
          </strong>
          {run.retryOf && (
            <Link to={runPath(run.retryOf)}>
              Original run
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
        {active && (
          <div className="run-progress">
            <progress
              max={run.limit}
              value={run.processed}
              aria-label="Processed period limit"
              aria-valuetext={`${run.processed} periods processed, limit ${run.limit}`}
            />
            <p>
              Processing saved work. These counts update as periods are handled.
              You can reopen this page while the run continues.
            </p>
          </div>
        )}
        <BillingRunCounts run={run} />
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {run.status}. {run.processed} periods processed. {run.created}{" "}
          created, {run.alreadyExisting} already existing, {run.nonbillable}{" "}
          non-billable, {run.failed} failed. {run.remainingDueSubscriptions} due
          subscriptions recorded for this run.
        </p>
        {run.error && <Feedback tone="error">{run.error}</Feedback>}
        {!active && run.failed > 0 && (
          <Feedback tone="error">
            {run.failed} period{run.failed === 1 ? "" : "s"} failed in this run.
            Successful outcomes were saved separately. Review recorded reasons
            and any subsequent retry before resubmitting.
          </Feedback>
        )}
        {!active && run.remainingDueSubscriptions > 0 && (
          <p className="run-next">
            At the end of this run, {run.remainingDueSubscriptions}{" "}
            subscriptions still had due work. This is a subscription count, not
            a count of remaining periods.{" "}
            <Link to="/billing/workbench">
              Continue from the queue <ArrowRight size={14} />
            </Link>
          </p>
        )}
      </section>
      <section className="list-panel" aria-label="Period outcomes">
        <div className="list-toolbar">
          <div className="filter-control">
            <SelectField
              label="Outcome"
              value={outcome}
              onChange={(event) =>
                setParams(
                  event.target.value ? { outcome: event.target.value } : {},
                )
              }
            >
              <option value="">All outcomes</option>
              <option value="created">Created</option>
              <option value="alreadyExisting">Already exists</option>
              <option value="nonbillable">Non-billable</option>
              <option value="failed">Failed / retryable</option>
            </SelectField>
          </div>
          <span className="list-count">{items.data?.total || 0} outcomes</span>
        </div>
        <div className="table-region" aria-busy={items.busy}>
          {items.error ? (
            <ListFailure error={items.error} retry={items.reload} />
          ) : items.busy && !items.data ? (
            <Loading>Loading period outcomes…</Loading>
          ) : !items.data?.items.length ? (
            <EmptyState
              title={
                active
                  ? "Waiting for the first saved outcome."
                  : "No outcomes in this view."
              }
            >
              Each period appears here once its result has been saved.
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">Saved period outcomes</caption>
              <thead>
                <tr>
                  <th scope="col">Agreement / customer</th>
                  <th scope="col">Period</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Invoice / reason</th>
                </tr>
              </thead>
              <tbody>
                {items.data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Agreement / customer">
                      <Link
                        className="record-link"
                        to={`/subscriptions/${item.subscriptionId}`}
                      >
                        {item.subscriptionNumber}
                        <ArrowRight size={14} />
                      </Link>
                      <span className="row-secondary">{item.customerName}</span>
                    </td>
                    <td data-label="Period" className="subscription-dates">
                      {formatBusinessDate(item.periodStart)}
                      <span className="row-secondary">
                        to {formatBusinessDate(item.periodEnd)} · exclusive
                      </span>
                    </td>
                    <td data-label="Outcome">
                      <span
                        className={`status ${item.outcome === "failed" ? "danger" : item.outcome === "created" ? "success" : "info"}`}
                      >
                        {outcomeLabels[item.outcome]}
                        {item.outcome === "failed" && item.retryable
                          ? " · retryable"
                          : ""}
                      </span>
                    </td>
                    <td data-label="Invoice / reason">
                      {item.invoiceId && (
                        <Link
                          className="record-link"
                          to={`/billing/invoices/${item.invoiceId}`}
                        >
                          {item.invoiceNumber}
                          <ArrowRight size={14} />
                        </Link>
                      )}
                      <span className="row-secondary outcome-reason">
                        {item.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={page}
          pageSize={items.data?.pageSize || 20}
          total={items.data?.total || 0}
          busy={items.busy}
          onPage={pageTo}
        />
      </section>
      <ConfirmationDialog
        open={confirm}
        title="Retry these failed periods?"
        description="Create a separate saved run for the failed periods in this run. Successful and explicitly non-billable outcomes will not be resubmitted."
        confirmLabel="Retry failed periods"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void retry()}
      >
        {error && (
          <p className="footnote">
            Check <Link to="/billing/runs">saved runs</Link> before retrying an
            unclear result. Retrying this unchanged review returns the same
            run.
          </p>
        )}
      </ConfirmationDialog>
    </>
  );
}
