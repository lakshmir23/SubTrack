import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, RefreshCw, ReceiptText } from "lucide-react";
import type { Page, User } from "../shared/contracts";
import {
  financeFilterSchema,
  type FinanceFilters,
  type FinanceSummary,
  type FinanceAgreement,
  type FinanceInvoice,
  type FinancePayment,
  type FinanceMinor,
} from "../shared/finance";
import { formatMoney } from "../shared/money";
import { paymentMethodLabels } from "../shared/payments";
import { validateForm } from "./Auth";
import { RecordSelect } from "./Catalog";
import { formatBusinessDate, formatDate, useResource } from "./Workspace";
import {
  Button,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PageHeading,
  Pagination,
} from "./ui";

const filterNames = [
  "customerId",
  "invoiceFrom",
  "invoiceTo",
  "paymentFrom",
  "paymentTo",
] as const;
type FilterDraft = Record<(typeof filterNames)[number], string>;
type View = "overview" | "agreements" | "invoices" | "payments";
function filtersFrom(params: URLSearchParams): FinanceFilters {
  return Object.fromEntries(
    filterNames
      .filter((name) => params.get(name))
      .map((name) => [name, params.get(name)!]),
  );
}
function draftFrom(filters: FinanceFilters): FilterDraft {
  return Object.fromEntries(
    filterNames.map((name) => [name, filters[name] || ""]),
  ) as FilterDraft;
}
function serialized(filters: FinanceFilters) {
  return new URLSearchParams(Object.entries(filters)).toString();
}
/** Aggregate strings can exceed Number precision. Formatting keeps every paise. */
function aggregateMoney(value: FinanceMinor) {
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}₹${new Intl.NumberFormat("en-IN").format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}
function dateScope(from?: string, to?: string) {
  return from && to
    ? `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`
    : from
      ? `From ${formatBusinessDate(from)}`
      : to
        ? `Through ${formatBusinessDate(to)}`
        : "All dates";
}
const definitionId = (label: string) =>
  `finance-definition-${label.toLowerCase().replace(/\W+/g, "-")}`;
const titles: Record<View, string> = {
  overview: "Finance",
  agreements: "Active agreements",
  invoices: "Invoiced amount",
  payments: "Payments received",
};
function FinancialMetric({
  label,
  value,
  count,
  to,
  attention = false,
}: {
  label: string;
  value: string;
  count?: string;
  to?: string;
  attention?: boolean;
}) {
  const content = (
    <>
      <span>
        {label}
        {to && <ArrowRight size={16} />}
      </span>
      <strong>{value}</strong>
      {count && <small>{count}</small>}
    </>
  );
  const className = `finance-metric ${attention ? "attention" : ""}`;
  return to ? (
    <Link className={className} to={to} aria-describedby={definitionId(label)}>
      {content}
    </Link>
  ) : (
    <div className={className} aria-describedby={definitionId(label)}>
      {content}
    </div>
  );
}
export function Finance({ view = "overview" }: { view?: View }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filters = filtersFrom(params),
    filterKey = serialized(filters),
    valid = financeFilterSchema.safeParse(filters).success;
  const [values, setValues] = useState(() => draftFrom(filters)),
    [fields, setFields] = useState<Record<string, string>>({});
  const [filtersOpen, setFiltersOpen] = useState(
    () => window.matchMedia("(min-width: 800px)").matches,
  );
  const [draftCustomerName, setDraftCustomerName] = useState<
    string | undefined
  >();
  const filterDisclosure = useRef<HTMLDetailsElement>(null),
    filterForm = useRef<HTMLFormElement>(null);
  const invoiceView =
    params.get("view") === "outstanding"
      ? "outstanding"
      : params.get("view") === "overdue"
        ? "overdue"
        : "invoiced";
  const pageValue = Number(params.get("page") || "1"),
    page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const summary = useResource<FinanceSummary>(
    valid ? `/api/finance/summary?${filterKey}` : null,
  );
  const rows = useResource<
    Page<FinanceAgreement | FinanceInvoice | FinancePayment>
  >(
    valid && view !== "overview"
      ? `/api/finance/${view}?${filterKey}${filterKey ? "&" : ""}page=${page}&pageSize=20${view === "invoices" ? `&view=${invoiceView}` : ""}`
      : null,
  );
  const title =
    view === "invoices" && invoiceView !== "invoiced"
      ? invoiceView === "outstanding"
        ? "Outstanding invoices"
        : "Overdue invoices"
      : titles[view];
  useEffect(() => {
    document.title = `${title} · SubTrack`;
  }, [title]);
  useEffect(() => {
    setValues(draftFrom(filters));
    setFields({});
    setDraftCustomerName(undefined);
  }, [filterKey]);
  useEffect(() => {
    if (!valid && filterForm.current) {
      if (filterDisclosure.current) filterDisclosure.current.open = true;
      setFiltersOpen(true);
      setFields(
        validateForm(financeFilterSchema, filters, filterForm.current) || {},
      );
    }
  }, [filterKey, valid]);
  useEffect(() => {
    if (rows.data && rows.data.page !== page) pageTo(rows.data.page);
  }, [rows.data, page]);
  function pageTo(nextPage: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage > 1) next.set("page", String(nextPage));
      else next.delete("page");
      return next;
    });
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (filterDisclosure.current) filterDisclosure.current.open = true;
    setFiltersOpen(true);
    const next = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value),
    );
    const invalid = validateForm(
      financeFilterSchema,
      next,
      event.currentTarget,
    );
    setFields(invalid || {});
    if (invalid) return;
    const query = new URLSearchParams(next);
    if (view === "invoices" && invoiceView !== "invoiced")
      query.set("view", invoiceView);
    setParams(query);
    if (!window.matchMedia("(min-width: 800px)").matches) {
      setFiltersOpen(false);
      window.requestAnimationFrame(() =>
        filterDisclosure.current
          ?.querySelector<HTMLElement>("summary")
          ?.focus(),
      );
    }
  }
  function reset() {
    setValues(draftFrom({}));
    setFields({});
    setParams(
      view === "invoices" && invoiceView !== "invoiced"
        ? { view: invoiceView }
        : {},
    );
  }
  function link(path: string, extra?: Record<string, string>) {
    const query = new URLSearchParams(filterKey);
    for (const [key, value] of Object.entries(extra || {}))
      query.set(key, value);
    return path + (query.size ? `?${query}` : "");
  }
  const back = location.pathname + location.search;
  const metric = summary.data;
  const viewMetric =
    metric && view !== "overview"
      ? view === "agreements"
        ? {
            label: "Active agreements",
            value: metric.activeAgreements.toLocaleString("en-IN"),
            count: `${metric.pausedAgreements} paused · included above`,
            definition: metric.definitions.active,
          }
        : view === "payments"
          ? {
              label: "Payments received",
              value: aggregateMoney(metric.paymentsReceived),
              count: `${metric.paymentCount} ${metric.paymentCount === 1 ? "payment" : "payments"}`,
              definition: metric.definitions.payments,
            }
          : invoiceView === "outstanding"
            ? {
                label: "Outstanding",
                value: aggregateMoney(metric.outstanding),
                count: `${metric.outstandingInvoiceCount} ${metric.outstandingInvoiceCount === 1 ? "invoice" : "invoices"}`,
                definition: metric.definitions.outstanding,
              }
            : invoiceView === "overdue"
              ? {
                  label: "Overdue",
                  value: aggregateMoney(metric.overdue),
                  count: `${metric.overdueInvoiceCount} ${metric.overdueInvoiceCount === 1 ? "invoice" : "invoices"}`,
                  definition:
                    "Current unpaid balances due before today, on invoices within the selected issue dates.",
                  attention: BigInt(metric.overdue) > 0n,
                }
              : {
                  label: "Invoiced amount",
                  value: aggregateMoney(metric.invoicedRevenue),
                  count: `${metric.invoiceCount} ${metric.invoiceCount === 1 ? "invoice" : "invoices"}`,
                  definition: metric.definitions.invoiced,
                }
      : null;
  return (
    <>
      {view !== "overview" && (
        <Link className="back-link" to={link("/finance")}>
          <ArrowLeft size={16} />
          Back to finance
        </Link>
      )}
      <PageHeading
        title={title}
        description={
          view === "overview"
            ? "See what has been invoiced, what has been received and what remains unpaid."
            : "Every matching record, with totals across all pages."
        }
        action={
          <Button
            tone="secondary"
            disabled={summary.busy || rows.busy}
            onClick={() => {
              summary.reload();
              if (view !== "overview") rows.reload();
            }}
          >
            <RefreshCw size={17} />
            Refresh finance
          </Button>
        }
      />
      <details
        className="finance-filter-disclosure"
        ref={filterDisclosure}
        open={filtersOpen}
        onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
      >
        <summary>
          <strong>Dates and customer</strong>
          <span className="finance-applied-scope">
            <span>
              Invoices · {dateScope(filters.invoiceFrom, filters.invoiceTo)}
            </span>
            <span>
              Payments · {dateScope(filters.paymentFrom, filters.paymentTo)}
            </span>
            <span>
              Customer ·{" "}
              {filters.customerId
                ? metric?.customerName ||
                  (summary.busy ? "Loading customer…" : "Customer unavailable")
                : "All customers"}
            </span>
          </span>
        </summary>
        <form
          className="finance-filters"
          ref={filterForm}
          aria-label="Finance filters"
          noValidate
          onSubmit={apply}
        >
          <div className="finance-date-groups">
            <fieldset>
              <legend>Invoice issue dates</legend>
              <div className="field-pair">
                <Field
                  name="invoiceFrom"
                  label="Invoice issued from"
                  type="date"
                  value={values.invoiceFrom}
                  error={fields.invoiceFrom}
                  onChange={(event) =>
                    setValues({ ...values, invoiceFrom: event.target.value })
                  }
                />
                <Field
                  name="invoiceTo"
                  label="Invoice issued through"
                  type="date"
                  value={values.invoiceTo}
                  error={fields.invoiceTo}
                  onChange={(event) =>
                    setValues({ ...values, invoiceTo: event.target.value })
                  }
                />
              </div>
            </fieldset>
            <fieldset>
              <legend>Payment received dates</legend>
              <div className="field-pair">
                <Field
                  name="paymentFrom"
                  label="Payment received from"
                  type="date"
                  value={values.paymentFrom}
                  error={fields.paymentFrom}
                  onChange={(event) =>
                    setValues({ ...values, paymentFrom: event.target.value })
                  }
                />
                <Field
                  name="paymentTo"
                  label="Payment received through"
                  type="date"
                  value={values.paymentTo}
                  error={fields.paymentTo}
                  onChange={(event) =>
                    setValues({ ...values, paymentTo: event.target.value })
                  }
                />
              </div>
            </fieldset>
          </div>
          <div className="finance-filter-footer">
            <RecordSelect<User>
              resource="customers"
              name="customerId"
              label="Customer"
              emptyLabel="All customers"
              value={values.customerId}
              selectedLabel={
                values.customerId === filters.customerId
                  ? metric?.customerName ||
                    (summary.busy
                      ? "Loading customer…"
                      : "Customer unavailable")
                  : draftCustomerName
              }
              error={fields.customerId}
              onChange={(customerId, record) => {
                setValues({ ...values, customerId });
                setDraftCustomerName(record?.name);
              }}
            />
            <Button type="submit">Apply filters</Button>
            <Button tone="secondary" onClick={reset}>
              Reset filters
            </Button>
          </div>
          <p className="field-help">
            Invoice dates select invoices and their balances today. Payment
            dates select payments by the date received, regardless of invoice
            date. Active agreements are counted today. Date limits include both
            selected dates.
          </p>
        </form>
      </details>
      {!valid && (
        <Feedback tone="error">
          These date filters are invalid. Adjust the dates above and apply them
          again.
        </Feedback>
      )}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {metric && !summary.busy
          ? `Finance updated. ${aggregateMoney(metric.invoicedRevenue)} invoiced, ${aggregateMoney(metric.paymentsReceived)} received, ${aggregateMoney(metric.outstanding)} outstanding.`
          : ""}
      </p>
      {summary.error ? (
        <Feedback tone="error">
          {summary.error}{" "}
          <button className="text-button" onClick={summary.reload}>
            Retry summary
          </button>
        </Feedback>
      ) : summary.busy ? (
        <Loading>Updating finance totals…</Loading>
      ) : (
        metric &&
        view === "overview" && (
          <>
            <div className="finance-context">
              <span>
                Business date · {formatBusinessDate(metric.businessDate)}
              </span>
              <span>Totals include every matching record.</span>
              <span>
                Balances are current, not a historical balance at the selected
                date.
              </span>
              <span>Invoice dates and payment dates apply separately.</span>
            </div>
            <section className="finance-sheet" aria-label="Finance summary">
              <div className="finance-flow">
                <FinancialMetric
                  label="Invoiced amount"
                  value={aggregateMoney(metric.invoicedRevenue)}
                  count={`${metric.invoiceCount} ${metric.invoiceCount === 1 ? "invoice" : "invoices"}`}
                  to={link("/finance/invoices", { view: "invoiced" })}
                />
                <FinancialMetric
                  label="Payments received"
                  value={aggregateMoney(metric.paymentsReceived)}
                  count={`${metric.paymentCount} ${metric.paymentCount === 1 ? "payment" : "payments"}`}
                  to={link("/finance/payments")}
                />
              </div>
              <div className="finance-position">
                <FinancialMetric
                  label="Active agreements"
                  value={metric.activeAgreements.toLocaleString("en-IN")}
                  count={`${metric.pausedAgreements} paused · included above`}
                  to={link("/finance/agreements")}
                />
                <FinancialMetric
                  label="Outstanding"
                  value={aggregateMoney(metric.outstanding)}
                  count={`${metric.outstandingInvoiceCount} ${metric.outstandingInvoiceCount === 1 ? "invoice" : "invoices"}`}
                  to={link("/finance/invoices", { view: "outstanding" })}
                />
                <FinancialMetric
                  label="Overdue"
                  value={aggregateMoney(metric.overdue)}
                  count={`${metric.overdueInvoiceCount} ${metric.overdueInvoiceCount === 1 ? "invoice" : "invoices"}`}
                  attention={BigInt(metric.overdue) > 0n}
                  to={link("/finance/invoices", { view: "overdue" })}
                />
              </div>
              <details className="finance-definitions">
                <summary>How totals are counted</summary>
                <dl>
                  {[
                    ["Invoiced amount", metric.definitions.invoiced],
                    ["Payments received", metric.definitions.payments],
                    ["Active agreements", metric.definitions.active],
                    ["Outstanding", metric.definitions.outstanding],
                    ["Overdue", metric.definitions.overdue],
                  ].map(([label, description]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd id={definitionId(label)}>{description}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>
          </>
        )
      )}
      {view !== "overview" && (
        <section
          className="list-panel finance-records"
          aria-label="Finance records"
        >
          {viewMetric && !summary.busy && !summary.error ? (
            <div className="finance-view-summary">
              <FinancialMetric {...viewMetric} />
              <div className="finance-view-scope">
                <span>
                  As of {formatBusinessDate(metric!.businessDate)} · All
                  matching records
                </span>
                <p id={definitionId(viewMetric.label)}>
                  {viewMetric.definition}
                </p>
              </div>
            </div>
          ) : (
            <div className="list-toolbar">
              <strong>{title}</strong>
              <span className="list-count">
                {rows.data?.total || 0} records
              </span>
            </div>
          )}
          <div className="table-region" aria-busy={rows.busy}>
            {rows.error ? (
              <div className="list-error">
                <Feedback tone="error">{rows.error}</Feedback>
                <Button tone="secondary" onClick={rows.reload}>
                  <RefreshCw size={16} />
                  Retry records
                </Button>
              </div>
            ) : rows.busy ? (
              <Loading>Loading matching records…</Loading>
            ) : !rows.data?.items.length ? (
              <EmptyState
                title="No records match these filters."
                icon={<ReceiptText size={26} />}
              >
                Adjust the customer or date ranges above.
              </EmptyState>
            ) : view === "agreements" ? (
              <AgreementRows
                items={rows.data.items as FinanceAgreement[]}
                back={back}
              />
            ) : view === "invoices" ? (
              <InvoiceRows
                items={rows.data.items as FinanceInvoice[]}
                back={back}
              />
            ) : (
              <PaymentRows
                items={rows.data.items as FinancePayment[]}
                back={back}
              />
            )}
          </div>
          <Pagination
            page={page}
            pageSize={rows.data?.pageSize || 20}
            total={rows.data?.total || 0}
            onPage={pageTo}
            busy={rows.busy}
          />
        </section>
      )}
    </>
  );
}
function AgreementRows({
  items,
  back,
}: {
  items: FinanceAgreement[];
  back: string;
}) {
  return (
    <table>
      <caption className="sr-only">
        Active agreements matching the customer filter, including paused service
      </caption>
      <thead>
        <tr>
          <th scope="col">Agreement</th>
          <th scope="col">Customer</th>
          <th scope="col">Plan</th>
          <th scope="col">Service</th>
          <th scope="col">Term</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td data-label="Agreement">
              <Link
                className="record-link"
                to={`/subscriptions/${item.id}`}
                state={{ returnTo: back }}
              >
                {item.number}
                <ArrowRight size={14} />
              </Link>
            </td>
            <td data-label="Customer">
              {item.customerName}
              <span className="row-secondary">{item.customerEmail}</span>
            </td>
            <td data-label="Plan">{item.planName}</td>
            <td data-label="Service">
              <span
                className={`status ${item.serviceState === "Running" ? "success" : "info"}`}
              >
                {item.serviceState}
              </span>
            </td>
            <td data-label="Term" className="subscription-dates">
              {formatBusinessDate(item.startDate)}
              <span className="row-secondary">
                to {formatBusinessDate(item.expiryDate)} · exclusive
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function InvoiceRows({
  items,
  back,
}: {
  items: FinanceInvoice[];
  back: string;
}) {
  return (
    <table>
      <caption className="sr-only">
        Invoices matching the selected issue dates and balance view
      </caption>
      <thead>
        <tr>
          <th scope="col">Invoice / customer</th>
          <th scope="col">Issue / due date</th>
          <th scope="col">Status</th>
          <th scope="col" className="money-cell">
            Invoice total
          </th>
          <th scope="col" className="money-cell">
            Recorded payments
          </th>
          <th scope="col" className="money-cell">
            Outstanding
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td data-label="Invoice / customer">
              <Link
                className="record-link"
                to={`/billing/invoices/${item.id}`}
                state={{ returnTo: back }}
              >
                {item.number}
                <ArrowRight size={14} />
              </Link>
              <span className="row-secondary">
                {item.customerName} · {item.subscriptionNumber}
              </span>
            </td>
            <td data-label="Issue / due date" className="date-cell">
              {formatBusinessDate(item.issueDate)}
              <span className="row-secondary">
                Due {formatBusinessDate(item.dueDate)}
              </span>
            </td>
            <td data-label="Status">
              <span
                className={`status ${item.status === "Paid" ? "success" : "info"}`}
              >
                {item.status}
              </span>
              {item.overdue && (
                <span className="row-secondary overdue-label">Overdue</span>
              )}
            </td>
            <td data-label="Invoice total" className="money-cell">
              {formatMoney(item.total)}
            </td>
            <td data-label="Recorded payments" className="money-cell">
              {formatMoney(item.amountPaid)}
            </td>
            <td data-label="Outstanding" className="money-cell">
              {formatMoney(item.outstanding)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function PaymentRows({
  items,
  back,
}: {
  items: FinancePayment[];
  back: string;
}) {
  return (
    <table>
      <caption className="sr-only">
        Payments matching the selected payment dates
      </caption>
      <thead>
        <tr>
          <th scope="col">Invoice / customer</th>
          <th scope="col">Payment date</th>
          <th scope="col">Method</th>
          <th scope="col" className="money-cell">
            Amount
          </th>
          <th scope="col">Recorded</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td data-label="Invoice / customer">
              <Link
                className="record-link"
                to={`/billing/invoices/${item.invoiceId}`}
                state={{ returnTo: back }}
              >
                {item.invoiceNumber}
                <ArrowRight size={14} />
              </Link>
              <span className="row-secondary">
                {item.customerName} · {item.subscriptionNumber}
              </span>
            </td>
            <td data-label="Payment date" className="date-cell">
              {formatBusinessDate(item.paymentDate)}
            </td>
            <td data-label="Method">{paymentMethodLabels[item.method]}</td>
            <td data-label="Amount" className="money-cell">
              {formatMoney(item.amount)}
            </td>
            <td data-label="Recorded" className="date-cell">
              {formatDate(item.recordedAt, true)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
