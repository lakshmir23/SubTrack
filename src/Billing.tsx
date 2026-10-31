import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Percent,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
  Printer,
} from "lucide-react";
import { BillingNavigation } from "./BillingNavigation";
import { InvoiceDeliveryPanel } from "./InvoiceOutput";
import type { Page, User } from "../shared/contracts";
import type { Product } from "../shared/catalog";
import {
  discountInputSchema,
  invoiceStatuses,
  type DiscountRule,
  type Invoice,
  type InvoicePreview,
  type InvoiceStatus,
  type InvoiceSummary,
} from "../shared/billing";
import type {
  Subscription,
  SubscriptionSummary,
} from "../shared/subscriptions";
import type { InvoiceReplacementPreview } from "../shared/billing-workbench";
import { amountInput, formatMoney, parseAmount } from "../shared/money";
import { errorMessage, request } from "./api";
import {
  AmountBreakdown,
  RecordSelect,
  useConfigurationEditor,
  whole,
  type AmountBreakdownData,
} from "./Catalog";
import { useSession } from "./session";
import {
  formatBusinessDate,
  formatDate,
  useListQuery,
  useResource,
} from "./Workspace";
import {
  Button,
  CheckboxField,
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

const invoicePath = (id: string) => `/billing/invoices/${id}`;
function decimal(value: string) {
  try {
    return parseAmount(value);
  } catch {
    return Number.NaN;
  }
}
function optionalDecimal(value: string) {
  return value.trim() ? decimal(value) : null;
}
function optionalWhole(value: string, name: string) {
  return value.trim() ? whole(value, name) : null;
}
function invoiceTone(status: InvoiceStatus) {
  return status === "Paid"
    ? "success"
    : status === "Canceled"
      ? "danger"
      : "info";
}
function invoiceAmounts(
  invoice: InvoicePreview | Invoice,
): AmountBreakdownData {
  return {
    lines: invoice.lines.map((line) => ({
      ...line,
      taxId: line.taxRuleId,
      taxName: line.taxRuleName,
      discountAmount: line.discount,
    })),
    subtotal: invoice.subtotal,
    discountAmount: invoice.discount,
    discountName: invoice.discountSnapshot?.name || "Discount",
    tax: invoice.tax,
    total: invoice.total,
    priceExplanation:
      "Accepted unit prices are preserved. The selected discount is allocated before exclusive tax, with each line’s tax rounded separately.",
  };
}
function InvoiceBreakdown({ invoice }: { invoice: InvoicePreview | Invoice }) {
  return (
    <AmountBreakdown
      value={invoiceAmounts(invoice)}
      totalLabel="Invoice total"
      baseLabel="Accepted base per unit"
      note="Read-only invoice amounts. Later catalog, tax or discount edits do not rewrite a generated invoice."
    />
  );
}
function DiscountReasons({ invoice }: { invoice: InvoicePreview | Invoice }) {
  const { user } = useSession();
  return (
    <section
      className="invoice-discount"
      aria-labelledby="discount-reason-title"
    >
      <h3 id="discount-reason-title">Discount decision</h3>
      <p>{invoice.discountReason}</p>
      {invoice.discountSnapshot && (
        <div className="discount-applied">
          <strong>{invoice.discountSnapshot.name}</strong>
          <span>−{formatMoney(invoice.discountSnapshot.amount)}</span>
          <small>{invoice.discountSnapshot.explanation}</small>
        </div>
      )}
      {user?.role !== "customer" &&
        invoice.discountDecisions &&
        invoice.discountDecisions.length > 0 && (
          <details className="discount-decisions">
            <summary>Review rule eligibility</summary>
            <ul>
              {invoice.discountDecisions.map((decision) => (
                <li key={decision.ruleId}>
                  <Link to={`/configuration/discounts/${decision.ruleId}`}>
                    {decision.ruleName}
                  </Link>
                  <span
                    className={`status ${decision.eligible ? "success" : "info"}`}
                  >
                    {decision.eligible ? "Eligible" : "Not applied"}
                  </span>
                  <p>{decision.reason}</p>
                </li>
              ))}
            </ul>
            {invoice.discountDecisionsTruncated && (
              <p className="footnote">
                This view shows {invoice.discountDecisions.length} rule
                decisions. Additional rule decisions are not listed.
              </p>
            )}
          </details>
        )}
    </section>
  );
}
function InvoiceProgress({ status }: { status: InvoiceStatus }) {
  const stages = ["Draft", "Confirmed", "Paid"] as const;
  const current = stages.indexOf(status as (typeof stages)[number]);
  return (
    <ol className="stage-strip invoice-stage-strip" aria-label="Invoice stages">
      {stages.map((stage, index) => (
        <li
          key={stage}
          className={
            index === current ? "current" : index < current ? "complete" : ""
          }
          aria-current={index === current ? "step" : undefined}
        >
          <span className="stage-marker" aria-hidden="true">
            {index < current ? <Check size={14} /> : <span />}
          </span>
          <span>{stage}</span>
        </li>
      ))}
    </ol>
  );
}

export function InvoiceList() {
  const { user } = useSession();
  const customer = user?.role === "customer";
  const query = useListQuery();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const status = params.get("status") || "";
  const customerId = customer ? "" : params.get("customerId") || "";
  const subscriptionId = params.get("subscriptionId") || "";
  const overdue = params.get("overdue") === "true";
  const resource = useResource<Page<InvoiceSummary>>(
    `/api/invoices?q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ""}${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}${subscriptionId ? `&subscriptionId=${encodeURIComponent(subscriptionId)}` : ""}${overdue ? "&overdue=true" : ""}`,
  );
  useEffect(() => {
    document.title = `${customer ? "Your invoices" : "Billing"} · SubTrack`;
  }, [customer]);
  useEffect(() => {
    if (resource.data && resource.data.page !== query.page)
      query.setPage(resource.data.page);
  }, [resource.data, query.page]);
  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      return next;
    });
  }
  const back = location.pathname + location.search;
  return (
    <>
      <PageHeading
        title={customer ? "Your invoices" : "Billing"}
        description={
          customer
            ? "Invoices and settlement status for your own Brightloop agreements."
            : "Review generated invoices and confirm their frozen amounts. Drafts are not collectible."
        }
        action={
          <Button
            tone="secondary"
            onClick={resource.reload}
            disabled={resource.busy}
          >
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <BillingNavigation />
      <section className="list-panel" aria-label="Invoice records">
        <div className="list-toolbar subscription-filters">
          <SearchField
            label="Search invoices"
            placeholder="Search invoice, customer or agreement"
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <div className="filter-control">
            <SelectField
              label="Invoice status"
              value={status}
              onChange={(event) => filter("status", event.target.value)}
            >
              <option value="">All statuses</option>
              {invoiceStatuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
          </div>
          {!customer && (
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
          )}
          <CheckboxField
            label="Overdue only"
            checked={overdue}
            onChange={(event) =>
              filter("overdue", event.target.checked ? "true" : "")
            }
          />
        </div>
        {subscriptionId && (
          <div className="list-filter-note">
            <span>Filtered to one subscription.</span>
            <button
              className="text-button"
              onClick={() => filter("subscriptionId", "")}
            >
              Show all subscriptions
            </button>
          </div>
        )}
        <div className="table-region" aria-busy={resource.busy}>
          {resource.error ? (
            <div className="list-error">
              <Feedback tone="error">{resource.error}</Feedback>
              <Button tone="secondary" onClick={resource.reload}>
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : resource.busy ? (
            <Loading>Loading invoices…</Loading>
          ) : !resource.data?.items.length ? (
            <EmptyState
              icon={<FileText size={27} />}
              title={
                query.query || status || customerId || subscriptionId || overdue
                  ? "No matching invoices."
                  : "No invoices yet."
              }
              action={
                query.query ||
                status ||
                customerId ||
                subscriptionId ||
                overdue ? (
                  <Button tone="secondary" onClick={() => setParams({})}>
                    Clear filters
                  </Button>
                ) : !customer ? (
                  <Link className="button secondary" to="/subscriptions">
                    View subscriptions
                    <ArrowRight size={17} />
                  </Link>
                ) : undefined
              }
            >
              {query.query || status || customerId || subscriptionId || overdue
                ? "Try another search or clear the active filters."
                : customer
                  ? "Generated invoices linked to your agreements will appear here."
                  : "Open an accepted subscription to review and generate its next due period."}
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">
                {customer ? "Your" : "Authorized"} invoices, page {query.page}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  {!customer && <th scope="col">Customer</th>}
                  <th scope="col">Service period</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="money-cell">
                    Invoice total
                  </th>
                  <th scope="col" className="money-cell">
                    Collectible balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((invoice) => (
                  <tr key={invoice.id}>
                    <td data-label="Invoice">
                      <Link
                        className="record-link"
                        to={invoicePath(invoice.id)}
                        state={{ returnTo: back }}
                      >
                        {invoice.number}
                        <ChevronRight size={14} />
                      </Link>
                      <small className="row-secondary">
                        {invoice.subscriptionNumber}
                      </small>
                    </td>
                    {!customer && (
                      <td data-label="Customer">
                        <strong>{invoice.customerName}</strong>
                        <small className="row-secondary">
                          {invoice.customerEmail}
                        </small>
                      </td>
                    )}
                    <td
                      data-label="Service period"
                      className="subscription-dates"
                    >
                      {formatBusinessDate(invoice.periodStart)}
                      <small className="row-secondary">
                        to {formatBusinessDate(invoice.periodEnd)} (exclusive)
                      </small>
                    </td>
                    <td data-label="Status">
                      <span className={`status ${invoiceTone(invoice.status)}`}>
                        {invoice.status}
                      </span>
                      {invoice.overdue && (
                        <small className="row-secondary overdue-label">
                          Overdue
                        </small>
                      )}
                    </td>
                    <td data-label="Invoice total" className="money-cell">
                      {formatMoney(invoice.total)}
                    </td>
                    <td data-label="Collectible balance" className="money-cell">
                      {invoice.status === "Draft" ? (
                        <span className="muted">Awaiting confirmation</span>
                      ) : invoice.status === "Canceled" ? (
                        <span className="muted">Not collectible</span>
                      ) : (
                        <span className="money-cell">
                          {formatMoney(invoice.outstanding)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={query.page}
          pageSize={resource.data?.pageSize || 20}
          total={resource.data?.total || 0}
          onPage={query.setPage}
          busy={resource.busy}
        />
      </section>
      <p className="footnote">
        Draft invoices await confirmation. Canceled invoices remain historical
        records and are not collectible.
      </p>
    </>
  );
}

export function SubscriptionInvoicePanel({
  subscription,
}: {
  subscription: Subscription;
}) {
  const { user } = useSession();
  const resource = useResource<Page<InvoiceSummary>>(
    `/api/invoices?subscriptionId=${subscription.id}&pageSize=5`,
  );
  const due =
    !!subscription.acceptedTerms &&
    !!subscription.nextBillingDate &&
    subscription.nextBillingDate <= subscription.businessDate;
  return (
    <section
      className="panel related-invoices"
      aria-labelledby="related-invoices-title"
    >
      <div className="section-heading">
        <h2 id="related-invoices-title">Invoices</h2>
        {user?.role !== "customer" && due && (
          <Link
            className="button secondary"
            to={`/billing/subscriptions/${subscription.id}/generate?periodStart=${subscription.nextBillingDate}`}
          >
            <Plus size={16} />
            Generate next invoice
          </Link>
        )}
      </div>
      {resource.error ? (
        <Feedback tone="error">
          {resource.error}{" "}
          <button className="text-button" onClick={resource.reload}>
            Retry
          </button>
        </Feedback>
      ) : resource.busy ? (
        <Loading>Loading this agreement’s invoices…</Loading>
      ) : !resource.data?.items.length ? (
        <p className="muted">
          No invoices have been generated for this agreement.
        </p>
      ) : (
        <ul className="related-records">
          {resource.data.items.map((invoice) => (
            <li key={invoice.id}>
              <Link to={invoicePath(invoice.id)}>
                {invoice.number}
                <ChevronRight size={13} />
              </Link>
              <span className={`status ${invoiceTone(invoice.status)}`}>
                {invoice.status}
              </span>
              <strong>{formatMoney(invoice.total)}</strong>
            </li>
          ))}
        </ul>
      )}
      {subscription.acceptedTerms && subscription.nextBillingDate && !due && (
        <p className="footnote">
          Next scheduled period:{" "}
          {formatBusinessDate(subscription.nextBillingDate)}. Generation is
          available when the period is due.
        </p>
      )}
      {(resource.data?.total || 0) > 5 && (
        <Link
          className="directory-link"
          to={`/billing/invoices?subscriptionId=${subscription.id}`}
        >
          View all {resource.data?.total} invoices
          <ArrowRight size={16} />
        </Link>
      )}
    </section>
  );
}

export function InvoiceGenerator() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const subscription = useResource<Subscription>(`/api/subscriptions/${id}`);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const period =
    params.get("periodStart") || subscription.data?.nextBillingDate || "";
  const [preview, setPreview] = useState<InvoicePreview | null>(null),
    [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false),
    [previewRevision, setPreviewRevision] = useState(0);
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    document.title = "Generate invoice · SubTrack";
  }, []);
  useEffect(() => {
    if (!period) return;
    const controller = new AbortController();
    setPreviewBusy(true);
    setPreview(null);
    setPreviewError("");
    request<InvoicePreview>(`/api/subscriptions/${id}/invoices/preview`, {
      method: "POST",
      body: { expectedPeriodStart: period },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setPreviewError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewBusy(false);
      });
    return () => controller.abort();
  }, [id, period, previewRevision]);
  async function generate() {
    if (!preview || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const invoice = await request<Invoice>(
        `/api/subscriptions/${id}/invoices`,
        {
          method: "POST",
          body: { expectedPeriodStart: preview.periodStart, idempotencyKey },
        },
      );
      navigate(invoicePath(invoice.id), {
        replace: true,
        state: {
          message: `Invoice ${invoice.number} is ready for review. Its amounts are saved as a read-only snapshot.`,
        },
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (subscription.busy) return <Loading>Loading the agreement…</Loading>;
  return (
    <>
      <Link className="back-link" to={`/subscriptions/${id}`}>
        <ArrowLeft size={16} />
        Back to agreement
      </Link>
      <PageHeading
        title="Generate next invoice"
        autoFocus
        description="Review the due service period and automatic adjustments before creating a draft."
      />
      {subscription.error && (
        <Feedback tone="error">{subscription.error}</Feedback>
      )}
      {!period && !subscription.error && (
        <Feedback>
          This agreement has no next billing period available.{" "}
          <Link to={`/subscriptions/${id}`}>
            Review its service dates and stage.
          </Link>
        </Feedback>
      )}
      {previewError && (
        <Feedback tone="error">
          {previewError}{" "}
          <button
            className="text-button"
            onClick={() => setPreviewRevision((value) => value + 1)}
          >
            Refresh preview
          </button>
        </Feedback>
      )}
      {previewBusy ? (
        <Loading>Calculating the due invoice…</Loading>
      ) : (
        preview && (
          <>
            {preview.existingInvoiceId && (
              <Feedback>
                This period already has invoice {preview.existingInvoiceNumber}.{" "}
                <Link to={invoicePath(preview.existingInvoiceId)}>
                  Open the existing invoice.
                </Link>
              </Feedback>
            )}
            <div className="agreement-layout">
              <section className="panel invoice-period">
                <h2>Due period review</h2>
                <dl className="catalog-detail-grid">
                  <div>
                    <dt>Subscription</dt>
                    <dd>{preview.subscriptionNumber}</dd>
                  </div>
                  <div>
                    <dt>Customer</dt>
                    <dd>
                      {preview.customerName}
                      <small>{preview.customerEmail}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Period starts</dt>
                    <dd>{formatBusinessDate(preview.periodStart)}</dd>
                  </div>
                  <div>
                    <dt>Period ends (exclusive)</dt>
                    <dd>{formatBusinessDate(preview.periodEnd)}</dd>
                  </div>
                  <div>
                    <dt>Invoice issue date</dt>
                    <dd>{formatBusinessDate(preview.issueDate)}</dd>
                  </div>
                  <div>
                    <dt>Due date</dt>
                    <dd>{formatBusinessDate(preview.dueDate)}</dd>
                  </div>
                </dl>
                <DiscountReasons invoice={preview} />
                {!preview.existingInvoiceId && (
                  <>
                    <Button
                      onClick={() => {
                        setError("");
                        setConfirm(true);
                      }}
                    >
                      <Plus size={17} />
                      Generate draft invoice
                    </Button>
                    <p className="footnote">
                      The preview reserves no discount uses. Generation rechecks
                      eligibility and creates an invoice for review; the draft
                      is not collectible.
                    </p>
                  </>
                )}
              </section>
              <section className="panel calculation-panel">
                <h2>Invoice preview</h2>
                <InvoiceBreakdown invoice={preview} />
              </section>
            </div>
            <ConfirmationDialog
              open={confirm}
              title="Generate this draft invoice?"
              description={`Create one read-only invoice for ${preview.subscriptionNumber}, period ${formatBusinessDate(preview.periodStart)} through the exclusive end ${formatBusinessDate(preview.periodEnd)}. Eligibility is checked again when it is generated.`}
              confirmLabel="Generate draft invoice"
              busy={busy}
              error={error}
              onCancel={() => setConfirm(false)}
              onConfirm={() => void generate()}
            >
              <dl className="confirmation-summary">
                <div>
                  <dt>Previewed invoice total</dt>
                  <dd>{formatMoney(preview.total)}</dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{preview.customerName}</dd>
                </div>
              </dl>
              {error && (
                <p className="footnote">
                  <Link to={`/billing/invoices?subscriptionId=${id}`}>
                    Check the agreement’s saved invoices
                  </Link>{" "}
                  before retrying an uncertain response.
                </p>
              )}
            </ConfirmationDialog>
          </>
        )
      )}
    </>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const location = useLocation();
  const resource = useResource<Invoice>(`/api/invoices/${id}`);
  const [action, setAction] = useState<"confirm" | "cancel" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    document.title = `${resource.data?.number || "Invoice"} · SubTrack`;
  }, [resource.data?.number]);
  async function mutate() {
    if (!resource.data || !action || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const invoice = await request<Invoice>(`/api/invoices/${id}/${action}`, {
        method: "POST",
        body: { version: resource.data.version },
      });
      setMessage(`${invoice.number} is now ${invoice.status}.`);
      setAction(null);
      resource.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (resource.busy) return <Loading>Loading the invoice…</Loading>;
  const invoice = resource.data;
  if (resource.error || !invoice)
    return (
      <>
        <PageHeading title="This invoice couldn’t load." />
        <Feedback tone="error">
          {resource.error || "The invoice is unavailable."}
        </Feedback>
        <Link className="button secondary" to="/billing/invoices">
          Back to invoices
        </Link>
        <Button tone="secondary" onClick={resource.reload}>
          <RefreshCw />
          Retry
        </Button>
      </>
    );
  const internal = user?.role !== "customer";
  const zeroPaid = invoice.status === "Paid" && invoice.total === 0;
  const reservation =
    invoice.discountApplicationState === "reserved"
      ? "Reserved for this draft"
      : invoice.discountApplicationState === "released"
        ? "Released when the draft was canceled"
        : invoice.discountApplicationState === "consumed"
          ? "Consumed at confirmation"
          : "No usage reservation recorded";
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const savedMessage = (location.state as { message?: string } | null)?.message;
  return (
    <>
      <Link
        className="back-link"
        to={
          returnTo?.startsWith("/billing/invoices")
            ? returnTo
            : "/billing/invoices"
        }
      >
        <ArrowLeft size={16} />
        Back to invoices
      </Link>
      <PageHeading
        title={invoice.number}
        autoFocus
        description={`${invoice.customerName} · ${invoice.subscriptionNumber}`}
        action={
          <div className="heading-actions">
            <a
              className="button secondary"
              href={`/api/invoices/${invoice.id}/print`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer size={17} />
              Open print view<span className="sr-only"> (new tab)</span>
            </a>
            <Button
              tone="secondary"
              onClick={resource.reload}
              aria-label="Refresh invoice"
            >
              <RefreshCw size={17} />
            </Button>
            {internal && invoice.allowedActions.includes("confirm") && (
              <Button
                onClick={() => {
                  setError("");
                  setAction("confirm");
                }}
              >
                <ShieldCheck size={17} />
                Confirm invoice
              </Button>
            )}
          </div>
        }
      />
      {(message || savedMessage) && (
        <Feedback tone="success">{message || savedMessage}</Feedback>
      )}
      {invoice.status !== "Canceled" && (
        <InvoiceProgress status={invoice.status} />
      )}
      <div className="agreement-context">
        <span className={`status ${invoiceTone(invoice.status)}`}>
          {invoice.status}
        </span>
        <strong>
          {invoice.status === "Draft"
            ? "Awaiting confirmation · not collectible"
            : invoice.status === "Canceled"
              ? "Canceled · historical amount, not collectible"
              : zeroPaid
                ? "Zero amount due"
                : invoice.status === "Paid"
                  ? "Settled"
                  : invoice.overdue
                    ? "Outstanding · overdue"
                    : "Confirmed · collectible"}
        </strong>
      </div>
      {invoice.currentInvoiceId !== invoice.id && (
        <Feedback>
          This is an earlier revision.{" "}
          <Link to={invoicePath(invoice.currentInvoiceId)}>
            Open current invoice {invoice.currentInvoiceNumber}
          </Link>
          .
        </Feedback>
      )}
      {invoice.predecessorId && (
        <p className="footnote">
          Revision {invoice.revisionNumber} · Replaces{" "}
          <Link to={invoicePath(invoice.predecessorId)}>
            the preceding canceled invoice
          </Link>
          . One logical charge is retained for this period.
        </p>
      )}
      {internal && invoice.allowedActions.includes("replace") && (
        <div className="replacement-notice">
          <strong>This canceled period remains occupied.</strong>
          <p>
            Routine billing will not regenerate it. Review a linked replacement
            using current tax and discount eligibility.
          </p>
          <Link
            className="button secondary"
            to={`${invoicePath(invoice.id)}/replace`}
          >
            Review replacement
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {zeroPaid && (
        <Feedback tone="success">
          Zero amount due. This invoice settled when it was confirmed; no
          payment was required or recorded.
        </Feedback>
      )}
      <div className="agreement-layout">
        <section className="panel invoice-period">
          <h2>Invoice details</h2>
          <dl className="catalog-detail-grid">
            <div>
              <dt>Subscription</dt>
              <dd>
                <Link to={`/subscriptions/${invoice.subscriptionId}`}>
                  {invoice.subscriptionNumber}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>
                {invoice.customerName}
                <small>{invoice.customerEmail}</small>
              </dd>
            </div>
            <div>
              <dt>Period starts</dt>
              <dd>{formatBusinessDate(invoice.periodStart)}</dd>
            </div>
            <div>
              <dt>Period ends (exclusive)</dt>
              <dd>{formatBusinessDate(invoice.periodEnd)}</dd>
            </div>
            <div>
              <dt>Issue date</dt>
              <dd>{formatBusinessDate(invoice.issueDate)}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{formatBusinessDate(invoice.dueDate)}</dd>
            </div>
            {(invoice.status === "Confirmed" || invoice.status === "Paid") && (
              <>
                <div>
                  <dt>Recorded payments</dt>
                  <dd>
                    {formatMoney(invoice.amountPaid)}
                    <small>
                      {invoice.paymentCount}{" "}
                      {invoice.paymentCount === 1
                        ? "payment record"
                        : "payment records"}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Outstanding balance</dt>
                  <dd>{formatMoney(invoice.outstanding)}</dd>
                </div>
              </>
            )}
          </dl>
          <DiscountReasons invoice={invoice} />
          {internal && invoice.discountSnapshot && (
            <div className="reservation-state">
              <strong>Discount application</strong>
              <p>{reservation}.</p>
              <Link
                to={`/configuration/discounts/${invoice.discountSnapshot.id}`}
              >
                View rule usage
                <ArrowRight size={14} />
              </Link>
            </div>
          )}
          {internal && invoice.allowedActions.includes("cancel") && (
            <div className="invoice-correction">
              <h3>Correct an unused invoice</h3>
              <p>
                Cancel the invoice while preserving its financial history. An
                invoice with any recorded payment cannot be canceled.
              </p>
              <Button
                tone="ghost"
                intent="danger"
                onClick={() => {
                  setError("");
                  setAction("cancel");
                }}
              >
                <XCircle size={16} />
                Cancel invoice
              </Button>
            </div>
          )}
        </section>
        <section className="panel calculation-panel">
          <h2>Frozen invoice amounts</h2>
          <InvoiceBreakdown invoice={invoice} />
        </section>
        <section className="panel agreement-history">
          <h2>Activity</h2>
          <ol>
            {invoice.history.map((event) => (
              <li key={event.id}>
                <span className="history-dot" aria-hidden="true" />
                <div>
                  <strong>{event.message}</strong>
                  <p>
                    {event.actorName} · {formatDate(event.at, true)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {internal && <InvoiceDeliveryPanel key={invoice.id} invoice={invoice} />}
      <ConfirmationDialog
        open={!!action}
        title={
          action === "cancel" ? "Cancel this invoice?" : "Confirm this invoice?"
        }
        description={
          action === "cancel"
            ? invoice.status === "Draft"
              ? `Cancel ${invoice.number}. Its financial history remains, and its reserved discount use is released.`
              : `Cancel ${invoice.number}. Its financial history remains; any discount use consumed at confirmation is retained.`
            : invoice.total === 0
              ? `Confirm ${invoice.number} for zero amount due. It will become Paid without recording a payment.`
              : `Confirm ${invoice.number} at the saved amount. It becomes collectible; its recorded discount reservation is consumed exactly once.`
        }
        confirmLabel={
          action === "cancel" ? "Cancel invoice" : "Confirm invoice"
        }
        intent={action === "cancel" ? "danger" : "neutral"}
        busy={busy}
        error={error}
        onCancel={() => setAction(null)}
        onConfirm={() => void mutate()}
      >
        <dl className="confirmation-summary">
          <div>
            <dt>Invoice total</dt>
            <dd>{formatMoney(invoice.total)}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{invoice.customerName}</dd>
          </div>
        </dl>
        {error && (
          <p className="footnote">
            Cancel this review and refresh the saved invoice to check its
            current state before retrying.
          </p>
        )}
      </ConfirmationDialog>
    </>
  );
}

export function DiscountList() {
  const { user } = useSession();
  const query = useListQuery();
  const location = useLocation();
  const resource = useResource<Page<DiscountRule>>(
    `/api/discounts?q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20`,
  );
  useEffect(() => {
    document.title = "Discount rules · SubTrack";
  }, []);
  useEffect(() => {
    if (resource.data && resource.data.page !== query.page)
      query.setPage(resource.data.page);
  }, [resource.data, query.page]);
  const message = (location.state as { message?: string } | null)?.message;
  return (
    <>
      <div className="catalog-section-title">
        <div>
          <h2>Discount rules</h2>
          <p>
            One eligible rule per invoice, with bounded usage and clear scope.
          </p>
        </div>
        {user?.role === "admin" && (
          <Link
            className="button"
            to="/configuration/discounts/new"
            state={{ returnTo: location.pathname + location.search }}
          >
            <Plus size={16} />
            New discount rule
          </Link>
        )}
      </div>
      {message && <Feedback tone="success">{message}</Feedback>}
      <section className="list-panel" aria-label="Discount rules">
        <div className="list-toolbar">
          <SearchField
            label="Search discount rules"
            placeholder="Search discount names"
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <span className="list-count">{resource.data?.total || 0} rules</span>
        </div>
        <div className="table-region" aria-busy={resource.busy}>
          {resource.error ? (
            <div className="list-error">
              <Feedback tone="error">{resource.error}</Feedback>
              <Button tone="secondary" onClick={resource.reload}>
                Retry
              </Button>
            </div>
          ) : resource.busy ? (
            <Loading>Loading discount rules…</Loading>
          ) : !resource.data?.items.length ? (
            <EmptyState
              icon={<Percent size={26} />}
              title={
                query.query
                  ? "No matching discount rules."
                  : "No discount rules yet."
              }
              action={
                query.query ? (
                  <Button tone="secondary" onClick={() => query.setDraft("")}>
                    Clear search
                  </Button>
                ) : user?.role === "admin" ? (
                  <Link className="button" to="/configuration/discounts/new">
                    <Plus size={16} />
                    New discount rule
                  </Link>
                ) : undefined
              }
            >
              {query.query
                ? "Try another name or clear your search."
                : "Your administrator can configure automatic fixed or percentage reductions."}
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">
                Discount rules, page {query.page}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Reduction</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Reserved / consumed</th>
                  <th scope="col">Remaining uses</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((rule) => (
                  <tr key={rule.id}>
                    <td data-label="Rule">
                      <Link
                        className="record-link"
                        to={`/configuration/discounts/${rule.id}`}
                      >
                        {rule.name}
                        <ChevronRight size={14} />
                      </Link>
                      {rule.subscriptionNumber && (
                        <small className="row-secondary">
                          {rule.subscriptionNumber}
                        </small>
                      )}
                    </td>
                    <td data-label="Reduction">
                      {rule.kind === "fixed"
                        ? formatMoney(rule.amountMinor || 0)
                        : `${amountInput(rule.percentBps || 0)}%`}
                    </td>
                    <td data-label="Scope">
                      {rule.scope === "products"
                        ? `${rule.productIds.length} selected products`
                        : "Whole subscription"}
                    </td>
                    <td data-label="Reserved / consumed">
                      {rule.reserved} / {rule.consumed}
                    </td>
                    <td data-label="Remaining uses">
                      {rule.remaining === null ? "Unlimited" : rule.remaining}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`status ${rule.active ? "success" : "info"}`}
                      >
                        {rule.active ? "Enabled" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={query.page}
          pageSize={resource.data?.pageSize || 20}
          total={resource.data?.total || 0}
          onPage={query.setPage}
          busy={resource.busy}
        />
      </section>
    </>
  );
}

export function InvoiceReplacementRoute() {
  const { id } = useParams();
  return <InvoiceReplacement key={id} id={id!} />;
}
function InvoiceReplacement({ id }: { id: string }) {
  const source = useResource<Invoice>(`/api/invoices/${id}`);
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvoiceReplacementPreview | null>(
      null,
    ),
    [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const pending = useRef(false);
  useEffect(() => {
    document.title = "Review replacement · SubTrack";
  }, []);
  useEffect(() => {
    if (!source.data?.allowedActions.includes("replace")) return;
    const controller = new AbortController();
    setPreviewBusy(true);
    setPreview(null);
    setPreviewError("");
    request<InvoiceReplacementPreview>(
      `/api/invoices/${id}/replacement/preview`,
      {
        method: "POST",
        body: { version: source.data.version },
        signal: controller.signal,
      },
    )
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setPreviewError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewBusy(false);
      });
    return () => controller.abort();
  }, [source.data, id, revision]);
  async function replace() {
    if (!preview || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const invoice = await request<Invoice>(`/api/invoices/${id}/replace`, {
        method: "POST",
        body: {
          version: preview.predecessorVersion,
          previewHash: preview.previewHash,
          idempotencyKey: key,
        },
      });
      navigate(invoicePath(invoice.id), {
        replace: true,
        state: {
          message: `${invoice.number} is a linked replacement Draft. Review its frozen amounts before confirmation.`,
        },
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (source.busy) return <Loading>Loading the canceled invoice…</Loading>;
  if (!source.data || source.error)
    return (
      <>
        <PageHeading title="Replacement couldn’t load." />
        <Feedback tone="error">
          {source.error || "This invoice is unavailable."}
        </Feedback>
        <Link to={invoicePath(id)}>Back to invoice</Link>
        <Button tone="secondary" onClick={source.reload}>
          Retry
        </Button>
      </>
    );
  const invoice = source.data;
  return (
    <>
      <Link className="back-link" to={invoicePath(id)}>
        <ArrowLeft size={16} />
        Back to {invoice.number}
      </Link>
      <PageHeading
        title="Review replacement"
        autoFocus
        description={`A linked successor for ${invoice.number}. The canceled revision remains in its audit history.`}
      />
      {!invoice.allowedActions.includes("replace") ? (
        <Feedback>
          This revision cannot be replaced. Only the current canceled invoice
          with no payment ever recorded is eligible.{" "}
          <Link to={invoicePath(invoice.currentInvoiceId)}>
            Open current invoice {invoice.currentInvoiceNumber}
          </Link>
          .
        </Feedback>
      ) : (
        <>
          <div className="replacement-notice">
            <strong>Review the recalculated amount.</strong>
            <p>
              Accepted unit prices and quantities stay the same. Tax and
              discount eligibility are evaluated again; a previously consumed
              discount use is not restored.
            </p>
          </div>
          {previewError && (
            <Feedback tone="error">
              {previewError}{" "}
              <button
                className="text-button"
                onClick={() => {
                  source.reload();
                  setRevision((value) => value + 1);
                }}
              >
                Refresh replacement preview
              </button>
            </Feedback>
          )}
          {previewBusy ? (
            <Loading>Calculating a replacement preview…</Loading>
          ) : (
            preview && (
              <>
                <div className="replacement-comparison">
                  <div>
                    <span>Canceled historical total</span>
                    <strong>{formatMoney(invoice.total)}</strong>
                    <small>{invoice.number} · not collectible</small>
                  </div>
                  <ArrowRight aria-hidden="true" size={22} />
                  <div>
                    <span>Replacement Draft total</span>
                    <strong>{formatMoney(preview.total)}</strong>
                    <small>Awaiting confirmation · not collectible</small>
                  </div>
                </div>
                <div className="agreement-layout">
                  <section className="panel invoice-period">
                    <h2>Same logical charge. A new revision.</h2>
                    <dl className="catalog-detail-grid">
                      <div>
                        <dt>Customer</dt>
                        <dd>
                          {preview.customerName}
                          <small>{preview.customerEmail}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Subscription</dt>
                        <dd>
                          <Link to={`/subscriptions/${preview.subscriptionId}`}>
                            {preview.subscriptionNumber}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt>Period starts</dt>
                        <dd>{formatBusinessDate(preview.periodStart)}</dd>
                      </div>
                      <div>
                        <dt>Period ends (exclusive)</dt>
                        <dd>{formatBusinessDate(preview.periodEnd)}</dd>
                      </div>
                      <div>
                        <dt>New issue date</dt>
                        <dd>{formatBusinessDate(preview.issueDate)}</dd>
                      </div>
                      <div>
                        <dt>New due date</dt>
                        <dd>{formatBusinessDate(preview.dueDate)}</dd>
                      </div>
                    </dl>
                    <DiscountReasons invoice={preview} />
                    <Button
                      onClick={() => {
                        setError("");
                        setConfirm(true);
                      }}
                    >
                      Create replacement draft
                      <ArrowRight size={17} />
                    </Button>
                  </section>
                  <section className="panel calculation-panel">
                    <h2>Replacement invoice preview</h2>
                    <InvoiceBreakdown invoice={preview} />
                  </section>
                </div>
                <ConfirmationDialog
                  open={confirm}
                  title="Create this replacement?"
                  description={`Create one linked Draft after ${invoice.number}, for the same period. The canceled revision remains historical. Confirmation is still required before collection.`}
                  confirmLabel="Create replacement draft"
                  busy={busy}
                  error={error}
                  onCancel={() => setConfirm(false)}
                  onConfirm={() => void replace()}
                >
                  <dl className="confirmation-summary">
                    <div>
                      <dt>Previous historical total</dt>
                      <dd>{formatMoney(invoice.total)}</dd>
                    </div>
                    <div>
                      <dt>Replacement Draft total</dt>
                      <dd>{formatMoney(preview.total)}</dd>
                    </div>
                  </dl>
                  {error && (
                    <p className="footnote">
                      <Link
                        to={`/billing/invoices?subscriptionId=${invoice.subscriptionId}`}
                      >
                        Check saved revisions
                      </Link>{" "}
                      before retrying an uncertain response.{" "}
                      <button
                        className="text-button"
                        onClick={() => {
                          setConfirm(false);
                          source.reload();
                          setRevision((value) => value + 1);
                        }}
                      >
                        Refresh preview
                      </button>{" "}
                      if the financial calculation changed.
                    </p>
                  )}
                </ConfirmationDialog>
              </>
            )
          )}
        </>
      )}
    </>
  );
}

interface DiscountFormValues {
  name: string;
  kind: "fixed" | "percentage";
  value: string;
  minAmount: string;
  minQuantity: string;
  startDate: string;
  endDate: string;
  maxUses: string;
  priority: string;
  active: boolean;
  scope: "subscription" | "products";
  subscriptionId: string | null;
  productIds: string[];
}
const newDiscount: DiscountFormValues = {
  name: "",
  kind: "percentage",
  value: "",
  minAmount: "",
  minQuantity: "",
  startDate: "",
  endDate: "",
  maxUses: "",
  priority: "100",
  active: true,
  scope: "subscription",
  subscriptionId: null,
  productIds: [],
};
function discountValues(rule: DiscountRule): DiscountFormValues {
  return {
    name: rule.name,
    kind: rule.kind,
    value: amountInput(
      rule.kind === "fixed" ? rule.amountMinor || 0 : rule.percentBps || 0,
    ),
    minAmount: rule.minAmount === null ? "" : amountInput(rule.minAmount),
    minQuantity: rule.minQuantity === null ? "" : String(rule.minQuantity),
    startDate: rule.startDate || "",
    endDate: rule.endDate || "",
    maxUses: rule.maxUses === null ? "" : String(rule.maxUses),
    priority: String(rule.priority),
    active: rule.active,
    scope: rule.scope,
    subscriptionId: rule.subscriptionId,
    productIds: rule.productIds,
  };
}
function SelectedProduct({ id, remove }: { id: string; remove?: () => void }) {
  const resource = useResource<Product>(`/api/products/${id}`);
  return (
    <li>
      <Link to={`/configuration/products/${id}`}>
        {resource.data?.name ||
          (resource.error ? "Product unavailable" : "Loading product…")}
      </Link>
      {remove && (
        <Button
          tone="ghost"
          onClick={remove}
          aria-label={`Remove ${resource.data?.name || "selected product"}`}
        >
          <Trash2 size={14} />
          Remove
        </Button>
      )}
    </li>
  );
}
export function DiscountEditorRoute() {
  const { id } = useParams();
  return <DiscountEditor key={id || "new"} id={id} />;
}
function DiscountEditor({ id }: { id?: string }) {
  const editor = useConfigurationEditor<DiscountRule, DiscountFormValues>(
    "discounts",
    id,
    newDiscount,
    discountValues,
  );
  const { values, setValues, fields } = editor;
  const [productChoice, setProductChoice] = useState("");
  useEffect(() => {
    document.title = `${id ? "Edit" : "New"} discount rule · SubTrack`;
  }, [id]);
  if (id && editor.loaded.error)
    return (
      <Feedback tone="error">
        {editor.loaded.error}{" "}
        <button className="text-button" onClick={editor.loaded.reload}>
          Retry
        </button>
      </Feedback>
    );
  if (id && (editor.loaded.busy || editor.version === null))
    return <Loading>Loading the saved rule…</Loading>;
  const valueField = values.kind === "fixed" ? "amountMinor" : "percentBps";
  function submit(event: FormEvent<HTMLFormElement>) {
    void editor.save(event, discountInputSchema, () => ({
      name: values.name,
      kind: values.kind,
      amountMinor: values.kind === "fixed" ? decimal(values.value) : null,
      percentBps: values.kind === "percentage" ? decimal(values.value) : null,
      minAmount: optionalDecimal(values.minAmount),
      minQuantity: optionalWhole(values.minQuantity, "minQuantity"),
      startDate: values.startDate || null,
      endDate: values.endDate || null,
      maxUses: optionalWhole(values.maxUses, "maxUses"),
      priority: whole(values.priority, "priority"),
      active: values.active,
      scope: values.scope,
      subscriptionId: values.subscriptionId,
      productIds: values.productIds,
    }));
  }
  return (
    <>
      <Link className="back-link" to={editor.back}>
        <ArrowLeft size={16} />
        Back to discount rules
      </Link>
      <div className="catalog-section-title">
        <div>
          <h2>{id ? "Edit discount rule" : "New discount rule"}</h2>
          <p>
            Set eligibility once. Eligible invoices apply the rule
            automatically.
          </p>
        </div>
      </div>
      {editor.error && (
        <Feedback tone="error">
          {editor.error}{" "}
          {id && (
            <Link to={`/configuration/discounts/${id}`}>
              Review the saved rule
            </Link>
          )}
        </Feedback>
      )}
      <div className="catalog-form-layout">
        <form
          className="panel catalog-editor"
          noValidate
          aria-label={id ? "Edit discount rule" : "New discount rule"}
          onSubmit={submit}
        >
          <Field
            name="name"
            label="Discount rule name"
            value={values.name}
            error={fields.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
          <div className="field-pair">
            <SelectField
              label="Discount type"
              name="kind"
              value={values.kind}
              error={fields.kind}
              onChange={(event) =>
                setValues({
                  ...values,
                  kind: event.target.value as DiscountFormValues["kind"],
                })
              }
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </SelectField>
            <Field
              name={valueField}
              label={
                values.kind === "fixed"
                  ? "Discount amount (INR)"
                  : "Discount percentage (%)"
              }
              inputMode="decimal"
              value={values.value}
              error={fields[valueField]}
              onChange={(event) =>
                setValues({ ...values, value: event.target.value })
              }
            />
          </div>
          <fieldset className="editor-section">
            <legend>Eligibility thresholds</legend>
            <p className="field-help">
              Both thresholds must pass when both are configured. Blank means no
              threshold.
            </p>
            <div className="field-pair">
              <Field
                name="minAmount"
                label="Minimum eligible purchase (INR)"
                inputMode="decimal"
                value={values.minAmount}
                error={fields.minAmount}
                onChange={(event) =>
                  setValues({ ...values, minAmount: event.target.value })
                }
              />
              <Field
                name="minQuantity"
                label="Minimum eligible quantity"
                inputMode="numeric"
                value={values.minQuantity}
                error={fields.minQuantity}
                onChange={(event) =>
                  setValues({ ...values, minQuantity: event.target.value })
                }
              />
            </div>
          </fieldset>
          <fieldset className="editor-section">
            <legend>Validity and usage</legend>
            <div className="field-pair">
              <Field
                name="startDate"
                label="Valid from"
                type="date"
                value={values.startDate}
                error={fields.startDate}
                onChange={(event) =>
                  setValues({ ...values, startDate: event.target.value })
                }
              />
              <Field
                name="endDate"
                label="Valid through"
                type="date"
                value={values.endDate}
                error={fields.endDate}
                onChange={(event) =>
                  setValues({ ...values, endDate: event.target.value })
                }
              />
            </div>
            <div className="field-pair">
              <Field
                name="maxUses"
                label="Maximum invoice uses"
                inputMode="numeric"
                value={values.maxUses}
                error={fields.maxUses}
                help="Blank is unlimited. Each generated draft reserves one use."
                onChange={(event) =>
                  setValues({ ...values, maxUses: event.target.value })
                }
              />
              <Field
                name="priority"
                label="Priority"
                inputMode="numeric"
                value={values.priority}
                error={fields.priority}
                help="Lower numbers are selected first; rules do not stack."
                onChange={(event) =>
                  setValues({ ...values, priority: event.target.value })
                }
              />
            </div>
            {editor.loaded.data && (
              <p className="field-help">
                Currently {editor.loaded.data.reserved} reserved and{" "}
                {editor.loaded.data.consumed} consumed. A new limit cannot be
                below occupied uses.
              </p>
            )}
          </fieldset>
          <fieldset className="editor-section">
            <legend>Scope</legend>
            <SelectField
              name="scope"
              label="Discount scope"
              value={values.scope}
              error={fields.scope}
              onChange={(event) =>
                setValues({
                  ...values,
                  scope: event.target.value as DiscountFormValues["scope"],
                  productIds: [],
                })
              }
            >
              <option value="subscription">Whole subscription</option>
              <option value="products">Selected products</option>
            </SelectField>
            {values.scope === "products" && (
              <>
                <RecordSelect<Product>
                  resource="products"
                  name="productIds"
                  label="Add eligible product"
                  emptyLabel="Choose a product to add"
                  value={productChoice}
                  error={fields.productIds}
                  disabled={values.productIds.length >= 50}
                  help="Choose up to 50 products. Thresholds count only eligible product lines."
                  onChange={(productId) => {
                    setProductChoice("");
                    if (productId && !values.productIds.includes(productId))
                      setValues({
                        ...values,
                        productIds: [...values.productIds, productId],
                      });
                  }}
                />
                <ul className="selected-products">
                  {values.productIds.map((productId) => (
                    <SelectedProduct
                      key={productId}
                      id={productId}
                      remove={() =>
                        setValues({
                          ...values,
                          productIds: values.productIds.filter(
                            (value) => value !== productId,
                          ),
                        })
                      }
                    />
                  ))}
                </ul>
              </>
            )}
            <SelectField
              label="Subscription targeting"
              value={values.subscriptionId === null ? "all" : "one"}
              onChange={(event) =>
                setValues({
                  ...values,
                  subscriptionId: event.target.value === "all" ? null : "",
                })
              }
            >
              <option value="all">All qualifying subscriptions</option>
              <option value="one">One selected subscription</option>
            </SelectField>
            {values.subscriptionId !== null && (
              <RecordSelect<SubscriptionSummary>
                resource="subscriptions"
                name="subscriptionId"
                label="Target subscription"
                value={values.subscriptionId}
                selectedLabel={
                  editor.loaded.data?.subscriptionNumber || undefined
                }
                error={fields.subscriptionId}
                onChange={(subscriptionId) =>
                  setValues({ ...values, subscriptionId })
                }
              />
            )}
          </fieldset>
          <CheckboxField
            label="Rule enabled"
            checked={values.active}
            onChange={(event) =>
              setValues({ ...values, active: event.target.checked })
            }
          />
          <div className="form-actions">
            <Link className="button secondary" to={editor.back}>
              Cancel
            </Link>
            <Button type="submit" busy={editor.busy}>
              Save discount rule
            </Button>
          </div>
        </form>
        <aside className="form-aside">
          <Percent size={25} />
          <h3>One rule. A clear reduction.</h3>
          <p>
            Eligibility uses invoice-generation dates and eligible line
            quantities and amounts before tax. End dates are inclusive.
          </p>
          <p>
            Draft generation reserves a use. Confirmation consumes it once;
            canceling a Draft releases it. A canceled Confirmed invoice keeps
            its consumed use.
          </p>
          <p className="muted">
            Rule edits affect future generation. Existing invoice snapshots stay
            unchanged.
          </p>
        </aside>
      </div>
      {editor.guard.confirm}
    </>
  );
}

export function DiscountDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const resource = useResource<DiscountRule>(`/api/discounts/${id}`);
  useEffect(() => {
    document.title = `${resource.data?.name || "Discount rule"} · SubTrack`;
  }, [resource.data?.name]);
  if (resource.busy) return <Loading>Loading the discount rule…</Loading>;
  const rule = resource.data;
  if (resource.error || !rule)
    return (
      <Feedback tone="error">
        {resource.error || "This rule could not be loaded."}{" "}
        <button className="text-button" onClick={resource.reload}>
          Retry
        </button>
      </Feedback>
    );
  return (
    <>
      <Link className="back-link" to="/configuration/discounts">
        <ArrowLeft size={16} />
        Back to discount rules
      </Link>
      <div className="catalog-section-title">
        <div>
          <h2>{rule.name}</h2>
          <p>
            {rule.active
              ? "Enabled for eligible future invoices"
              : "Inactive for future invoices"}
          </p>
        </div>
        <div className="heading-actions">
          <Button
            tone="secondary"
            onClick={resource.reload}
            aria-label="Refresh discount usage"
          >
            <RefreshCw size={17} />
          </Button>
          {user?.role === "admin" && (
            <Link
              className="button secondary"
              to={`/configuration/discounts/${rule.id}/edit`}
            >
              <Pencil size={16} />
              Edit discount rule
            </Link>
          )}
        </div>
      </div>
      <section className="panel discount-detail">
        <dl className="catalog-detail-grid">
          <div>
            <dt>Reduction</dt>
            <dd>
              {rule.kind === "fixed"
                ? formatMoney(rule.amountMinor || 0)
                : `${amountInput(rule.percentBps || 0)}%`}
            </dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>
              {rule.scope === "subscription"
                ? "Whole subscription"
                : "Selected products"}
            </dd>
          </div>
          <div>
            <dt>Subscription target</dt>
            <dd>
              {rule.subscriptionId ? (
                <Link to={`/subscriptions/${rule.subscriptionId}`}>
                  {rule.subscriptionNumber}
                </Link>
              ) : (
                "All qualifying subscriptions"
              )}
            </dd>
          </div>
          <div>
            <dt>Minimum eligible purchase</dt>
            <dd>
              {rule.minAmount === null
                ? "No threshold"
                : formatMoney(rule.minAmount)}
            </dd>
          </div>
          <div>
            <dt>Minimum eligible quantity</dt>
            <dd>
              {rule.minQuantity === null ? "No threshold" : rule.minQuantity}
            </dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>{rule.priority}</dd>
          </div>
          <div>
            <dt>Valid from</dt>
            <dd>
              {rule.startDate
                ? formatBusinessDate(rule.startDate)
                : "No start limit"}
            </dd>
          </div>
          <div>
            <dt>Valid through (inclusive)</dt>
            <dd>
              {rule.endDate ? formatBusinessDate(rule.endDate) : "No end limit"}
            </dd>
          </div>
          <div>
            <dt>Maximum uses</dt>
            <dd>{rule.maxUses === null ? "Unlimited" : rule.maxUses}</dd>
          </div>
        </dl>
        {rule.scope === "products" && (
          <>
            <h3>Eligible products</h3>
            <ul className="selected-products">
              {rule.productIds.map((productId) => (
                <SelectedProduct key={productId} id={productId} />
              ))}
            </ul>
          </>
        )}
        <h3>Usage</h3>
        <dl className="rule-usage">
          <div>
            <dt>Reserved</dt>
            <dd>{rule.reserved}</dd>
          </div>
          <div>
            <dt>Consumed</dt>
            <dd>{rule.consumed}</dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd>{rule.remaining === null ? "Unlimited" : rule.remaining}</dd>
          </div>
        </dl>
        <h3>Drafts holding reservations</h3>
        {!rule.holdingDrafts?.length ? (
          <p className="muted">No drafts currently hold a use of this rule.</p>
        ) : (
          <ul className="related-records">
            {rule.holdingDrafts.map((invoice) => (
              <li key={invoice.id}>
                <Link to={invoicePath(invoice.id)}>
                  {invoice.number}
                  <ChevronRight size={13} />
                </Link>
                <span className="status info">Draft · reserved</span>
                <small>{formatDate(invoice.createdAt)}</small>
              </li>
            ))}
          </ul>
        )}
        {rule.holdingDraftsTruncated && (
          <p className="footnote">
            Showing {rule.holdingDrafts?.length || 0} of{" "}
            {rule.holdingDraftsTotal} holding drafts. Additional reservations
            are included in the counts.
          </p>
        )}
        <p className="footnote">
          Version {rule.version}. Generated invoice calculations remain frozen
          through later rule changes or expiry.
        </p>
      </section>
    </>
  );
}
