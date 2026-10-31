import { useEffect, useRef, useState } from "react";
import { ArrowRight, WandSparkles } from "lucide-react";
import {
  aiQuoteRequestSchema,
  type AiQuoteProposal,
  type AiQuoteStatus,
} from "../shared/ai-quote";
import { errorMessage, request } from "./api";
import { formatBusinessDate, useResource } from "./Workspace";
import { Button, Feedback, Loading, TextareaField } from "./ui";

/** Suggestions stay outside the saved commercial record until explicitly applied. */
export function QuoteAssist({
  customerId,
  appliedProposalId,
  onApply,
  onManual,
}: {
  customerId: string;
  appliedProposalId: string | null;
  onApply: (proposal: AiQuoteProposal) => Promise<void>;
  onManual: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = useResource<AiQuoteStatus>(
    open ? "/api/ai/quote-assist" : null,
  );
  const [description, setDescription] = useState("");
  const [proposal, setProposal] = useState<AiQuoteProposal | null>(null);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  const customer = useRef(customerId),
    disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    customer.current = customerId;
    controller.current?.abort();
    pending.current = false;
    setBusy(false);
    setProposal(null);
    setError("");
    setNotice("");
    return () => controller.current?.abort();
  }, [customerId]);
  async function suggest() {
    if (pending.current) return;
    const parsed = aiQuoteRequestSchema.safeParse({
      customerId,
      request: description,
    });
    setFieldError("");
    setError("");
    setNotice("");
    if (!parsed.success) {
      setFieldError(
        customerId
          ? "Describe the offering in 3–1,000 characters."
          : "Choose the customer above first.",
      );
      disclosure.current?.querySelector("textarea")?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setProposal(null);
    const forCustomer = customerId;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const next = await request<AiQuoteProposal>("/api/ai/quote-proposals", {
        method: "POST",
        body: parsed.data,
        signal: abort.signal,
      });
      if (!abort.signal.aborted && customer.current === forCustomer) {
        setProposal(next);
        setNotice(
          "Suggestion ready. Review the selections before applying them.",
        );
      }
    } catch (reason) {
      if (!abort.signal.aborted)
        setError(
          `${errorMessage(reason)} Your draft fields have not changed. Continue manually, or request another suggestion when ready.`,
        );
    } finally {
      if (controller.current === abort) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function apply() {
    if (!proposal || applying || proposal.customerId !== customerId) return;
    setApplying(true);
    setError("");
    try {
      await onApply(proposal);
      if (customer.current === proposal.customerId)
        setNotice(
          "Suggested selections applied. Review the calculated estimate, then save the draft yourself.",
        );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setApplying(false);
    }
  }
  const fields = proposal?.proposal;
  const hasSelections =
    fields &&
    (fields.plan_id ||
      fields.template_id ||
      fields.lines.length ||
      fields.requested_start_date);
  return (
    <details
      className="quote-assist"
      ref={disclosure}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <WandSparkles size={16} />
        <span>Help choose an offering</span>
        <small>Optional AI · review required</small>
      </summary>
      <p className="field-help">
        Describe the offering, then review a catalog suggestion. Nothing is
        saved or sent to the customer.
      </p>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {busy ? "Preparing an offering suggestion." : notice}
      </p>
      {status.busy ? (
        <Loading>Checking optional assist…</Loading>
      ) : status.error ? (
        <Feedback>
          {status.error} Manual entry remains available.{" "}
          <button type="button" className="text-button" onClick={status.reload}>
            Check again
          </button>
        </Feedback>
      ) : status.data && !status.data.enabled ? (
        <Feedback>
          {status.data.reason || "Optional assist is turned off."} Continue with
          the fields below.
        </Feedback>
      ) : (
        status.data && (
          <>
            <p className="field-help">{status.data.disclosure}</p>
            <p className="field-help">
              Suggestions cover a limited selection of the active catalog.
              Choose other offerings directly in the form.
            </p>
            {!customerId && (
              <Feedback>
                Choose the customer above before requesting a suggestion.
              </Feedback>
            )}
            <TextareaField
              name="offeringRequest"
              label="Describe the offering"
              value={description}
              maxLength={1000}
              disabled={busy}
              error={fieldError}
              help="Include only products, quantities, cadence and a start date. Leave out names, emails, payment details and other private information."
              onChange={(event) => {
                setDescription(event.target.value);
                setFieldError("");
              }}
            />
            <Button
              type="button"
              tone="secondary"
              busy={busy}
              disabled={!customerId || applying}
              onClick={() => void suggest()}
            >
              <WandSparkles size={16} />
              Suggest selections
            </Button>
          </>
        )
      )}
      {error && <Feedback tone="error">{error}</Feedback>}
      {proposal && fields && (
        <section className="quote-suggestion" aria-label="Suggested offering">
          <h3>Suggested selections</h3>
          <dl>
            <div>
              <dt>Plan</dt>
              <dd>
                {proposal.labels.plans.find(
                  (plan) => plan.id === fields.plan_id,
                )?.name || "Choose a plan in the form"}
              </dd>
            </div>
            {fields.template_id && (
              <div>
                <dt>Template</dt>
                <dd>
                  {proposal.labels.templates.find(
                    (template) => template.id === fields.template_id,
                  )?.name || "Choose a template in the form"}
                </dd>
              </div>
            )}
            <div>
              <dt>Start date</dt>
              <dd>
                {fields.requested_start_date
                  ? formatBusinessDate(fields.requested_start_date)
                  : "Keep the date entered below"}
              </dd>
            </div>
          </dl>
          {!!fields.lines.length && (
            <ul>
              {fields.lines.map((line, index) => {
                const product = proposal.labels.products.find(
                  (product) => product.id === line.product_id,
                );
                const variant = product?.variants.find(
                  (variant) => variant.id === line.variant_id,
                );
                return (
                  <li key={index}>
                    <strong>
                      {line.quantity} ×{" "}
                      {product?.name || "Catalog selection unavailable"}
                    </strong>
                    {variant && <span>{variant.name}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {!!fields.clarifications.length && (
            <div className="quote-clarifications">
              <h4>Check before continuing</h4>
              <ul>
                {fields.clarifications.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="field-help">
            Applying replaces the offering and product lines, and uses an
            explicitly suggested start date. Prices are calculated from the
            catalog. Term length and payment terms stay as entered.
          </p>
          {fields.template_id && !fields.lines.length && (
            <p className="field-help">
              The template’s saved product lines will be copied into the form.
              Review them with the calculated estimate before saving.
            </p>
          )}
          {hasSelections ? (
            <Button
              type="button"
              busy={applying}
              disabled={busy || appliedProposalId === proposal.id}
              onClick={() => void apply()}
            >
              Apply suggested fields
              <ArrowRight size={16} />
            </Button>
          ) : (
            <p className="field-help">
              No selections are ready to apply. Answer the questions above and
              continue with the ordinary fields.
            </p>
          )}
        </section>
      )}
      {appliedProposalId && (
        <div className="quote-assist-applied">
          <p className="field-help">
            Suggestion applied. The normal estimate and your review control the
            draft.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onManual();
              setProposal(null);
              setNotice(
                "Keeping these fields for manual entry. Nothing has been saved.",
              );
            }}
          >
            Continue with these fields manually
          </button>
        </div>
      )}
    </details>
  );
}
