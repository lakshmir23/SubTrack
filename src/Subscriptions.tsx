import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  Check,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { Page, User, WorkspaceSummary } from "../shared/contracts";
import type { Plan, QuotationTemplate } from "../shared/catalog";
import {
  subscriptionCreateSchema,
  subscriptionPreviewSchema,
  subscriptionStages,
  subscriptionUpdateSchema,
  type Subscription,
  type SubscriptionAction,
  type SubscriptionCommercialInput,
  type SubscriptionPreview,
  type SubscriptionProcessDueResult,
  type SubscriptionStage,
  type SubscriptionSummary,
  type SubscriptionTerms,
} from "../shared/subscriptions";
import { formatMoney } from "../shared/money";
import { errorMessage, request } from "./api";
import { applyServerErrors, validateForm } from "./Auth";
import {
  AmountBreakdown,
  LineEditor,
  RecordSelect,
  lineInputs,
  whole,
  type AmountBreakdownData,
  type LineForm,
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
  ConfirmationDialog,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PageHeading,
  Pagination,
  SearchField,
  SelectField,
  useUnsavedChanges,
} from "./ui";

function termsBreakdown(terms: SubscriptionTerms): AmountBreakdownData {
  return {
    lines: terms.lines.map((line) => ({
      ...line,
      taxId: null,
      taxName: null,
      taxRateBps: line.estimatedTaxRateBps,
      tax: line.estimatedTax,
      total: line.estimatedTotal,
    })),
    subtotal: terms.subtotal,
    tax: terms.estimatedTax,
    total: terms.estimatedTotal,
    priceExplanation: terms.priceExplanation,
  };
}
function stageTone(stage: SubscriptionStage) {
  return stage === "Active"
    ? "success"
    : stage === "Quotation"
      ? "warning"
      : "info";
}
function serviceLabel(
  subscription: SubscriptionSummary,
  businessDate?: string,
) {
  if (subscription.stage === "Draft" || subscription.stage === "Quotation")
    return "Service not started";
  if (subscription.stage === "Confirmed")
    return businessDate && subscription.expiryDate <= businessDate
      ? "Term ended before activation"
      : businessDate && subscription.startDate > businessDate
        ? `Starts ${formatBusinessDate(subscription.startDate)}`
        : "Awaiting activation";
  if (subscription.stage === "Closed") return "Closed";
  if (businessDate && subscription.expiryDate <= businessDate)
    return "Term ended";
  return subscription.serviceState === "TermEnded"
    ? "Term ended"
    : subscription.serviceState;
}
function StageStrip({ stage }: { stage: SubscriptionStage }) {
  const current = subscriptionStages.indexOf(stage);
  return (
    <ol className="stage-strip" aria-label="Subscription stages">
      {subscriptionStages.map((item, index) => (
        <li
          key={item}
          className={
            index === current ? "current" : index < current ? "complete" : ""
          }
          aria-current={index === current ? "step" : undefined}
        >
          <span className="stage-marker" aria-hidden="true">
            {index < current ? <Check size={14} /> : <span />}
          </span>
          <span>{item}</span>
          {index === current && (
            <span className="sr-only">, current stage</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function SubscriptionList() {
  const { user } = useSession();
  const customer = user?.role === "customer";
  const query = useListQuery();
  const [params, setParams] = useSearchParams();
  const stage = params.get("stage") || "";
  const customerId = customer ? "" : params.get("customerId") || "";
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const directory = useResource<Page<SubscriptionSummary>>(
    `/api/subscriptions?q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20${stage ? `&stage=${encodeURIComponent(stage)}` : ""}${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}`,
  );
  const clock = useResource<WorkspaceSummary>("/api/workspace");
  const [confirmDue, setConfirmDue] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState("");
  const [result, setResult] = useState<SubscriptionProcessDueResult | null>(
    null,
  );
  const pending = useRef(false);
  useEffect(() => {
    document.title = `${customer ? "Your subscriptions" : "Subscriptions"} · SubTrack`;
  }, [customer]);
  useEffect(() => {
    if (directory.data && directory.data.page !== query.page)
      query.setPage(directory.data.page);
  }, [directory.data, query.page]);
  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      return next;
    });
  }
  async function processDue() {
    if (pending.current) return;
    pending.current = true;
    setProcessing(true);
    setProcessError("");
    try {
      const next = await request<SubscriptionProcessDueResult>(
        "/api/subscriptions/process-due",
        { method: "POST", body: { limit: 100 } },
      );
      setResult(next);
      setConfirmDue(false);
      directory.reload();
    } catch (reason) {
      setProcessError(errorMessage(reason));
    } finally {
      pending.current = false;
      setProcessing(false);
    }
  }
  const message = (location.state as { message?: string } | null)?.message;
  return (
    <>
      <PageHeading
        title={customer ? "Your subscriptions" : "Subscriptions"}
        description={
          customer
            ? "The agreements registered to your own Brightloop account."
            : "Prepare quotations, record agreements and see where each subscription stands."
        }
        action={
          !customer && (
            <div className="heading-actions">
              <Button
                tone="secondary"
                onClick={() => {
                  setProcessError("");
                  setConfirmDue(true);
                }}
              >
                <CalendarCheck2 size={17} />
                Activate due agreements
              </Button>
              <Link className="button" to="/subscriptions/new">
                <Plus size={17} />
                New subscription
              </Link>
            </div>
          )
        }
      />
      {message && <Feedback tone="success">{message}</Feedback>}
      {result && (
        <section className="batch-summary" aria-label="Activation results">
          <Feedback
            tone={result.failed ? "error" : result.blocked ? "info" : "success"}
          >
            {result.activated} activated · {result.alreadyActive} already active
            · {result.blocked} blocked · {result.failed} failed ·{" "}
            {result.remaining} still due.
          </Feedback>
          {result.items.length ? (
            <ul className="outcome-list">
              {result.items.map((item, index) => (
                <li key={`${item.id}-${index}`}>
                  <Link to={`/subscriptions/${item.id}`}>{item.number}</Link>
                  <span
                    className={`status ${item.outcome === "failed" ? "danger" : item.outcome === "blocked" ? "warning" : "success"}`}
                  >
                    {item.outcome === "alreadyActive"
                      ? "Already active"
                      : item.outcome}
                  </span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No agreements were eligible to activate in this run.
            </p>
          )}
          {result.remaining > 0 && (
            <p className="footnote">
              The run checks up to 100 due agreements. Run it again to continue
              the remaining queue.
            </p>
          )}
        </section>
      )}
      <section className="list-panel" aria-label="Subscription records">
        <div className="list-toolbar subscription-filters">
          <SearchField
            label="Search subscriptions"
            placeholder="Search number, customer or plan"
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <div className="filter-control">
            <SelectField
              label="Stage"
              value={stage}
              onChange={(event) => filter("stage", event.target.value)}
            >
              <option value="">All stages</option>
              {subscriptionStages.map((value) => (
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
                label="Customer"
                name="customerFilter"
                emptyLabel="All customers"
                value={customerId}
                onChange={(id) => filter("customerId", id)}
              />
            </div>
          )}
        </div>
        <div className="table-region" aria-busy={directory.busy}>
          {directory.error ? (
            <div className="list-error">
              <Feedback tone="error">{directory.error}</Feedback>
              <Button tone="secondary" onClick={directory.reload}>
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : directory.busy ? (
            <Loading>Loading subscriptions…</Loading>
          ) : !directory.data?.items.length ? (
            <EmptyState
              icon={<FileText size={28} />}
              title={
                query.query || stage || customerId
                  ? "No matching subscriptions."
                  : customer
                    ? "Your agreements will appear here."
                    : "Your first agreement starts here."
              }
              action={
                query.query || stage || customerId ? (
                  <Button tone="secondary" onClick={() => setParams({})}>
                    Clear filters
                  </Button>
                ) : !customer ? (
                  <Link className="button" to="/subscriptions/new">
                    <Plus size={17} />
                    New subscription
                  </Link>
                ) : undefined
              }
            >
              {query.query || stage || customerId
                ? "Try another search or clear the active filters."
                : customer
                  ? "Brightloop staff will prepare your agreement. Only records linked to your account are shown."
                  : "Create a draft from an existing template or plan, then review its terms before issuing a quotation."}
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">
                {customer ? "Your" : "All authorized"} subscriptions, page{" "}
                {query.page}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Subscription</th>
                  {!customer && <th scope="col">Customer</th>}
                  <th scope="col">Plan</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Service term</th>
                  <th scope="col">Estimated period total</th>
                </tr>
              </thead>
              <tbody>
                {directory.data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Subscription">
                      <Link
                        className="record-link"
                        to={`/subscriptions/${item.id}`}
                        state={{ returnTo }}
                      >
                        {item.number}
                        <ChevronRight size={14} />
                      </Link>
                      <small className="row-secondary">
                        {serviceLabel(item, clock.data?.businessDate)}
                      </small>
                    </td>
                    {!customer && (
                      <td data-label="Customer">
                        <strong>{item.customerName}</strong>
                        <small className="row-secondary">
                          {item.customerEmail}
                        </small>
                      </td>
                    )}
                    <td data-label="Plan">{item.planName}</td>
                    <td data-label="Stage">
                      <span className={`status ${stageTone(item.stage)}`}>
                        {item.stage}
                      </span>
                    </td>
                    <td
                      data-label="Service term"
                      className="subscription-dates"
                    >
                      {formatBusinessDate(item.startDate)}
                      <small className="row-secondary">
                        to {formatBusinessDate(item.expiryDate)} (exclusive)
                      </small>
                    </td>
                    <td
                      data-label="Estimated period total"
                      className="money-cell"
                    >
                      {formatMoney(item.estimatedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination
          page={query.page}
          pageSize={directory.data?.pageSize || 20}
          total={directory.data?.total || 0}
          onPage={query.setPage}
          busy={directory.busy}
        />
      </section>
      {!customer && clock.data && (
        <p className="footnote">
          Server business date: {formatBusinessDate(clock.data.businessDate)} ·
          Asia/Kolkata. Activation follows service dates; this operation does
          not create invoices.
        </p>
      )}
      <ConfirmationDialog
        open={confirmDue}
        title="Activate due agreements?"
        description="Check up to 100 confirmed agreements against the server’s business date. Eligible agreements become Active; future agreements remain Confirmed."
        confirmLabel="Activate due agreements"
        busy={processing}
        error={processError}
        onCancel={() => setConfirmDue(false)}
        onConfirm={() => void processDue()}
      />
    </>
  );
}

interface DraftFormValues {
  customerId: string;
  planId: string;
  templateId: string | null;
  startDate: string;
  termPeriods: string;
  paymentTermDays: string;
  validDays: string;
  lines: LineForm[];
}
function commercialValues(
  values: DraftFormValues,
): SubscriptionCommercialInput {
  return {
    customerId: values.customerId,
    planId: values.planId,
    templateId: values.templateId,
    startDate: values.startDate,
    termPeriods: whole(values.termPeriods, "termPeriods"),
    paymentTermDays: whole(values.paymentTermDays, "paymentTermDays"),
    validDays: whole(values.validDays, "validDays"),
    lines: lineInputs(values.lines),
  };
}
function draftValues(subscription: Subscription): DraftFormValues {
  return {
    customerId: subscription.customerId,
    planId: subscription.planId,
    templateId: subscription.templateId,
    startDate: subscription.startDate,
    termPeriods: String(subscription.termPeriods),
    paymentTermDays: String(subscription.paymentTermDays),
    validDays: String(subscription.validDays),
    lines: subscription.terms.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: String(line.quantity),
    })),
  };
}
export function SubscriptionEditorRoute() {
  const { id } = useParams();
  return <SubscriptionEditor key={id || "new"} id={id} />;
}
function SubscriptionEditor({ id }: { id?: string }) {
  const navigate = useNavigate(),
    location = useLocation();
  const [params] = useSearchParams();
  const [initialTemplateId] = useState(() =>
    !id ? params.get("templateId") : null,
  );
  const [source, setSource] = useState<"plan" | "template">(
    initialTemplateId ? "template" : "plan",
  );
  const initial: DraftFormValues = {
    customerId: "",
    planId: "",
    templateId: initialTemplateId,
    startDate: "",
    termPeriods: "1",
    paymentTermDays: "7",
    validDays: "7",
    lines: [],
  };
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [version, setVersion] = useState<number | null>(null);
  const loaded = useResource<Subscription>(
    id ? `/api/subscriptions/${id}` : null,
  );
  const initialTemplate = useResource<QuotationTemplate>(
    initialTemplateId ? `/api/quotation-templates/${initialTemplateId}` : null,
  );
  const initializedTemplate = useRef(false);
  const clock = useResource<WorkspaceSummary>(!id ? "/api/workspace" : null);
  const plan = useResource<Plan>(
    values.planId ? `/api/plans/${values.planId}` : null,
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const guard = useUnsavedChanges(JSON.stringify(values) !== baseline);
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  useEffect(() => {
    document.title = `${id ? "Edit draft" : "New subscription"} · SubTrack`;
  }, [id]);
  useEffect(() => {
    if (loaded.data && version === null) {
      const next = draftValues(loaded.data);
      setValues(next);
      setBaseline(JSON.stringify(next));
      setSource(loaded.data.templateId ? "template" : "plan");
      setVersion(loaded.data.version);
    }
  }, [loaded.data, version]);
  useEffect(() => {
    if (!id && clock.data) {
      const date = clock.data.businessDate;
      setValues((current) =>
        current.startDate ? current : { ...current, startDate: date },
      );
      setBaseline((current) => {
        const next = JSON.parse(current) as DraftFormValues;
        if (!next.startDate) next.startDate = date;
        return JSON.stringify(next);
      });
    }
  }, [clock.data, id]);
  useEffect(() => {
    if (!id && initialTemplate.data && !initializedTemplate.current) {
      initializedTemplate.current = true;
      const template = initialTemplate.data;
      const offering = {
        planId: template.planId,
        templateId: template.id,
        validDays: String(template.validDays),
        lines: template.lines.map((line) => ({
          ...line,
          quantity: String(line.quantity),
        })),
      };
      setValues((current) =>
        current.templateId === template.id
          ? { ...current, ...offering }
          : current,
      );
      setBaseline((current) =>
        JSON.stringify({
          ...(JSON.parse(current) as DraftFormValues),
          ...offering,
        }),
      );
    }
  }, [initialTemplate.data, id]);
  let serialized = "";
  const candidate = commercialValues(values);
  if (subscriptionPreviewSchema.safeParse(candidate).success)
    serialized = JSON.stringify(candidate);
  useEffect(() => {
    setPreview(null);
    setPreviewError("");
    setPreviewStatus("");
    if (!serialized || (id && version === null)) {
      setPreviewBusy(false);
      return;
    }
    const controller = new AbortController();
    setPreviewBusy(true);
    setPreviewStatus("Updating the draft estimate.");
    const timer = window.setTimeout(() => {
      request<SubscriptionPreview>("/api/subscriptions/preview", {
        method: "POST",
        body: JSON.parse(serialized),
        signal: controller.signal,
      })
        .then((next) => {
          if (!controller.signal.aborted) {
            setPreview(next);
            setPreviewStatus(
              `Draft estimate updated. Estimated period total ${formatMoney(next.terms.estimatedTotal)}. Exclusive expiry ${formatBusinessDate(next.expiryDate)}.`,
            );
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setPreviewError(errorMessage(reason));
            setPreviewStatus("");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serialized, previewRevision, id, version]);
  const stateReturn = (location.state as { returnTo?: string } | null)
    ?.returnTo;
  const back =
    stateReturn?.startsWith("/subscriptions") &&
    !stateReturn.includes("/edit") &&
    !stateReturn.includes("/new")
      ? stateReturn
      : id
        ? `/subscriptions/${id}`
        : "/subscriptions";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    if (source === "template" && !values.templateId) {
      setFields({ templateId: "Choose a quotation template." });
      form.querySelector<HTMLSelectElement>('[name="templateId"]')?.focus();
      return;
    }
    const body = id
      ? { ...commercialValues(values), version }
      : { ...commercialValues(values), idempotencyKey };
    const invalid = validateForm(
      id ? subscriptionUpdateSchema : subscriptionCreateSchema,
      body,
      form,
    );
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setSaving(true);
    try {
      const saved = await request<Subscription>(
        `/api/subscriptions${id ? `/${id}` : ""}`,
        { method: id ? "PUT" : "POST", body },
      );
      guard.allowNavigation();
      navigate(`/subscriptions/${saved.id}`, {
        replace: !id,
        state: {
          returnTo: "/subscriptions",
          message: id
            ? "Draft updated. Review the saved terms before issuing the quotation."
            : "Draft saved. Review its terms before issuing a quotation.",
        },
      });
    } catch (reason) {
      setError(errorMessage(reason));
      applyServerErrors(reason, form, setFields);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  if (id && loaded.error)
    return (
      <>
        <PageHeading title="The draft couldn’t load." />
        <Feedback tone="error">{loaded.error}</Feedback>
        <Button tone="secondary" onClick={loaded.reload}>
          <RefreshCw />
          Retry
        </Button>
      </>
    );
  if (id && (loaded.busy || version === null))
    return <Loading>Loading the saved draft…</Loading>;
  if (id && loaded.data && !loaded.data.allowedActions.includes("edit"))
    return (
      <>
        <PageHeading
          title="This agreement is read-only."
          description="Commercial editing is available only while an agreement is Draft."
        />
        <Link className="button" to={`/subscriptions/${id}`}>
          View agreement
          <ArrowRight size={17} />
        </Link>
      </>
    );
  return (
    <>
      <Link className="back-link" to={back}>
        <ArrowLeft size={16} />
        Back to {id ? "agreement" : "subscriptions"}
      </Link>
      <PageHeading
        title={id ? `Edit ${loaded.data?.number}` : "New subscription"}
        autoFocus
        description="Choose a customer and offering. The server calculates the term boundary and current commercial estimate."
      />
      {error && (
        <Feedback tone="error">
          {error}{" "}
          <Link
            to={
              id
                ? `/subscriptions/${id}`
                : `/subscriptions${values.customerId ? `?customerId=${encodeURIComponent(values.customerId)}` : ""}`
            }
          >
            Check the saved records
          </Link>{" "}
          before retrying an uncertain request.
        </Feedback>
      )}
      {initialTemplate.error && (
        <Feedback tone="error">
          {initialTemplate.error} Choose another template or use a plan.
        </Feedback>
      )}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {previewStatus}
      </div>
      <div className="subscription-editor-layout">
        <form
          className="panel catalog-editor subscription-editor"
          noValidate
          aria-label={id ? "Edit subscription draft" : "New subscription draft"}
          onSubmit={save}
        >
          <fieldset className="editor-section first-section">
            <legend>Customer and offering</legend>
            <RecordSelect<User>
              resource="customers"
              name="customerId"
              label="Customer"
              value={values.customerId}
              selectedLabel={loaded.data?.customerName}
              error={fields.customerId}
              onChange={(customerId) => setValues({ ...values, customerId })}
            />
            <SelectField
              label="Offering source"
              value={source}
              onChange={(event) => {
                const next = event.target.value as "plan" | "template";
                setSource(next);
                setValues({
                  ...values,
                  templateId: null,
                  planId: "",
                  lines: [],
                });
              }}
              help="Changing the offering replaces its product lines."
            >
              <option value="plan">Start from a recurring plan</option>
              <option value="template">Copy a quotation template</option>
            </SelectField>
            {source === "template" && (
              <RecordSelect<QuotationTemplate>
                resource="quotation-templates"
                name="templateId"
                label="Quotation template"
                value={values.templateId || ""}
                selectedLabel={loaded.data?.templateName || undefined}
                error={fields.templateId}
                onChange={(templateId, record) =>
                  setValues({
                    ...values,
                    templateId: templateId || null,
                    planId: record?.planId || "",
                    validDays: record ? String(record.validDays) : "7",
                    lines:
                      record?.lines.map((line) => ({
                        ...line,
                        quantity: String(line.quantity),
                      })) || [],
                  })
                }
              />
            )}
            <RecordSelect<Plan>
              resource="plans"
              name="planId"
              label="Recurring plan"
              value={values.planId}
              selectedLabel={loaded.data?.planName}
              error={fields.planId}
              disabled={source === "template"}
              help={
                source === "template"
                  ? "The plan is copied from the selected template."
                  : undefined
              }
              onChange={(planId, record) =>
                setValues({
                  ...values,
                  planId,
                  templateId: null,
                  lines: record
                    ? [
                        {
                          productId: record.primaryProductId,
                          variantId: null,
                          quantity: String(record.minQuantity),
                        },
                      ]
                    : [],
                })
              }
            />
          </fieldset>
          <fieldset className="editor-section">
            <legend>Dates and terms</legend>
            <div className="field-pair">
              <Field
                name="startDate"
                label="Service start date"
                type="date"
                value={values.startDate}
                error={fields.startDate}
                onChange={(event) =>
                  setValues({ ...values, startDate: event.target.value })
                }
              />
              <Field
                name="termPeriods"
                label="Term length (billing periods)"
                inputMode="numeric"
                value={values.termPeriods}
                error={fields.termPeriods}
                help={
                  plan.data
                    ? `Whole ${plan.data.interval} periods from the original start date.`
                    : "Expiry is calculated from whole calendar periods."
                }
                onChange={(event) =>
                  setValues({ ...values, termPeriods: event.target.value })
                }
              />
            </div>
            <div className="field-pair">
              <Field
                name="paymentTermDays"
                label="Payment terms (days)"
                inputMode="numeric"
                value={values.paymentTermDays}
                error={fields.paymentTermDays}
                help="Due date is this many days after invoice issue."
                onChange={(event) =>
                  setValues({ ...values, paymentTermDays: event.target.value })
                }
              />
              <Field
                name="validDays"
                label="Quotation validity (days)"
                inputMode="numeric"
                value={values.validDays}
                error={fields.validDays}
                help="Counted from the date the quotation is issued."
                onChange={(event) =>
                  setValues({ ...values, validDays: event.target.value })
                }
              />
            </div>
          </fieldset>
          <LineEditor
            lines={values.lines}
            primaryProductId={plan.data?.primaryProductId}
            fields={fields}
            onChange={(lines) => setValues({ ...values, lines })}
          />
          <div className="form-actions">
            <Link className="button secondary" to={back}>
              Cancel
            </Link>
            <Button type="submit" busy={saving}>
              {id ? "Save draft changes" : "Save draft"}
            </Button>
          </div>
          <p className="footnote">
            A draft is editable. Issuing the quotation freezes its offered
            prices and plan policies for the quotation’s validity.
          </p>
        </form>
        <section
          className="panel calculation-panel"
          aria-labelledby="draft-estimate-title"
        >
          <div className="estimate-heading">
            <h2 id="draft-estimate-title">Estimate per billing period</h2>
            <Button
              tone="ghost"
              onClick={() => setPreviewRevision((value) => value + 1)}
              disabled={!serialized || previewBusy}
              aria-label="Refresh draft estimate"
            >
              <RefreshCw size={17} />
            </Button>
          </div>
          {previewError ? (
            <Feedback tone="error">{previewError}</Feedback>
          ) : previewBusy ? (
            <div aria-hidden="true">
              <Loading>Calculating dates and prices…</Loading>
            </div>
          ) : !preview ? (
            <EmptyState
              icon={<FileText size={26} />}
              title="Start with the agreement details."
            >
              Choose the customer, plan and valid product quantities to see the
              current estimate.
            </EmptyState>
          ) : (
            <>
              <div className="preview-customer">
                <strong>{preview.customerName}</strong>
                <span>{preview.customerEmail}</span>
              </div>
              <dl className="term-preview">
                <div>
                  <dt>Service starts</dt>
                  <dd>{formatBusinessDate(preview.startDate)}</dd>
                </div>
                <div>
                  <dt>Exclusive expiry</dt>
                  <dd>{formatBusinessDate(preview.expiryDate)}</dd>
                </div>
                <div>
                  <dt>Payment terms</dt>
                  <dd>{preview.paymentTermDays} days</dd>
                </div>
              </dl>
              <AmountBreakdown
                value={termsBreakdown(preview.terms)}
                estimated
                periodLabel={preview.terms.plan.interval}
                note="Current draft estimate. Tax and discount eligibility are finalized when invoices are generated; saving the draft recalculates current catalog prices."
              />
            </>
          )}
        </section>
      </div>
      {guard.confirm}
    </>
  );
}

type Transition = Exclude<SubscriptionAction, "edit">;
const actionLabels: Record<Transition, string> = {
  issue: "Issue quotation",
  confirm: "Confirm agreement",
  activate: "Activate subscription",
};
export function SubscriptionDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const location = useLocation();
  const resource = useResource<Subscription>(`/api/subscriptions/${id}`);
  const [action, setAction] = useState<Transition | null>(null);
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [success, setSuccess] = useState("");
  const pending = useRef(false);
  const data = resource.data;
  useEffect(() => {
    document.title = `${data?.number || "Subscription"} · SubTrack`;
  }, [data?.number]);
  async function transition() {
    if (!data || !action || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError("");
    try {
      const changed = await request<Subscription>(
        `/api/subscriptions/${data.id}/${action}`,
        { method: "POST", body: { version: data.version } },
      );
      setSuccess(`${changed.number} is now ${changed.stage}.`);
      setAction(null);
      resource.reload();
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (resource.busy) return <Loading>Loading the agreement…</Loading>;
  if (resource.error || !data)
    return (
      <>
        <PageHeading title="This subscription couldn’t load." />
        <Feedback tone="error">
          {resource.error || "The record is unavailable."}
        </Feedback>
        <Link className="button secondary" to="/subscriptions">
          Back to subscriptions
        </Link>
        <Button tone="secondary" onClick={resource.reload}>
          <RefreshCw />
          Retry
        </Button>
      </>
    );
  const customer = user?.role === "customer";
  const primary = !customer
    ? (["issue", "confirm", "activate"] as const).find((item) =>
        data.allowedActions.includes(item),
      )
    : undefined;
  const terms = data.acceptedTerms || data.offeredTerms || data.terms;
  const stageDescription =
    data.stage === "Draft"
      ? "Draft prices are editable; issuing freezes the offered commercial terms."
      : data.stage === "Quotation"
        ? `Issued ${data.issuedDate ? formatBusinessDate(data.issuedDate) : ""}. Valid through ${data.validUntil ? formatBusinessDate(data.validUntil) : ""}, inclusive.`
        : data.acceptedAt
          ? `Agreement recorded ${formatDate(data.acceptedAt, true)}.`
          : "The saved agreement and its commercial history.";
  const pricingTitle = data.acceptedTerms
    ? "Accepted prices"
    : data.offeredTerms
      ? "Offered prices"
      : "Draft prices";
  const back = (location.state as { returnTo?: string } | null)?.returnTo;
  const message = (location.state as { message?: string } | null)?.message;
  return (
    <>
      <Link
        className="back-link"
        to={back?.startsWith("/subscriptions") ? back : "/subscriptions"}
      >
        <ArrowLeft size={16} />
        Back to subscriptions
      </Link>
      <PageHeading
        title={data.number}
        autoFocus
        description={`${data.customerName} · ${data.planName}`}
        action={
          <div className="heading-actions">
            <Button
              tone="secondary"
              onClick={resource.reload}
              aria-label="Refresh agreement"
            >
              <RefreshCw size={17} />
            </Button>
            {!customer && data.allowedActions.includes("edit") && (
              <Link
                className="button secondary"
                to={`/subscriptions/${data.id}/edit`}
                state={{ returnTo: `/subscriptions/${data.id}` }}
              >
                <Pencil size={16} />
                Edit draft
              </Link>
            )}
            {primary && (
              <Button
                onClick={() => {
                  setActionError("");
                  setAction(primary);
                }}
              >
                <span className="button-icon">
                  {primary === "issue" ? (
                    <FileText size={16} />
                  ) : primary === "confirm" ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <CalendarCheck2 size={16} />
                  )}
                </span>
                {actionLabels[primary]}
              </Button>
            )}
          </div>
        }
      />
      {(success || message) && (
        <Feedback tone="success">{success || message}</Feedback>
      )}
      <StageStrip stage={data.stage} />
      <div className="agreement-context">
        <span className={`status ${stageTone(data.stage)}`}>{data.stage}</span>
        <strong>{serviceLabel(data, data.businessDate)}</strong>
        <span>{stageDescription}</span>
      </div>
      {data.stage === "Quotation" &&
        data.validUntil &&
        data.validUntil < data.businessDate && (
          <Feedback>
            This quotation expired on {formatBusinessDate(data.validUntil)}.{" "}
            {!customer && (
              <Link
                to={`/subscriptions/new${data.templateId ? `?templateId=${data.templateId}` : ""}`}
              >
                Create a new draft with current terms.
              </Link>
            )}
          </Feedback>
        )}
      {data.stage === "Confirmed" && data.activationBlockedReason && (
        <Feedback>
          {data.activationBlockedReason} Server business date:{" "}
          {formatBusinessDate(data.businessDate)} · Asia/Kolkata.
        </Feedback>
      )}
      <div className="agreement-layout">
        <div>
          <section
            className="panel agreement-terms"
            aria-labelledby="agreement-terms-title"
          >
            <h2 id="agreement-terms-title">Agreement details</h2>
            <dl className="catalog-detail-grid">
              <div>
                <dt>Customer</dt>
                <dd>
                  {data.customerName}
                  <small>{data.customerEmail}</small>
                </dd>
              </div>
              <div>
                <dt>Recurring plan</dt>
                <dd>{data.planName}</dd>
              </div>
              <div>
                <dt>Service start</dt>
                <dd>{formatBusinessDate(data.startDate)}</dd>
              </div>
              <div>
                <dt>Expiry (exclusive)</dt>
                <dd>{formatBusinessDate(data.expiryDate)}</dd>
              </div>
              <div>
                <dt>Term length</dt>
                <dd>
                  {data.termPeriods} {terms.plan.interval}{" "}
                  {data.termPeriods === 1 ? "period" : "periods"}
                </dd>
              </div>
              <div>
                <dt>Payment terms</dt>
                <dd>{data.paymentTermDays} days after invoice issue</dd>
              </div>
              {data.templateName && (
                <div>
                  <dt>Quotation template</dt>
                  <dd>{data.templateName}</dd>
                </div>
              )}
              <div>
                <dt>Quotation validity</dt>
                <dd>{data.validDays} days from issue</dd>
              </div>
              {data.validUntil && (
                <div>
                  <dt>Valid through</dt>
                  <dd>{formatBusinessDate(data.validUntil)}</dd>
                </div>
              )}
            </dl>
            <p className="footnote">
              Service includes its start date and excludes the expiry boundary.
              Payment is recorded separately from service activation.
            </p>
          </section>
          <section
            className="panel agreement-history"
            aria-labelledby="history-title"
          >
            <h2 id="history-title">Activity</h2>
            <ol>
              {data.history.map((event) => (
                <li key={event.id}>
                  <span className="history-dot" aria-hidden="true" />
                  <div>
                    <strong>{event.message}</strong>
                    <p>
                      {event.actorName} · {formatDate(event.at, true)}
                    </p>
                    {event.fromStage && event.fromStage !== event.toStage && (
                      <small>
                        {event.fromStage} <ArrowRight size={12} />{" "}
                        {event.toStage}
                      </small>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <section
          className="panel calculation-panel"
          aria-labelledby="agreement-pricing-title"
        >
          <div className="estimate-heading">
            <h2 id="agreement-pricing-title">{pricingTitle}</h2>
            <span className="status info">INR</span>
          </div>
          <AmountBreakdown
            value={termsBreakdown(terms)}
            estimated
            periodLabel={terms.plan.interval}
            note={
              data.acceptedTerms
                ? "Accepted commercial prices are preserved. Tax and discounts are evaluated when each invoice is generated."
                : data.offeredTerms
                  ? "Commercial prices and plan policies were frozen when this quotation was issued. Tax is an estimate until billing."
                  : "Prices were calculated when this draft was last saved. Editing and saving refreshes the catalog estimate."
            }
          />
        </section>
      </div>
      <ConfirmationDialog
        open={!!action}
        title={action ? `${actionLabels[action]}?` : "Review agreement"}
        description={
          action === "issue"
            ? `Issue ${data.number} for ${data.customerName}. This freezes the displayed commercial prices and plan policies for ${data.validDays} calendar days.`
            : action === "confirm"
              ? `Record the agreement for ${data.customerName} at the issued prices shown here. Current product and plan availability will be checked.`
              : `Start service for ${data.number} under the accepted terms, using the server’s business date.`
        }
        confirmLabel={action ? actionLabels[action] : "Continue"}
        busy={busy}
        error={actionError}
        onCancel={() => setAction(null)}
        onConfirm={() => void transition()}
      >
        <dl className="confirmation-summary">
          <div>
            <dt>Subscription</dt>
            <dd>{data.number}</dd>
          </div>
          <div>
            <dt>Estimated period total</dt>
            <dd>{formatMoney(terms.estimatedTotal)}</dd>
          </div>
        </dl>
        {actionError && (
          <p className="footnote">
            Cancel and refresh the saved agreement to check its state before
            retrying an uncertain request.
          </p>
        )}
      </ConfirmationDialog>
    </>
  );
}
