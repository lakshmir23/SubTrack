import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Calculator,
  ChevronRight,
  FileText,
  Package,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Repeat2,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import type { Page } from "../shared/contracts";
import {
  catalogPreviewSchema,
  planInputSchema,
  planIntervals,
  productInputSchema,
  productTypes,
  quotationTemplateInputSchema,
  taxInputSchema,
  type CatalogLineInput,
  type CatalogPreview,
  type CatalogRecord,
  type Plan,
  type Product,
  type QuotationTemplate,
  type TaxRule,
} from "../shared/catalog";
import { amountInput, formatMoney, parseAmount } from "../shared/money";
import { errorMessage, request, RequestError } from "./api";
import { applyServerErrors, validateForm } from "./Auth";
import { useSession } from "./session";
import { useListQuery, useResource } from "./Workspace";
import {
  Button,
  CheckboxField,
  EmptyState,
  Feedback,
  Field,
  Loading,
  PageHeading,
  Pagination,
  SearchField,
  SelectField,
  TextareaField,
  useUnsavedChanges,
} from "./ui";

type Kind = "products" | "plans" | "taxes" | "quotation-templates";
type CatalogItem = Product | Plan | TaxRule | QuotationTemplate;
const labels: Record<Kind, { title: string; singular: string; help: string }> =
  {
    products: {
      title: "Products",
      singular: "product",
      help: "Software, services and add-ons with their own prices and variants.",
    },
    plans: {
      title: "Recurring plans",
      singular: "plan",
      help: "Recurring prices, calendar intervals and the service actions each plan permits.",
    },
    taxes: {
      title: "Tax rules",
      singular: "tax rule",
      help: "Exclusive percentage tax, selected automatically by scope and priority.",
    },
    "quotation-templates": {
      title: "Quotation templates",
      singular: "template",
      help: "Reusable plan and product selections with a clear quotation validity.",
    },
  };
const typeLabels = {
  software: "Software",
  service: "Service",
  addon: "Add-on",
};
const intervalLabels = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};
const listPath = (kind: Kind | "discounts") => `/configuration/${kind}`;
export type LineForm = {
  productId: string;
  variantId: string | null;
  quantity: string;
};
class InputProblem extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}
function money(value: string, field: string, signed = false) {
  void field;
  try {
    return parseAmount(value, signed);
  } catch (error) {
    void error;
    return Number.NaN;
  }
}
export function whole(value: string, field: string) {
  void field;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}
export function lineInputs(lines: LineForm[]): CatalogLineInput[] {
  return lines.map((line, index) => ({
    ...line,
    quantity: whole(line.quantity, `lines.${index}.quantity`),
  }));
}
function inputFocus(form: HTMLFormElement, field: string) {
  window.setTimeout(
    () => form.querySelector<HTMLElement>(`[name="${field}"]`)?.focus(),
    0,
  );
}

export function CatalogLayout() {
  const { user } = useSession();
  return (
    <>
      <PageHeading
        title="Configuration"
        description={
          user?.role === "admin"
            ? "Build the offerings your team can quote and bill with confidence."
            : "Read the current offerings. Your administrator manages configuration."
        }
      />
      <nav className="catalog-tabs" aria-label="Configuration sections">
        <NavLink to="/configuration/products">
          <Package size={16} />
          Products
        </NavLink>
        <NavLink to="/configuration/plans">
          <Repeat2 size={16} />
          Plans
        </NavLink>
        <NavLink to="/configuration/taxes">Tax rules</NavLink>
        <NavLink to="/configuration/discounts">
          <Percent size={16} />
          Discounts
        </NavLink>
        <NavLink to="/configuration/quotation-templates">
          <FileText size={16} />
          Templates
        </NavLink>
        <NavLink to="/configuration/preview">
          <Calculator size={16} />
          Price preview
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
function sectionTitle(title: string, description: string, action?: ReactNode) {
  return (
    <div className="catalog-section-title">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function CatalogList({ kind }: { kind: Kind }) {
  const { user } = useSession();
  const query = useListQuery();
  const location = useLocation();
  const back = location.pathname + location.search;
  const { data, busy, error, reload } = useResource<Page<CatalogItem>>(
    `/api/${kind}?q=${encodeURIComponent(query.query)}&page=${query.page}&pageSize=20`,
  );
  const copy = labels[kind];
  useEffect(() => {
    document.title = `${copy.title} · SubTrack`;
  }, [copy.title]);
  useEffect(() => {
    if (data && data.page !== query.page) query.setPage(data.page);
  }, [data, query.page]);
  const message = (location.state as { message?: string } | null)?.message;
  const headers =
    kind === "products"
      ? ["Type", "Sales price", "Variants"]
      : kind === "plans"
        ? ["Interval", "Recurring unit price", "Minimum quantity"]
        : kind === "taxes"
          ? ["Rate", "Scope", "Priority"]
          : ["Plan", "Lines", "Validity"];
  function cells(item: CatalogItem) {
    if (kind === "products") {
      const row = item as Product;
      return [
        typeLabels[row.type],
        formatMoney(row.salesPrice),
        `${row.variants.filter((variant) => variant.active).length} active`,
      ];
    }
    if (kind === "plans") {
      const row = item as Plan;
      return [
        intervalLabels[row.interval],
        formatMoney(row.price),
        row.minQuantity.toLocaleString("en-IN"),
      ];
    }
    if (kind === "taxes") {
      const row = item as TaxRule;
      return [
        `${amountInput(row.rateBps)}%`,
        row.productName || "All products",
        String(row.priority),
      ];
    }
    const row = item as QuotationTemplate;
    return [
      row.planName,
      String(row.lines.length),
      `${row.validDays} ${row.validDays === 1 ? "day" : "days"}`,
    ];
  }
  return (
    <>
      {sectionTitle(
        copy.title,
        copy.help,
        user?.role === "admin" && (
          <Link
            className="button"
            to={`${listPath(kind)}/new`}
            state={{ returnTo: back }}
          >
            <Plus size={17} />
            New {copy.singular}
          </Link>
        ),
      )}
      {message && <Feedback tone="success">{message}</Feedback>}
      <section className="list-panel" aria-label={copy.title}>
        <div className="list-toolbar">
          <SearchField
            label={`Search ${copy.title.toLowerCase()}`}
            placeholder={`Search ${copy.title.toLowerCase()}`}
            value={query.draft}
            onChange={query.setDraft}
            onCommit={query.commit}
            onComposition={query.setComposing}
          />
          <span className="list-count">
            {data
              ? `${data.total.toLocaleString("en-IN")} records`
              : "Saved configuration"}
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
            <Loading>Loading {copy.title.toLowerCase()}…</Loading>
          ) : !data?.items.length ? (
            <EmptyState
              title={
                query.query
                  ? "No matching records."
                  : `No ${copy.title.toLowerCase()} yet.`
              }
              icon={<Package size={26} />}
              action={
                query.query ? (
                  <Button tone="secondary" onClick={() => query.setDraft("")}>
                    Clear search
                  </Button>
                ) : user?.role === "admin" ? (
                  <Link className="button" to={`${listPath(kind)}/new`}>
                    <Plus size={17} />
                    New {copy.singular}
                  </Link>
                ) : undefined
              }
            >
              {query.query
                ? "Try a different name or clear your search."
                : user?.role === "admin"
                  ? `Create a ${copy.singular} to make it available to your team.`
                  : "Your administrator can create the first record."}
            </EmptyState>
          ) : (
            <table>
              <caption className="sr-only">
                {copy.title}, page {query.page}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  {headers.map((header) => (
                    <th
                      scope="col"
                      key={header}
                      className={
                        /price/i.test(header) ? "money-cell" : undefined
                      }
                    >
                      {header}
                    </th>
                  ))}
                  <th scope="col">Status</th>
                  {user?.role === "admin" && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Name">
                      <Link
                        className="record-link"
                        to={`${listPath(kind)}/${item.id}`}
                        state={{ returnTo: back }}
                      >
                        {item.name}
                        <ChevronRight size={14} />
                      </Link>
                    </td>
                    {cells(item).map((value, index) => (
                      <td
                        key={headers[index]}
                        data-label={headers[index]}
                        className={
                          /price/i.test(headers[index])
                            ? "money-cell"
                            : undefined
                        }
                      >
                        {value}
                      </td>
                    ))}
                    <td data-label="Status">
                      <span
                        className={`status ${item.active ? "success" : "info"}`}
                      >
                        {item.active ? "Available" : "Inactive"}
                      </span>
                    </td>
                    {user?.role === "admin" && (
                      <td data-label="Action">
                        <Link
                          className="table-action"
                          to={`${listPath(kind)}/${item.id}/edit`}
                          state={{ returnTo: back }}
                          aria-label={`Edit ${item.name}`}
                        >
                          <Pencil size={14} />
                          Edit
                        </Link>
                      </td>
                    )}
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

export function RecordSelect<T extends { id: string }>({
  resource,
  label,
  name,
  value,
  onChange,
  error,
  disabled = false,
  selectedLabel,
  help,
  emptyLabel,
}: {
  resource:
    | "products"
    | "plans"
    | "customers"
    | "quotation-templates"
    | "subscriptions";
  label: string;
  name: string;
  value: string;
  onChange: (id: string, record?: T) => void;
  error?: string;
  disabled?: boolean;
  selectedLabel?: string;
  help?: string;
  emptyLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search, composing]);
  const list = useResource<Page<T>>(
    `/api/${resource}?${resource === "customers" || resource === "subscriptions" ? "" : "active=true&"}q=${encodeURIComponent(query)}&pageSize=100`,
  );
  const found = list.data?.items.find((item) => item.id === value);
  const selected = useResource<T>(
    value && list.data && !found && resource !== "customers"
      ? `/api/${resource}/${value}`
      : null,
  );
  const options = list.data?.items || [];
  function recordLabel(record: T) {
    if ("name" in record)
      return resource === "customers" && "email" in record
        ? `${String(record.name)} · ${String(record.email)}`
        : String(record.name);
    if ("number" in record)
      return `${String(record.number)}${"customerName" in record ? ` · ${String(record.customerName)}` : ""}`;
    return "Selected record";
  }
  return (
    <div className="record-select">
      <SelectField
        name={name}
        label={label}
        value={value}
        error={error}
        disabled={disabled || (list.busy && !list.data)}
        onChange={(event) =>
          onChange(
            event.target.value,
            options.find((item) => item.id === event.target.value) ||
              selected.data ||
              undefined,
          )
        }
        help={
          list.busy
            ? "Loading available records…"
            : disabled
              ? help || "The primary product is set by the selected plan."
              : help
        }
      >
        <option value="">
          {emptyLabel || (
            <>
              Choose{" "}
              {resource === "plans"
                ? "a plan"
                : resource === "customers"
                  ? "a customer"
                  : resource === "quotation-templates"
                    ? "a template"
                    : resource === "subscriptions"
                      ? "a subscription"
                      : "a product"}
            </>
          )}
        </option>
        {value && !found && (
          <option value={value}>
            {selected.data
              ? recordLabel(selected.data)
              : selectedLabel || "Selected record"}
          </option>
        )}
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {recordLabel(item)}
          </option>
        ))}
      </SelectField>
      {!disabled && ((list.data?.total || 0) > 100 || search) && (
        <SearchField
          label={`Search ${label.toLowerCase()} options`}
          placeholder="Find another record"
          value={search}
          onChange={(value) => {
            setSearch(value);
            if (!value) setQuery("");
          }}
          onCommit={() => setQuery(search)}
          onComposition={setComposing}
        />
      )}
      {(list.error || selected.error) && (
        <Feedback tone="error">
          {list.error || selected.error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              list.reload();
              selected.reload();
            }}
          >
            Retry
          </button>
        </Feedback>
      )}
    </div>
  );
}

export function useConfigurationEditor<T extends CatalogRecord, V>(
  kind: Kind | "discounts",
  id: string | undefined,
  initial: V,
  fromRecord: (record: T) => V,
) {
  const location = useLocation();
  const navigate = useNavigate();
  const singular =
    kind === "discounts" ? "discount rule" : labels[kind].singular;
  const loaded = useResource<T>(id ? `/api/${kind}/${id}` : null);
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [version, setVersion] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const guard = useUnsavedChanges(JSON.stringify(values) !== baseline);
  useEffect(() => {
    if (loaded.data && version === null) {
      const next = fromRecord(loaded.data);
      setValues(next);
      setBaseline(JSON.stringify(next));
      setVersion(loaded.data.version);
    }
  }, [loaded.data, version]);
  const stateReturn = (location.state as { returnTo?: string } | null)
    ?.returnTo;
  const back =
    stateReturn?.startsWith(listPath(kind)) &&
    !stateReturn.includes("/new") &&
    !stateReturn.includes("/edit")
      ? stateReturn
      : listPath(kind);
  async function save(
    event: FormEvent<HTMLFormElement>,
    schema: z.ZodType,
    prepare: () => unknown,
  ) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    let payload: unknown;
    try {
      payload = prepare();
    } catch (reason) {
      if (reason instanceof InputProblem) {
        setFields({ [reason.field]: reason.message });
        inputFocus(form, reason.field);
      } else setError(errorMessage(reason));
      return;
    }
    const invalid = validateForm(schema, payload, form);
    setFields(invalid || {});
    setError("");
    if (invalid) return;
    pending.current = true;
    setBusy(true);
    try {
      await request(`/api/${kind}${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        body: id ? { ...(payload as object), version } : payload,
      });
      guard.allowNavigation();
      navigate(back, {
        state: {
          message: `${singular[0].toUpperCase() + singular.slice(1)} ${id ? "updated" : "created"}.`,
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
  return {
    values,
    setValues,
    version,
    fields,
    error,
    busy,
    loaded,
    back,
    guard,
    save,
  };
}
function EditorFrame({
  kind,
  id,
  children,
  editor,
  aside,
}: {
  kind: Kind;
  id?: string;
  children: ReactNode;
  editor: {
    loaded: { busy: boolean; error: string; reload: () => void };
    error: string;
    back: string;
    guard: { confirm: ReactNode };
    version?: number | null;
  };
  aside: ReactNode;
}) {
  useEffect(() => {
    document.title = `${id ? "Edit" : "New"} ${labels[kind].singular} · SubTrack`;
  }, [kind, id]);
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
    return <Loading>Loading the saved {labels[kind].singular}…</Loading>;
  return (
    <>
      <Link className="back-link" to={editor.back}>
        <ArrowLeft size={16} />
        Back to {labels[kind].title.toLowerCase()}
      </Link>
      {sectionTitle(
        `${id ? "Edit" : "New"} ${labels[kind].singular}`,
        labels[kind].help,
      )}
      {editor.error && (
        <Feedback tone="error">
          {editor.error}{" "}
          {id && (
            <Link to={`${listPath(kind)}/${id}`}>Review the saved record</Link>
          )}
        </Feedback>
      )}
      <div className="catalog-form-layout">
        {children}
        <aside className="form-aside">{aside}</aside>
      </div>
      {editor.guard.confirm}
    </>
  );
}
function SaveActions({
  back,
  busy,
  label,
}: {
  back: string;
  busy: boolean;
  label: string;
}) {
  return (
    <div className="form-actions">
      <Link className="button secondary" to={back}>
        Cancel
      </Link>
      <Button type="submit" busy={busy}>
        {label}
      </Button>
    </div>
  );
}

interface ProductFormValues {
  name: string;
  type: Product["type"];
  salesPrice: string;
  costPrice: string;
  notes: string;
  active: boolean;
  variants: {
    id?: string;
    name: string;
    adjustment: string;
    active: boolean;
  }[];
}
const newProduct: ProductFormValues = {
  name: "",
  type: "software",
  salesPrice: "",
  costPrice: "",
  notes: "",
  active: true,
  variants: [],
};
function productValues(product: Product): ProductFormValues {
  return {
    ...product,
    salesPrice: amountInput(product.salesPrice),
    costPrice: amountInput(product.costPrice || 0),
    notes: product.notes || "",
    variants: product.variants.map((variant) => ({
      ...variant,
      adjustment: amountInput(variant.adjustment),
    })),
  };
}
function ProductForm({ id }: { id?: string }) {
  const editor = useConfigurationEditor<Product, ProductFormValues>(
    "products",
    id,
    newProduct,
    productValues,
  );
  const { values, setValues, fields } = editor;
  function changeVariant(
    index: number,
    patch: Partial<ProductFormValues["variants"][number]>,
  ) {
    setValues({
      ...values,
      variants: values.variants.map((variant, position) =>
        position === index ? { ...variant, ...patch } : variant,
      ),
    });
  }
  return (
    <EditorFrame
      kind="products"
      id={id}
      editor={editor}
      aside={
        <>
          <Package size={25} />
          <h3>One product, flexible variants</h3>
          <p>
            Plans replace this product’s base sales price. A selected variant
            adds its adjustment per unit.
          </p>
          <p className="muted">
            Cost price stays with administrators. Notes are internal and never
            appear in the customer portal.
          </p>
        </>
      }
    >
      <form
        className="panel catalog-editor"
        noValidate
        aria-label={id ? "Edit product" : "New product"}
        onSubmit={(event) =>
          editor.save(event, productInputSchema, () => ({
            name: values.name,
            type: values.type,
            salesPrice: money(values.salesPrice, "salesPrice"),
            costPrice: money(values.costPrice, "costPrice"),
            notes: values.notes,
            active: values.active,
            variants: values.variants.map((variant, index) => ({
              ...variant,
              adjustment: money(
                variant.adjustment,
                `variants.${index}.adjustment`,
                true,
              ),
            })),
          }))
        }
      >
        <Field
          name="name"
          label="Product name"
          value={values.name}
          error={fields.name}
          onChange={(event) =>
            setValues({ ...values, name: event.target.value })
          }
        />
        <SelectField
          name="type"
          label="Product type"
          value={values.type}
          error={fields.type}
          onChange={(event) =>
            setValues({
              ...values,
              type: event.target.value as Product["type"],
            })
          }
        >
          {productTypes.map((type) => (
            <option key={type} value={type}>
              {typeLabels[type]}
            </option>
          ))}
        </SelectField>
        <div className="field-pair">
          <Field
            name="salesPrice"
            label="Sales price (INR)"
            inputMode="decimal"
            value={values.salesPrice}
            error={fields.salesPrice}
            onChange={(event) =>
              setValues({ ...values, salesPrice: event.target.value })
            }
          />
          <Field
            name="costPrice"
            label="Cost price (INR)"
            inputMode="decimal"
            value={values.costPrice}
            error={fields.costPrice}
            onChange={(event) =>
              setValues({ ...values, costPrice: event.target.value })
            }
          />
        </div>
        <TextareaField
          name="notes"
          label="Internal notes"
          maxLength={2000}
          value={values.notes}
          error={fields.notes}
          onChange={(event) =>
            setValues({ ...values, notes: event.target.value })
          }
        />
        <CheckboxField
          label="Available for new offerings"
          checked={values.active}
          onChange={(event) =>
            setValues({ ...values, active: event.target.checked })
          }
        />
        <fieldset className="editor-section">
          <legend>Variants</legend>
          <p className="field-help">
            Adjustments can increase or reduce a unit price. Existing variants
            can be deactivated without deleting their identity.
          </p>
          {fields.variants && (
            <Feedback tone="error">{fields.variants}</Feedback>
          )}
          {values.variants.map((variant, index) => (
            <div className="variant-row" key={variant.id || index}>
              <div className="field-pair">
                <Field
                  name={`variants.${index}.name`}
                  label={`Variant ${index + 1} name`}
                  value={variant.name}
                  error={fields[`variants.${index}.name`]}
                  onChange={(event) =>
                    changeVariant(index, { name: event.target.value })
                  }
                />
                <Field
                  name={`variants.${index}.adjustment`}
                  label={`Variant ${index + 1} adjustment (INR)`}
                  inputMode="decimal"
                  value={variant.adjustment}
                  error={fields[`variants.${index}.adjustment`]}
                  onChange={(event) =>
                    changeVariant(index, { adjustment: event.target.value })
                  }
                />
              </div>
              <div className="variant-actions">
                <CheckboxField
                  label={`Variant ${index + 1} available`}
                  checked={variant.active}
                  onChange={(event) =>
                    changeVariant(index, { active: event.target.checked })
                  }
                />
                {!variant.id && (
                  <Button
                    tone="ghost"
                    onClick={() =>
                      setValues({
                        ...values,
                        variants: values.variants.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={15} />
                    Remove variant {index + 1}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            tone="secondary"
            disabled={values.variants.length >= 50}
            onClick={() =>
              setValues({
                ...values,
                variants: [
                  ...values.variants,
                  { name: "", adjustment: "0.00", active: true },
                ],
              })
            }
          >
            <Plus size={16} />
            Add variant
          </Button>
        </fieldset>
        <SaveActions
          back={editor.back}
          busy={editor.busy}
          label="Save product"
        />
      </form>
    </EditorFrame>
  );
}

type PlanFormValues = Omit<
  Plan,
  keyof CatalogRecord | "primaryProductName" | "price" | "minQuantity"
> & { price: string; minQuantity: string };
const newPlan: PlanFormValues = {
  name: "",
  primaryProductId: "",
  price: "",
  interval: "monthly",
  minQuantity: "1",
  availableFrom: null,
  availableTo: null,
  autoClose: true,
  allowPause: false,
  allowRenew: false,
  allowEarlyClose: false,
  active: true,
};
function planValues(plan: Plan): PlanFormValues {
  const {
    name,
    primaryProductId,
    price,
    interval,
    minQuantity,
    availableFrom,
    availableTo,
    autoClose,
    allowPause,
    allowRenew,
    allowEarlyClose,
    active,
  } = plan;
  return {
    name,
    primaryProductId,
    price: amountInput(price),
    interval,
    minQuantity: String(minQuantity),
    availableFrom,
    availableTo,
    autoClose,
    allowPause,
    allowRenew,
    allowEarlyClose,
    active,
  };
}
function PlanForm({ id }: { id?: string }) {
  const editor = useConfigurationEditor<Plan, PlanFormValues>(
    "plans",
    id,
    newPlan,
    planValues,
  );
  const { values, setValues, fields } = editor;
  return (
    <EditorFrame
      kind="plans"
      id={id}
      editor={editor}
      aside={
        <>
          <Repeat2 size={25} />
          <h3>A price with a clear meaning</h3>
          <p>
            The recurring unit price replaces the primary product’s catalog
            price. Variant adjustments and optional products remain separate.
          </p>
          <p className="muted">
            Calendar periods keep their original anchor. Monthly billing is
            never treated as a fixed 30 days.
          </p>
        </>
      }
    >
      <form
        className="panel catalog-editor"
        noValidate
        aria-label={id ? "Edit plan" : "New plan"}
        onSubmit={(event) =>
          editor.save(event, planInputSchema, () => ({
            ...values,
            price: money(values.price, "price"),
            minQuantity: whole(values.minQuantity, "minQuantity"),
          }))
        }
      >
        <Field
          name="name"
          label="Plan name"
          value={values.name}
          error={fields.name}
          onChange={(event) =>
            setValues({ ...values, name: event.target.value })
          }
        />
        <RecordSelect<Product>
          resource="products"
          name="primaryProductId"
          label="Primary product"
          value={values.primaryProductId}
          error={fields.primaryProductId}
          onChange={(primaryProductId) =>
            setValues({ ...values, primaryProductId })
          }
        />
        <div className="field-pair">
          <Field
            name="price"
            label="Recurring unit price (INR)"
            inputMode="decimal"
            value={values.price}
            error={fields.price}
            onChange={(event) =>
              setValues({ ...values, price: event.target.value })
            }
          />
          <SelectField
            name="interval"
            label="Billing interval"
            value={values.interval}
            error={fields.interval}
            onChange={(event) =>
              setValues({
                ...values,
                interval: event.target.value as Plan["interval"],
              })
            }
          >
            {planIntervals.map((interval) => (
              <option key={interval} value={interval}>
                {intervalLabels[interval]}
              </option>
            ))}
          </SelectField>
        </div>
        <Field
          name="minQuantity"
          label="Minimum primary-product quantity"
          inputMode="numeric"
          value={values.minQuantity}
          error={fields.minQuantity}
          onChange={(event) =>
            setValues({ ...values, minQuantity: event.target.value })
          }
        />
        <fieldset className="editor-section">
          <legend>Availability for new agreements</legend>
          <div className="field-pair">
            <Field
              name="availableFrom"
              label="Available from"
              type="date"
              value={values.availableFrom || ""}
              error={fields.availableFrom}
              onChange={(event) =>
                setValues({
                  ...values,
                  availableFrom: event.target.value || null,
                })
              }
            />
            <Field
              name="availableTo"
              label="Available through"
              type="date"
              value={values.availableTo || ""}
              error={fields.availableTo}
              help="Both boundary dates are inclusive."
              onChange={(event) =>
                setValues({
                  ...values,
                  availableTo: event.target.value || null,
                })
              }
            />
          </div>
        </fieldset>
        <fieldset className="editor-section">
          <legend>Service policies</legend>
          <CheckboxField
            label="Close automatically at expiry"
            checked={values.autoClose}
            onChange={(event) =>
              setValues({ ...values, autoClose: event.target.checked })
            }
          />
          <CheckboxField
            label="Allow pause and resume"
            help="Changes take effect at an eligible billing boundary."
            checked={values.allowPause}
            onChange={(event) =>
              setValues({ ...values, allowPause: event.target.checked })
            }
          />
          <CheckboxField
            label="Allow renewal"
            checked={values.allowRenew}
            onChange={(event) =>
              setValues({ ...values, allowRenew: event.target.checked })
            }
          />
          <CheckboxField
            label="Allow early closure"
            checked={values.allowEarlyClose}
            onChange={(event) =>
              setValues({ ...values, allowEarlyClose: event.target.checked })
            }
          />
        </fieldset>
        <CheckboxField
          label="Available for new offerings"
          checked={values.active}
          onChange={(event) =>
            setValues({ ...values, active: event.target.checked })
          }
        />
        <SaveActions back={editor.back} busy={editor.busy} label="Save plan" />
      </form>
    </EditorFrame>
  );
}

type TaxFormValues = {
  name: string;
  rate: string;
  productId: string | null;
  priority: string;
  active: boolean;
};
const newTax: TaxFormValues = {
  name: "",
  rate: "",
  productId: null,
  priority: "100",
  active: true,
};
function TaxForm({ id }: { id?: string }) {
  const editor = useConfigurationEditor<TaxRule, TaxFormValues>(
    "taxes",
    id,
    newTax,
    (record) => ({
      name: record.name,
      rate: amountInput(record.rateBps),
      productId: record.productId,
      priority: String(record.priority),
      active: record.active,
    }),
  );
  const { values, setValues, fields } = editor;
  return (
    <EditorFrame
      kind="taxes"
      id={id}
      editor={editor}
      aside={
        <>
          <Calculator size={25} />
          <h3>Automatic, explainable tax</h3>
          <p>
            One active rule applies per line. The lowest priority number wins; a
            product-specific rule wins a tie over an all-product rule.
          </p>
          <p className="muted">
            Tax is exclusive and rounded half-up per line. This is a configured
            product rule, not a claim of jurisdictional tax compliance.
          </p>
        </>
      }
    >
      <form
        className="panel catalog-editor"
        noValidate
        aria-label={id ? "Edit tax rule" : "New tax rule"}
        onSubmit={(event) =>
          editor.save(event, taxInputSchema, () => ({
            name: values.name,
            rateBps: money(values.rate, "rateBps"),
            productId: values.productId,
            priority: whole(values.priority, "priority"),
            active: values.active,
          }))
        }
      >
        <Field
          name="name"
          label="Tax rule name"
          value={values.name}
          error={fields.name}
          onChange={(event) =>
            setValues({ ...values, name: event.target.value })
          }
        />
        <div className="field-pair">
          <Field
            name="rateBps"
            label="Tax rate (%)"
            inputMode="decimal"
            value={values.rate}
            error={fields.rateBps}
            onChange={(event) =>
              setValues({ ...values, rate: event.target.value })
            }
          />
          <Field
            name="priority"
            label="Priority"
            inputMode="numeric"
            value={values.priority}
            error={fields.priority}
            help="Lower numbers apply first."
            onChange={(event) =>
              setValues({ ...values, priority: event.target.value })
            }
          />
        </div>
        <SelectField
          label="Tax scope"
          value={values.productId === null ? "all" : "product"}
          onChange={(event) =>
            setValues({
              ...values,
              productId: event.target.value === "all" ? null : "",
            })
          }
        >
          <option value="all">All products</option>
          <option value="product">One specific product</option>
        </SelectField>
        {values.productId !== null && (
          <RecordSelect<Product>
            resource="products"
            name="productId"
            label="Taxed product"
            value={values.productId}
            error={fields.productId}
            onChange={(productId) => setValues({ ...values, productId })}
          />
        )}
        <CheckboxField
          label="Rule active"
          checked={values.active}
          onChange={(event) =>
            setValues({ ...values, active: event.target.checked })
          }
        />
        <SaveActions
          back={editor.back}
          busy={editor.busy}
          label="Save tax rule"
        />
      </form>
    </EditorFrame>
  );
}

export function LineEditor({
  lines,
  onChange,
  fields,
  primaryProductId,
}: {
  lines: LineForm[];
  onChange: (lines: LineForm[]) => void;
  fields: Record<string, string>;
  primaryProductId?: string;
}) {
  function change(index: number, patch: Partial<LineForm>) {
    onChange(
      lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    );
  }
  return (
    <fieldset className="editor-section">
      <legend>Product lines</legend>
      {fields.lines && <Feedback tone="error">{fields.lines}</Feedback>}
      {lines.map((line, index) => (
        <ProductLine
          key={index}
          line={line}
          index={index}
          fields={fields}
          primary={index === 0 && line.productId === primaryProductId}
          onChange={(patch) => change(index, patch)}
          onRemove={() =>
            onChange(lines.filter((_, position) => position !== index))
          }
        />
      ))}
      <Button
        tone="secondary"
        disabled={lines.length >= 50}
        onClick={() =>
          onChange([
            ...lines,
            { productId: "", variantId: null, quantity: "1" },
          ])
        }
      >
        <Plus size={16} />
        Add product line
      </Button>
    </fieldset>
  );
}
function ProductLine({
  line,
  index,
  primary,
  fields,
  onChange,
  onRemove,
}: {
  line: LineForm;
  index: number;
  primary: boolean;
  fields: Record<string, string>;
  onChange: (patch: Partial<LineForm>) => void;
  onRemove: () => void;
}) {
  const product = useResource<Product>(
    line.productId ? `/api/products/${line.productId}` : null,
  );
  return (
    <div className="product-line">
      <div className="product-line-title">
        <strong>
          Line {index + 1}
          {primary && " · Primary product"}
        </strong>
        {!primary && (
          <Button tone="ghost" onClick={onRemove}>
            <Trash2 size={14} />
            Remove line {index + 1}
          </Button>
        )}
      </div>
      <RecordSelect<Product>
        resource="products"
        name={`lines.${index}.productId`}
        label={`Line ${index + 1} product`}
        value={line.productId}
        error={fields[`lines.${index}.productId`]}
        disabled={primary}
        onChange={(productId) => onChange({ productId, variantId: null })}
      />
      <div className="field-pair">
        <SelectField
          name={`lines.${index}.variantId`}
          label={`Line ${index + 1} variant`}
          value={line.variantId || ""}
          error={fields[`lines.${index}.variantId`]}
          disabled={!line.productId || product.busy}
          onChange={(event) =>
            onChange({ variantId: event.target.value || null })
          }
        >
          <option value="">Base product</option>
          {product.data?.variants.map((variant) => (
            <option
              value={variant.id}
              key={variant.id}
              disabled={!variant.active}
            >
              {variant.name}
              {!variant.active
                ? " (inactive)"
                : ` (${variant.adjustment >= 0 ? "+" : ""}${formatMoney(variant.adjustment)})`}
            </option>
          ))}
        </SelectField>
        <Field
          name={`lines.${index}.quantity`}
          label={`Line ${index + 1} quantity`}
          inputMode="numeric"
          value={line.quantity}
          error={fields[`lines.${index}.quantity`]}
          onChange={(event) => onChange({ quantity: event.target.value })}
        />
      </div>
      {product.error && (
        <Feedback tone="error">
          {product.error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={product.reload}
          >
            Retry
          </button>
        </Feedback>
      )}
    </div>
  );
}
type TemplateFormValues = {
  name: string;
  planId: string;
  validDays: string;
  lines: LineForm[];
  active: boolean;
};
const newTemplate: TemplateFormValues = {
  name: "",
  planId: "",
  validDays: "7",
  lines: [],
  active: true,
};
function TemplateForm({ id }: { id?: string }) {
  const editor = useConfigurationEditor<QuotationTemplate, TemplateFormValues>(
    "quotation-templates",
    id,
    newTemplate,
    (record) => ({
      name: record.name,
      planId: record.planId,
      validDays: String(record.validDays),
      active: record.active,
      lines: record.lines.map((line) => ({
        ...line,
        quantity: String(line.quantity),
      })),
    }),
  );
  const { values, setValues, fields } = editor;
  const plan = useResource<Plan>(
    values.planId ? `/api/plans/${values.planId}` : null,
  );
  return (
    <EditorFrame
      kind="quotation-templates"
      id={id}
      editor={editor}
      aside={
        <>
          <FileText size={25} />
          <h3>A reusable starting point</h3>
          <p>
            Choose the plan, products and validity once. Each future quotation
            will copy its own independent instance.
          </p>
          <p className="muted">
            Changing a template won’t rewrite an existing agreement.
          </p>
        </>
      }
    >
      <form
        className="panel catalog-editor"
        noValidate
        aria-label={id ? "Edit quotation template" : "New quotation template"}
        onSubmit={(event) =>
          editor.save(event, quotationTemplateInputSchema, () => ({
            name: values.name,
            planId: values.planId,
            validDays: whole(values.validDays, "validDays"),
            lines: lineInputs(values.lines),
            active: values.active,
          }))
        }
      >
        <Field
          name="name"
          label="Template name"
          value={values.name}
          error={fields.name}
          onChange={(event) =>
            setValues({ ...values, name: event.target.value })
          }
        />
        <RecordSelect<Plan>
          resource="plans"
          name="planId"
          label="Recurring plan"
          value={values.planId}
          error={fields.planId}
          onChange={(planId, record) =>
            setValues({
              ...values,
              planId,
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
        <Field
          name="validDays"
          label="Quotation validity (days)"
          inputMode="numeric"
          value={values.validDays}
          error={fields.validDays}
          help="A quotation issued for 7 days is valid through its sixth following day."
          onChange={(event) =>
            setValues({ ...values, validDays: event.target.value })
          }
        />
        <LineEditor
          lines={values.lines}
          fields={fields}
          primaryProductId={plan.data?.primaryProductId}
          onChange={(lines) => setValues({ ...values, lines })}
        />
        <CheckboxField
          label="Template available"
          checked={values.active}
          onChange={(event) =>
            setValues({ ...values, active: event.target.checked })
          }
        />
        <SaveActions
          back={editor.back}
          busy={editor.busy}
          label="Save template"
        />
      </form>
    </EditorFrame>
  );
}

export function CatalogEditor({ kind }: { kind: Kind }) {
  const { id } = useParams();
  if (kind === "products") return <ProductForm key={id || "new"} id={id} />;
  if (kind === "plans") return <PlanForm key={id || "new"} id={id} />;
  if (kind === "taxes") return <TaxForm key={id || "new"} id={id} />;
  return <TemplateForm key={id || "new"} id={id} />;
}
function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function CatalogDetail({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const { user } = useSession();
  const location = useLocation();
  const back =
    (location.state as { returnTo?: string } | null)?.returnTo ||
    listPath(kind);
  const { data, busy, error, reload } = useResource<CatalogItem>(
    `/api/${kind}/${id}`,
  );
  useEffect(() => {
    document.title = `${data?.name || labels[kind].singular} · SubTrack`;
  }, [data?.name, kind]);
  if (busy) return <Loading>Loading the {labels[kind].singular}…</Loading>;
  if (error || !data)
    return (
      <Feedback tone="error">
        {error || "This record could not be loaded."}{" "}
        <button className="text-button" onClick={reload}>
          Retry
        </button>
      </Feedback>
    );
  const product = data as Product,
    plan = data as Plan,
    tax = data as TaxRule,
    template = data as QuotationTemplate;
  return (
    <>
      <Link className="back-link" to={back}>
        <ArrowLeft size={16} />
        Back to {labels[kind].title.toLowerCase()}
      </Link>
      {sectionTitle(
        data.name,
        data.active
          ? "Available for new offerings"
          : "Inactive for new offerings",
        user?.role === "admin" && (
          <Link
            className="button secondary"
            to={`${listPath(kind)}/${id}/edit`}
            state={{ returnTo: back }}
          >
            <Pencil size={16} />
            Edit {labels[kind].singular}
          </Link>
        ),
      )}
      <section className="panel catalog-detail">
        {kind === "quotation-templates" && template.active && (
          <div className="template-use">
            <Link
              className="button"
              to={`/subscriptions/new?templateId=${template.id}`}
            >
              <FileText size={17} />
              Use template
            </Link>
            <span>
              Creates an independent draft; the template stays reusable.
            </span>
          </div>
        )}
        <dl className="catalog-detail-grid">
          {kind === "products" ? (
            <>
              <DetailField label="Product type">
                {typeLabels[product.type]}
              </DetailField>
              <DetailField label="Catalog sales price">
                {formatMoney(product.salesPrice)}
              </DetailField>
              {user?.role === "admin" && (
                <DetailField label="Internal cost price">
                  {formatMoney(product.costPrice || 0)}
                </DetailField>
              )}
            </>
          ) : kind === "plans" ? (
            <>
              <DetailField label="Primary product">
                <Link to={`/configuration/products/${plan.primaryProductId}`}>
                  {plan.primaryProductName}
                </Link>
              </DetailField>
              <DetailField label="Recurring unit price">
                {formatMoney(plan.price)}
              </DetailField>
              <DetailField label="Billing interval">
                {intervalLabels[plan.interval]}
              </DetailField>
              <DetailField label="Minimum primary quantity">
                {plan.minQuantity}
              </DetailField>
              <DetailField label="Available from">
                {plan.availableFrom || "No start limit"}
              </DetailField>
              <DetailField label="Available through">
                {plan.availableTo || "No end limit"}
              </DetailField>
            </>
          ) : kind === "taxes" ? (
            <>
              <DetailField label="Exclusive tax rate">
                {amountInput(tax.rateBps)}%
              </DetailField>
              <DetailField label="Scope">
                {tax.productName || "All products"}
              </DetailField>
              <DetailField label="Priority">
                {tax.priority} (lower applies first)
              </DetailField>
            </>
          ) : (
            <>
              <DetailField label="Recurring plan">
                <Link to={`/configuration/plans/${template.planId}`}>
                  {template.planName}
                </Link>
              </DetailField>
              <DetailField label="Quotation validity">
                {template.validDays} days
              </DetailField>
            </>
          )}
        </dl>
        {kind === "products" && (
          <>
            <h3>Variants</h3>
            {product.variants.length ? (
              <div className="detail-lines">
                {product.variants.map((variant) => (
                  <div key={variant.id}>
                    <strong>{variant.name}</strong>
                    <span>
                      {variant.adjustment >= 0 ? "+" : ""}
                      {formatMoney(variant.adjustment)} per unit
                    </span>
                    <span
                      className={`status ${variant.active ? "success" : "info"}`}
                    >
                      {variant.active ? "Available" : "Inactive"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">This product has no configured variants.</p>
            )}
            {product.notes && (
              <div className="detail-notes">
                <h3>Internal notes</h3>
                <p>{product.notes}</p>
              </div>
            )}
          </>
        )}
        {kind === "plans" && (
          <>
            <h3>Service policies</h3>
            <div className="policy-summary">
              {[
                [plan.autoClose, "Automatic expiry closure"],
                [plan.allowPause, "Pause and resume"],
                [plan.allowRenew, "Renewal"],
                [plan.allowEarlyClose, "Early closure"],
              ].map(([allowed, label]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <span className={`status ${allowed ? "success" : "info"}`}>
                    {allowed ? "Allowed" : "Not allowed"}
                  </span>
                </div>
              ))}
            </div>
            <p className="footnote">
              Plan price replaces the primary product’s base sales price.
              Variant adjustments apply per unit.
            </p>
          </>
        )}
        {kind === "quotation-templates" && (
          <div className="detail-lines">
            {template.lines.map((line, index) => (
              <TemplateLine key={index} line={line} />
            ))}
          </div>
        )}
        <p className="footnote">
          Version {data.version} · Saved{" "}
          {new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata",
          }).format(new Date(data.updatedAt))}{" "}
          IST
        </p>
      </section>
    </>
  );
}
function TemplateLine({ line }: { line: CatalogLineInput }) {
  const product = useResource<Product>(`/api/products/${line.productId}`);
  return (
    <div>
      <Link to={`/configuration/products/${line.productId}`}>
        {product.data?.name ||
          (product.error ? "Product unavailable" : "Loading product…")}
      </Link>
      <span>
        {product.data?.variants.find((variant) => variant.id === line.variantId)
          ?.name || "Base product"}
      </span>
      <strong>
        {line.quantity} {line.quantity === 1 ? "unit" : "units"}
      </strong>
    </div>
  );
}

export type AmountBreakdownData = Omit<
  Pick<
    CatalogPreview,
    "lines" | "subtotal" | "tax" | "total" | "priceExplanation"
  >,
  "lines"
> & {
  lines: (Omit<CatalogPreview["lines"][number], "isPrimary"> & {
    isPrimary?: boolean;
    discountAmount?: number;
    taxableAmount?: number;
  })[];
  businessDate?: string;
  discountAmount?: number;
  discountName?: string | null;
};
export function AmountBreakdown({
  value,
  estimated = false,
  note,
  periodLabel,
  totalLabel,
  baseLabel,
}: {
  value: AmountBreakdownData;
  estimated?: boolean;
  note?: ReactNode;
  periodLabel?: string;
  totalLabel?: string;
  baseLabel?: string;
}) {
  return (
    <>
      {estimated && (
        <p className="pricing-period-scope">
          One {periodLabel || "recurring"} billing period
        </p>
      )}
      {value.priceExplanation && (
        <details className="calculation-explanation">
          <summary>How this amount is calculated</summary>
          <p>{value.priceExplanation}</p>
        </details>
      )}
      {value.lines.map((line, index) => (
        <div className="calculation-line" key={index}>
          <strong>{line.productName}</strong>
          {line.variantName && (
            <span className="muted">{line.variantName}</span>
          )}
          <dl>
            <div>
              <dt>
                {baseLabel ||
                  (line.isPrimary
                    ? "Plan base per unit"
                    : "Catalog base per unit")}
              </dt>
              <dd>{formatMoney(line.baseUnitPrice)}</dd>
            </div>
            <div>
              <dt>Variant adjustment per unit</dt>
              <dd>
                {line.variantAdjustment >= 0 ? "+" : ""}
                {formatMoney(line.variantAdjustment)}
              </dd>
            </div>
            <div>
              <dt>Unit price × {line.quantity}</dt>
              <dd>
                {formatMoney(line.unitPrice)} × {line.quantity}
              </dd>
            </div>
            <div>
              <dt>Line subtotal</dt>
              <dd>{formatMoney(line.subtotal)}</dd>
            </div>
            {line.discountAmount !== undefined && (
              <div>
                <dt>Discount</dt>
                <dd>
                  {line.discountAmount > 0 ? "−" : ""}
                  {formatMoney(line.discountAmount)}
                </dd>
              </div>
            )}
            {line.taxableAmount !== undefined && (
              <div>
                <dt>Taxable amount</dt>
                <dd>{formatMoney(line.taxableAmount)}</dd>
              </div>
            )}
            <div>
              <dt>
                {line.taxName || (estimated ? "Estimated tax" : "Tax")} (
                {amountInput(line.taxRateBps)}%)
              </dt>
              <dd>{formatMoney(line.tax)}</dd>
            </div>
          </dl>
        </div>
      ))}
      <dl className="calculation-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMoney(value.subtotal)}</dd>
        </div>
        {value.discountAmount !== undefined && (
          <div>
            <dt>{value.discountName || "Discount"}</dt>
            <dd>
              {value.discountAmount > 0 ? "−" : ""}
              {formatMoney(value.discountAmount)}
            </dd>
          </div>
        )}
        <div>
          <dt>{estimated ? "Estimated tax" : "Tax"}</dt>
          <dd>{formatMoney(value.tax)}</dd>
        </div>
        <div className="grand-total">
          <dt>
            {totalLabel || (estimated ? "Estimated period total" : "Total")}
          </dt>
          <dd>{formatMoney(value.total)}</dd>
        </div>
      </dl>
      <p className="footnote">
        {note || (
          <>
            Current catalog · {value.businessDate} · INR. Discounts are
            evaluated when an invoice is generated.
          </>
        )}
      </p>
    </>
  );
}
export function CatalogPricePreview() {
  const [planId, setPlanId] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const plan = useResource<Plan>(planId ? `/api/plans/${planId}` : null);
  let payload: { planId: string; lines: CatalogLineInput[] } | null = null;
  try {
    const candidate = { planId, lines: lineInputs(lines) };
    if (catalogPreviewSchema.safeParse(candidate).success) payload = candidate;
  } catch {
    /* Incomplete input stays editable until submit. */
  }
  const serialized = payload ? JSON.stringify(payload) : "";
  useEffect(() => {
    document.title = "Price preview · SubTrack";
  }, []);
  useEffect(() => {
    setPreview(null);
    setError("");
    setPreviewStatus("");
    if (!serialized) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setPreviewStatus("Updating price.");
    const timer = window.setTimeout(() => {
      request<CatalogPreview>("/api/catalog/preview", {
        method: "POST",
        body: JSON.parse(serialized),
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) {
            setPreview(value);
            setPreviewStatus(
              `Price updated. Total ${formatMoney(value.total)}.`,
            );
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setError(errorMessage(reason));
            setPreviewStatus("");
            if (reason instanceof RequestError) setFields(reason.fields);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serialized, revision]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const body = { planId, lines: lineInputs(lines) };
      const invalid = validateForm(
        catalogPreviewSchema,
        body,
        event.currentTarget,
      );
      setFields(invalid || {});
      if (!invalid) setRevision((value) => value + 1);
    } catch (reason) {
      if (reason instanceof InputProblem) {
        setFields({ [reason.field]: reason.message });
        inputFocus(event.currentTarget, reason.field);
      }
    }
  }
  return (
    <>
      {sectionTitle(
        "Price preview",
        "See the current plan price, variant adjustment and configured tax before preparing an offering.",
      )}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {previewStatus}
      </div>
      <div className="price-preview-layout">
        <form
          className="panel catalog-editor"
          noValidate
          aria-label="Price preview"
          onSubmit={submit}
        >
          <RecordSelect<Plan>
            resource="plans"
            name="planId"
            label="Recurring plan"
            value={planId}
            error={fields.planId}
            onChange={(id, record) => {
              setPlanId(id);
              setFields({});
              setLines(
                record
                  ? [
                      {
                        productId: record.primaryProductId,
                        variantId: null,
                        quantity: String(record.minQuantity),
                      },
                    ]
                  : [],
              );
            }}
          />
          <LineEditor
            lines={lines}
            fields={fields}
            primaryProductId={plan.data?.primaryProductId}
            onChange={(value) => {
              setLines(value);
              setFields({});
            }}
          />
          <Button type="submit" busy={busy}>
            <Calculator size={17} />
            Refresh price
          </Button>
          <p className="footnote">
            Changing a selection refreshes the server calculation. This preview
            creates no quotation or charge.
          </p>
        </form>
        <section
          className="panel calculation-panel"
          aria-labelledby="calculation-title"
        >
          <h3 id="calculation-title">Amount breakdown</h3>
          {error ? (
            <Feedback tone="error">{error}</Feedback>
          ) : busy ? (
            <div aria-hidden="true">
              <Loading>Calculating the current price…</Loading>
            </div>
          ) : !preview ? (
            <EmptyState
              icon={<Calculator size={27} />}
              title="Start with a plan."
            >
              Choose a plan and product lines to see the server-calculated
              amount.
            </EmptyState>
          ) : (
            <>
              <AmountBreakdown value={preview} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
