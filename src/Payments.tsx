import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft, RefreshCw, WalletCards } from "lucide-react";
import type { Page } from "../shared/contracts";
import type { Invoice } from "../shared/billing";
import {
  paymentInputSchema,
  paymentMethods,
  paymentMethodLabels,
  type Payment,
  type PaymentInput,
  type PaymentResult,
} from "../shared/payments";
import { formatMoney, parseAmount } from "../shared/money";
import { errorMessage, request } from "./api";
import { validateForm } from "./Auth";
import { useSession } from "./session";
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
  TextareaField,
  useUnsavedChanges,
} from "./ui";

export function InvoicePaymentHistory({ invoice }: { invoice: Invoice }) {
  const { user } = useSession();
  const internal = user?.role !== "customer";
  const [page, setPage] = useState(1);
  const payments = useResource<Page<Payment>>(
    `/api/invoices/${invoice.id}/payments?page=${page}&pageSize=20`,
  );
  return (
    <section
      className="invoice-payments"
      aria-labelledby="payment-history-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="payment-history-title">Payment history</h2>
          <p>
            {invoice.paymentCount} payment{" "}
            {invoice.paymentCount === 1 ? "record" : "records"} ·{" "}
            {formatMoney(invoice.amountPaid)} recorded
          </p>
        </div>
        <Button tone="ghost" onClick={payments.reload} disabled={payments.busy}>
          <RefreshCw size={15} />
          Refresh payments
        </Button>
      </div>
      {payments.error ? (
        <Feedback tone="error">
          {payments.error}{" "}
          <button className="text-button" onClick={payments.reload}>
            Retry
          </button>
        </Feedback>
      ) : payments.busy ? (
        <Loading>Loading payment history…</Loading>
      ) : !payments.data?.items.length ? (
        <p className="field-help">
          No payments have been recorded against this invoice.
          {invoice.status === "Paid" && invoice.total === 0
            ? " It settled for zero amount due without a payment."
            : ""}
        </p>
      ) : (
        <div className="payment-history-list">
          {payments.data.items.map((payment) => (
            <article key={payment.id}>
              <div className="payment-history-heading">
                <strong>{formatMoney(payment.amount)}</strong>
                <span>{paymentMethodLabels[payment.method]}</span>
                <span>Paid on {formatBusinessDate(payment.paymentDate)}</span>
              </div>
              <p>
                Recorded {formatDate(payment.recordedAt, true)} ·{" "}
                {payment.recordedBy}
              </p>
              {internal && payment.note && (
                <div className="payment-note">
                  <span>Internal note</span>
                  <p>{payment.note}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {(payments.data?.total || 0) > 20 && (
        <Pagination
          page={page}
          pageSize={payments.data?.pageSize || 20}
          total={payments.data?.total || 0}
          busy={payments.busy}
          onPage={setPage}
        />
      )}
      <p className="footnote">
        Recorded payments cannot be edited or reversed.
        {internal
          ? " Record only a payment already received; this application does not move money."
          : " Your Brightloop team records payments received."}
      </p>
    </section>
  );
}

export function PaymentEditorRoute() {
  const { id } = useParams();
  const invoice = useResource<Invoice>(`/api/invoices/${id}`);
  useEffect(() => {
    document.title = "Record payment · SubTrack";
  }, []);
  if (invoice.busy) return <Loading>Loading the invoice balance…</Loading>;
  if (invoice.error || !invoice.data)
    return (
      <>
        <PageHeading title="Payment form couldn’t load." />
        <Feedback tone="error">
          {invoice.error || "This invoice is unavailable."}
        </Feedback>
        <Button tone="secondary" onClick={invoice.reload}>
          Retry
        </Button>
        <Link to="/billing/invoices">Back to invoices</Link>
      </>
    );
  return <PaymentEditor key={id} invoice={invoice.data} />;
}
function PaymentEditor({ invoice }: { invoice: Invoice }) {
  const navigate = useNavigate();
  const location = useLocation();
  const origin = (location.state as { returnTo?: string } | null)?.returnTo;
  const invoiceState =
    origin?.startsWith("/finance") || origin?.startsWith("/billing/invoices")
      ? { returnTo: origin }
      : undefined;
  const initial = {
    amount: "",
    method: "bank_transfer",
    paymentDate: invoice.businessDate,
    note: "",
  };
  const [values, setValues] = useState(initial),
    [fields, setFields] = useState<Record<string, string>>({});
  const [review, setReview] = useState<PaymentInput | null>(null),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const guard = useUnsavedChanges(
    JSON.stringify(values) !== JSON.stringify(initial),
  );
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let amount = Number.NaN;
    try {
      amount = parseAmount(values.amount);
    } catch {
      /* Shared field validation explains exact decimal entry. */
    }
    const candidate = {
      ...values,
      amount,
      currency: "INR" as const,
      idempotencyKey: receipt.current?.key || crypto.randomUUID(),
    };
    const invalid = validateForm(
      paymentInputSchema,
      candidate,
      event.currentTarget,
    );
    if (invalid) {
      setFields(invalid);
      return;
    }
    const additional: Record<string, string> = {};
    if (candidate.paymentDate > invoice.businessDate)
      additional.paymentDate = `Use a payment date on or before ${formatBusinessDate(invoice.businessDate)}.`;
    if (amount > invoice.outstanding)
      additional.amount = `The current outstanding balance is ${formatMoney(invoice.outstanding)}. Review the invoice before recording more.`;
    setFields(additional);
    if (Object.keys(additional).length) {
      event.currentTarget
        .querySelector<HTMLElement>(`[name="${Object.keys(additional)[0]}"]`)
        ?.focus();
      return;
    }
    const parsed = paymentInputSchema.parse(candidate);
    const fingerprint = JSON.stringify({
      ...parsed,
      idempotencyKey: undefined,
    });
    if (receipt.current?.fingerprint !== fingerprint)
      receipt.current = { fingerprint, key: crypto.randomUUID() };
    setReview({ ...parsed, idempotencyKey: receipt.current.key });
    setError("");
    setConfirm(true);
  }
  async function save() {
    if (!review || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request<PaymentResult>(
        `/api/invoices/${invoice.id}/payments`,
        { method: "POST", body: review },
      );
      guard.allowNavigation();
      navigate(`/billing/invoices/${invoice.id}`, {
        replace: true,
        state: {
          ...invoiceState,
          message: `Payment of ${formatMoney(result.payment.amount)} recorded. ${result.invoice.status === "Paid" ? "The invoice is Paid." : `${formatMoney(result.invoice.outstanding)} remains outstanding.`}`,
        },
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Link
        className="back-link"
        to={`/billing/invoices/${invoice.id}`}
        state={invoiceState}
      >
        <ArrowLeft size={16} />
        Back to {invoice.number}
      </Link>
      <PageHeading
        title="Record payment"
        autoFocus
        description={`${invoice.number} · ${invoice.customerName}`}
      />
      {!invoice.allowedActions.includes("recordPayment") ? (
        <Feedback>
          This invoice cannot accept a payment. It must be the current Confirmed
          revision with a positive outstanding balance.{" "}
          <Link to={`/billing/invoices/${invoice.currentInvoiceId}`}>
            Review the current invoice.
          </Link>
        </Feedback>
      ) : (
        <div className="payment-editor-layout">
          <form
            className="panel catalog-editor"
            aria-label="Record invoice payment"
            noValidate
            onSubmit={prepare}
          >
            <h2>Payment received</h2>
            <p className="field-help">
              Record an already received payment against this invoice. No money
              is moved.
            </p>
            <Field
              name="amount"
              label="Payment amount (INR)"
              inputMode="decimal"
              value={values.amount}
              error={fields.amount}
              onChange={(event) =>
                setValues({ ...values, amount: event.target.value })
              }
            />
            <div className="field-pair">
              <SelectField
                name="method"
                label="Payment method"
                value={values.method}
                error={fields.method}
                onChange={(event) =>
                  setValues({ ...values, method: event.target.value })
                }
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {paymentMethodLabels[method]}
                  </option>
                ))}
              </SelectField>
              <Field
                name="paymentDate"
                label="Payment date"
                type="date"
                max={invoice.businessDate}
                value={values.paymentDate}
                error={fields.paymentDate}
                help="Business date in Asia/Kolkata; future dates are not accepted."
                onChange={(event) =>
                  setValues({ ...values, paymentDate: event.target.value })
                }
              />
            </div>
            <TextareaField
              name="note"
              label="Internal payment note"
              value={values.note}
              error={fields.note}
              maxLength={2000}
              help="Optional. Visible only to authorized internal users; excluded from the customer portal and print output."
              onChange={(event) =>
                setValues({ ...values, note: event.target.value })
              }
            />
            <div className="form-actions">
              <Link
                className="button secondary"
                to={`/billing/invoices/${invoice.id}`}
                state={invoiceState}
              >
                Cancel
              </Link>
              <Button type="submit">
                <WalletCards size={17} />
                Review payment
              </Button>
            </div>
            <p className="footnote">
              Check these details carefully. Recorded payments cannot be edited
              or reversed.
            </p>
          </form>
          <aside className="payment-balance">
            <h2>Invoice balance</h2>
            <dl>
              <div>
                <dt>Invoice total</dt>
                <dd>{formatMoney(invoice.total)}</dd>
              </div>
              <div>
                <dt>Already recorded</dt>
                <dd>{formatMoney(invoice.amountPaid)}</dd>
              </div>
              <div className="grand-total">
                <dt>Outstanding</dt>
                <dd>{formatMoney(invoice.outstanding)}</dd>
              </div>
              <div>
                <dt>Due date</dt>
                <dd>
                  {formatBusinessDate(invoice.dueDate)}
                  {invoice.overdue && (
                    <small className="overdue-label">Overdue</small>
                  )}
                </dd>
              </div>
            </dl>
            <p className="field-help">
              The remaining balance is checked again when you record the
              payment. A partial payment keeps the invoice Confirmed.
            </p>
          </aside>
        </div>
      )}
      <ConfirmationDialog
        open={confirm}
        title="Record this payment?"
        description="Check the amount, method and date of the payment already received. Saving adds a permanent payment record to this invoice."
        confirmLabel="Record payment"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void save()}
      >
        {review && (
          <dl className="confirmation-summary">
            <div>
              <dt>Invoice / customer</dt>
              <dd>
                {invoice.number}
                <br />
                {invoice.customerName}
              </dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(review.amount)}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{paymentMethodLabels[review.method]}</dd>
            </div>
            <div>
              <dt>Payment date</dt>
              <dd>{formatBusinessDate(review.paymentDate)}</dd>
            </div>
            {review.note && (
              <div>
                <dt>Internal note</dt>
                <dd className="review-note" tabIndex={0}>
                  {review.note}
                </dd>
              </div>
            )}
          </dl>
        )}
        {error && (
          <p className="footnote">
            <Link to={`/billing/invoices/${invoice.id}`} state={invoiceState}>
              Check saved payment history and the current balance
            </Link>{" "}
            if the result is unclear. Retrying the unchanged review returns the
            same payment record.
          </p>
        )}
      </ConfirmationDialog>
      {guard.confirm}
    </>
  );
}
