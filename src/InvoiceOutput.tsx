import { useRef, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import type { Invoice } from "../shared/billing";
import type { InvoiceDelivery } from "../shared/invoice-output";
import type { Page } from "../shared/contracts";
import { request, errorMessage } from "./api";
import { useResource, formatDate } from "./Workspace";
import {
  Button,
  ConfirmationDialog,
  DeliveryStatus,
  Feedback,
  Loading,
  Pagination,
  deliveryStatusLabels,
} from "./ui";

export function InvoiceDeliveryPanel({ invoice }: { invoice: Invoice }) {
  const [page, setPage] = useState(1),
    [expanded, setExpanded] = useState(false);
  const deliveries = useResource<Page<InvoiceDelivery>>(
    `/api/invoices/${invoice.id}/deliveries?page=${page}&pageSize=10`,
  );
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<InvoiceDelivery | null>(null),
    [key, setKey] = useState(() => crypto.randomUUID());
  const pending = useRef(false);
  const current = invoice.currentInvoiceId === invoice.id;
  const canSend = invoice.status !== "Canceled" && current;
  const latest = result
    ? deliveries.data?.items.find((item) => item.id === result.id) || result
    : null;
  const notice = !latest
    ? ""
    : latest.status === "accepted"
      ? "The mail server accepted this message; inbox arrival is not verified here."
      : latest.status === "generated"
        ? "A message was generated / queued. This is not evidence of inbox delivery."
        : latest.status === "unknown"
          ? "Delivery is uncertain. Check the recipient’s inbox before deliberately sending another message."
          : latest.status === "failed"
            ? "Delivery failed. Review the recorded error before trying a new send."
            : "A mail handoff is in progress. Refresh activity to check its status.";
  async function send() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await request<InvoiceDelivery>(
        `/api/invoices/${invoice.id}/send`,
        { method: "POST", body: { idempotencyKey: key } },
      );
      setResult(next);
      setConfirm(false);
      setExpanded(true);
      setKey(crypto.randomUUID());
      setPage(1);
      deliveries.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="invoice-email" aria-label="Invoice email">
      <div className="invoice-email-heading">
        <div>
          <h2>Invoice email</h2>
          <p>Recipient · {invoice.customerEmail}</p>
        </div>
        <Button
          tone="secondary"
          disabled={!canSend}
          onClick={() => {
            setError("");
            setConfirm(true);
          }}
        >
          <Mail size={16} />
          Send invoice
        </Button>
      </div>
      {!canSend && (
        <p className="field-help">
          {current
            ? "A canceled invoice cannot be sent. Review its current replacement instead."
            : "This revision has been superseded. Open the current invoice to send it."}
        </p>
      )}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {latest
          ? `Invoice email: ${deliveryStatusLabels[latest.status]}. ${notice}`
          : ""}
      </p>
      {latest && (
        <div className="invoice-delivery-result">
          <DeliveryStatus status={latest.status} />
          <span>{notice}</span>
        </div>
      )}
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Email activity ({deliveries.data?.total || 0})</summary>
        <div className="section-heading">
          <p className="field-help">
            Queued is not delivered. SMTP acceptance does not confirm inbox
            arrival. Send and print never change settlement.
          </p>
          <Button
            tone="ghost"
            onClick={deliveries.reload}
            disabled={deliveries.busy}
          >
            <RefreshCw size={15} />
            Refresh activity
          </Button>
        </div>
        {deliveries.error ? (
          <Feedback tone="error">
            {deliveries.error}{" "}
            <button className="text-button" onClick={deliveries.reload}>
              Retry
            </button>
          </Feedback>
        ) : deliveries.busy && !deliveries.data ? (
          <Loading>Loading invoice email activity…</Loading>
        ) : !deliveries.data?.items.length ? (
          <p className="field-help">
            No messages have been generated for this invoice.
          </p>
        ) : (
          <ul className="invoice-deliveries">
            {deliveries.data.items.map((delivery) => (
              <li key={delivery.id}>
                <div>
                  <strong>{delivery.subject}</strong>
                  <span>
                    {delivery.recipient} ·{" "}
                    {formatDate(delivery.createdAt, true)}
                  </span>
                  {delivery.error && (
                    <p className="delivery-error">{delivery.error}</p>
                  )}
                </div>
                <DeliveryStatus status={delivery.status} />
              </li>
            ))}
          </ul>
        )}
        {(deliveries.data?.total || 0) > 10 && (
          <Pagination
            page={page}
            pageSize={deliveries.data?.pageSize || 10}
            total={deliveries.data?.total || 0}
            busy={deliveries.busy}
            onPage={setPage}
          />
        )}
      </details>
      <ConfirmationDialog
        open={confirm}
        title="Send this invoice?"
        description={`Generate an invoice email for ${invoice.customerName} at the saved address below. ${invoice.status === "Draft" ? "The document is explicitly marked Draft and is not collectible." : "This does not record a payment or change settlement."}`}
        confirmLabel="Send invoice"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void send()}
      >
        <dl className="confirmation-summary">
          <div>
            <dt>Invoice</dt>
            <dd>{invoice.number}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>{invoice.customerEmail}</dd>
          </div>
          <div>
            <dt>Document state</dt>
            <dd>{invoice.status}</dd>
          </div>
        </dl>
        <p className="footnote">
          The result distinguishes{" "}
          {deliveryStatusLabels.generated.toLowerCase()} from SMTP acceptance.
          Inbox receipt must be checked separately.
        </p>
        {error && (
          <p className="footnote">
            Cancel this review and refresh email activity to check whether a
            message was saved. Retrying this review keeps the same submission
            key.
          </p>
        )}
      </ConfirmationDialog>
    </section>
  );
}
