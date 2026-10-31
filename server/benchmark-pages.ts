import { expect, type Page, type Locator } from "@playwright/test";
import type { BenchmarkManifest } from "./benchmark-data.js";

/** Read-only browser inventory. No descriptor confirms a mutation or sends mail. */
export type BenchmarkRole = "public" | "admin" | "staff" | "customer";
export type BenchmarkCategory =
  | "identity"
  | "workspace"
  | "configuration"
  | "agreements"
  | "billing"
  | "finance"
  | "portal"
  | "authorization";
export interface BenchmarkPageDescriptor {
  id: string;
  category: BenchmarkCategory;
  role: BenchmarkRole;
  path: string;
  /** GET endpoints measured separately from rendered navigation; never POST a financial action. */
  apiPaths: string[];
  readiness: string;
  /** Optional untimed setup. The harness starts navigation timing only afterwards. */
  prepare?: (page: Page) => Promise<void>;
  /** Real data and useful controls. The harness then waits fonts.ready and two animation frames. */
  ready: (page: Page) => Promise<void>;
}
export interface BenchmarkActionDescriptor {
  id: string;
  category: BenchmarkCategory;
  role: BenchmarkRole;
  path: string;
  apiPaths: string[];
  readiness: string;
  /** Establish initial usable state before timing; must not change business records. */
  prepare?: (page: Page) => Promise<void>;
  /** Timed interaction; allowed POSTs are calculation previews only. */
  run: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}
export type BenchmarkPage = BenchmarkPageDescriptor;
export type BenchmarkAction = BenchmarkActionDescriptor;

const exact = { exact: true };
const nonempty = /\S/;
const byLabel = (page: Page, label: string) => page.getByLabel(label, exact);
const button = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true });
async function usable(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
}
async function settled(page: Page) {
  await expect(page.locator(".loading-region:visible")).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator(".feedback.error:visible")).toHaveCount(0);
}
async function rowsReady(page: Page, region: string, search?: string) {
  const panel = page.getByRole("region", { name: region, exact: true });
  await expect(panel.locator("tbody tr").first()).toBeVisible();
  if (search) await usable(byLabel(page, search));
  const customer = byLabel(page, "Customer");
  if (await customer.count()) await expect(customer).toBeEnabled();
  await expect(
    panel.locator('.pagination [aria-current="page"]'),
  ).toBeVisible();
  await settled(page);
}
async function formReady(
  page: Page,
  name: string,
  labels: string[],
  submit: string,
) {
  await expect(page.getByRole("form", { name, exact: true })).toBeVisible();
  for (const label of labels) await usable(byLabel(page, label));
  await usable(button(page, submit));
  await settled(page);
}
async function workspaceReady(page: Page, customer = false) {
  await expect(
    page.getByRole("heading", {
      name: customer ? "Your workspace" : "Workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Database connected", exact)).toBeVisible();
  await expect(page.locator(".account-sheet dd").first()).toHaveText(nonempty);
  await usable(button(page, "Refresh"));
  await settled(page);
}
async function agreementReady(page: Page, stage?: string) {
  await expect(page.locator("h1")).toHaveText(/^(?:BENCH-)?SUB-/);
  await expect(page.locator(".agreement-terms dd").first()).toHaveText(
    nonempty,
  );
  await expect(page.locator(".calculation-line").first()).toBeVisible();
  await expect(
    page.locator(".calculation-totals .grand-total dd"),
  ).toContainText("₹");
  await expect(page.locator(".agreement-history li").first()).toBeVisible();
  if (stage)
    await expect(
      page.locator('.stage-strip [aria-current="step"]'),
    ).toContainText(stage);
  await usable(
    page.getByRole("button", { name: "Refresh agreement", exact: true }),
  );
  await settled(page);
}
async function serviceReady(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Manage service", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".service-context")).toContainText("Expiry");
  await expect(page.locator(".service-addons article").first()).toBeVisible();
  await usable(button(page, "Refresh service"));
  await settled(page);
}
async function invoiceReady(page: Page, status?: string, internal = true) {
  await expect(page.locator("h1")).toHaveText(/^(?:BENCH-)?INV-/);
  await expect(page.locator(".invoice-period dd").first()).toHaveText(nonempty);
  await expect(page.locator(".calculation-line").first()).toBeVisible();
  await expect(
    page.locator(".calculation-totals .grand-total dd"),
  ).toContainText("₹");
  await expect(page.locator(".agreement-history li").first()).toBeVisible();
  await usable(button(page, "Refresh payments"));
  await usable(page.getByRole("link", { name: /^Open print view/ }));
  if (status)
    await expect(page.locator(".agreement-context .status").first()).toHaveText(
      status,
    );
  if (internal && status !== "Canceled")
    await usable(button(page, "Send invoice"));
  await settled(page);
}
async function printReady(page: Page) {
  await expect(page.locator(".paper h1")).toHaveText(/^(?:BENCH-)?INV-/);
  await expect(page.locator(".paper tbody tr").first()).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Invoice totals", exact: true })
      .locator("dd")
      .first(),
  ).toContainText("₹");
  await usable(button(page, "Print invoice"));
}
async function financeReady(page: Page, overview: boolean) {
  await expect(page.locator(".finance-metric")).toHaveCount(overview ? 5 : 1);
  await expect(page.locator(".finance-metric strong").first()).toHaveText(
    nonempty,
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Finance updated." }),
  ).toHaveText(/Finance updated\./);
  await usable(button(page, "Refresh finance"));
  await expect(byLabel(page, "Customer")).toBeEnabled();
  if (overview)
    await expect(page.locator(".finance-definitions summary")).toBeVisible();
  else await rowsReady(page, "Finance records");
  await settled(page);
}
async function catalogDetailReady(page: Page, kind: string) {
  await expect(page.locator(".catalog-section-title h2").last()).toHaveText(
    nonempty,
  );
  await expect(page.locator(".catalog-detail dd").first()).toHaveText(nonempty);
  if (kind === "products")
    await expect(page.locator(".detail-lines strong").first()).toHaveText(
      nonempty,
    );
  if (kind === "quotation-templates")
    await expect(page.locator(".detail-lines a").first()).not.toHaveText(
      "Loading product…",
    );
  await settled(page);
}
async function discountReady(page: Page) {
  await expect(page.locator(".discount-detail dd").first()).toHaveText(
    nonempty,
  );
  await expect(page.locator(".rule-usage dd")).toHaveCount(3);
  await usable(button(page, "Refresh discount usage"));
  await settled(page);
}
async function draftReady(page: Page, edit: boolean, populated = false) {
  await formReady(
    page,
    edit ? "Edit subscription draft" : "New subscription draft",
    [
      "Customer",
      "Offering source",
      "Service start date",
      "Term length (billing periods)",
      "Payment terms (days)",
    ],
    edit ? "Save draft changes" : "Save draft",
  );
  await expect(byLabel(page, "Recurring plan")).toBeVisible();
  if (!populated) await usable(byLabel(page, "Recurring plan"));
  if (populated) {
    await expect(byLabel(page, "Recurring plan")).not.toHaveValue("");
    await expect(byLabel(page, "Line 1 quantity")).toHaveValue(/^[1-9]/);
  }
}
async function queueReady(page: Page, exceptions = false) {
  await rowsReady(page, "Billing queue", "Search billing queue");
  await usable(byLabel(page, "Queue view"));
  if (!exceptions) await usable(button(page, "Review billing run"));
}
async function runReady(page: Page) {
  await expect(
    page.getByRole("region", { name: "Run results", exact: true }),
  ).toContainText("periods processed");
  await rowsReady(page, "Period outcomes");
  await usable(button(page, "Refresh results"));
}
const query = (values: Record<string, string>) =>
  new URLSearchParams(values).toString();

/** One descriptor per route/form, plus meaningful role/state variants, not invented destinations. */
export function buildBenchmarkPages(
  manifest: BenchmarkManifest,
): BenchmarkPageDescriptor[] {
  const pages: BenchmarkPageDescriptor[] = [];
  const { samples: sample } = manifest;
  const add = (
    id: string,
    category: BenchmarkCategory,
    role: BenchmarkRole,
    path: string,
    apiPaths: string[],
    readiness: string,
    ready: BenchmarkPageDescriptor["ready"],
  ) => pages.push({ id, category, role, path, apiPaths, readiness, ready });
  const common = ["/api/session", "/api/environment"];
  const endpoints = (...paths: string[]) => [...common, ...paths];
  const listApi = (path: string) => `${path}?page=1&pageSize=20`;
  const customerOptions = "/api/customers?q=&pageSize=100";
  const productOptions = "/api/products?active=true&q=&pageSize=100";
  const planOptions = "/api/plans?active=true&q=&pageSize=100";
  const templateOptions =
    "/api/quotation-templates?active=true&q=&pageSize=100";
  const november = query({
    invoiceFrom: "2026-11-01",
    invoiceTo: "2026-11-30",
    paymentFrom: "2026-11-01",
    paymentTo: "2026-11-30",
  });

  add(
    "public.login",
    "identity",
    "public",
    "/login",
    common,
    "Email/password fields and Sign in enabled after session resolution.",
    (page) =>
      formReady(page, "Sign in", ["Email address", "Password"], "Sign in"),
  );
  add(
    "public.signup",
    "identity",
    "public",
    "/signup",
    common,
    "All signup fields, password requirements and create control usable.",
    (page) =>
      formReady(
        page,
        "Create customer account",
        ["Full name", "Email address", "Password"],
        "Create account",
      ),
  );
  add(
    "public.forgot-password",
    "identity",
    "public",
    "/forgot-password",
    common,
    "Registered-email input and reset request control enabled; no email sent.",
    (page) =>
      formReady(
        page,
        "Request password reset",
        ["Email address"],
        "Request reset link",
      ),
  );
  add(
    "public.reset-password",
    "identity",
    "public",
    `/reset-password#token=${sample.resetToken}`,
    common,
    "Valid unconsumed synthetic reset token displays the enabled new-password form; no reset attempted.",
    (page) =>
      formReady(page, "Set new password", ["New password"], "Update password"),
  );
  add(
    "public.reset-missing-token",
    "identity",
    "public",
    "/reset-password",
    common,
    "Missing-token recovery message and request-new-link control rendered.",
    async (page) => {
      await expect(page.getByRole("alert")).toContainText("missing its token");
      await usable(
        page.getByRole("link", {
          name: "Request a new reset link.",
          exact: true,
        }),
      );
    },
  );

  for (const role of ["admin", "staff", "customer"] as const)
    add(
      `${role}.workspace`,
      role === "customer" ? "portal" : "workspace",
      role,
      "/workspace",
      endpoints("/api/workspace", "/api/health"),
      "Account identity, real database connectivity and refresh control usable.",
      (page) => workspaceReady(page, role === "customer"),
    );
  add(
    "admin.staff-list",
    "workspace",
    "admin",
    "/staff",
    endpoints(listApi("/api/staff")),
    "Saved staff rows and search/pagination loaded.",
    (page) => rowsReady(page, "Staff accounts", "Search by name or email"),
  );
  add(
    "admin.add-staff",
    "workspace",
    "admin",
    "/staff/new",
    common,
    "All staff account fields and add control enabled; no account created.",
    (page) =>
      formReady(
        page,
        "Add staff member",
        ["Full name", "Email address", "Initial password"],
        "Add staff member",
      ),
  );
  add(
    "admin.email-activity",
    "workspace",
    "admin",
    "/deliveries",
    endpoints(listApi("/api/deliveries")),
    "Persisted email metadata or truthful empty state, with refresh enabled.",
    async (page) => {
      const panel = page.getByRole("region", {
        name: "Email activity",
        exact: true,
      });
      await expect(
        panel
          .locator("tbody tr")
          .or(
            panel.getByRole("heading", {
              name: "No email activity yet.",
              exact: true,
            }),
          )
          .first(),
      ).toBeVisible();
      await usable(button(page, "Refresh"));
      await settled(page);
    },
  );

  const configurations = [
    {
      kind: "products",
      title: "Products",
      form: "product",
      id: sample.productId,
      input: "Product name",
      fields: [
        "Product name",
        "Product type",
        "Sales price (INR)",
        "Cost price (INR)",
      ],
      save: "Save product",
      options: [],
    },
    {
      kind: "plans",
      title: "Recurring plans",
      form: "plan",
      id: sample.planId,
      input: "Plan name",
      fields: [
        "Plan name",
        "Primary product",
        "Recurring unit price (INR)",
        "Billing interval",
      ],
      save: "Save plan",
      options: [productOptions],
    },
    {
      kind: "taxes",
      title: "Tax rules",
      form: "tax rule",
      id: sample.taxId,
      input: "Tax rule name",
      fields: ["Tax rule name", "Tax rate (%)", "Tax scope"],
      save: "Save tax rule",
      options: [],
    },
    {
      kind: "quotation-templates",
      title: "Quotation templates",
      form: "quotation template",
      id: sample.templateId,
      input: "Template name",
      fields: ["Template name", "Recurring plan", "Quotation validity (days)"],
      save: "Save template",
      options: [planOptions],
    },
  ];
  for (const config of configurations) {
    const path = `/configuration/${config.kind}`,
      api = `/api/${config.kind}`;
    add(
      `admin.configuration.${config.kind}.list`,
      "configuration",
      "admin",
      path,
      endpoints(listApi(api)),
      "Actual catalog rows, search and pagination usable.",
      (page) =>
        rowsReady(page, config.title, `Search ${config.title.toLowerCase()}`),
    );
    add(
      `admin.configuration.${config.kind}.detail`,
      "configuration",
      "admin",
      `${path}/${config.id}`,
      endpoints(
        `${api}/${config.id}`,
        ...(config.kind === "quotation-templates"
          ? [`/api/products/${sample.productId}`]
          : []),
      ),
      "Saved fields and nested product/variant data loaded.",
      (page) => catalogDetailReady(page, config.kind),
    );
    for (const edit of [false, true]) {
      add(
        `admin.configuration.${config.kind}.${edit ? "edit" : "new"}`,
        "configuration",
        "admin",
        edit ? `${path}/${config.id}/edit` : `${path}/new`,
        endpoints(...config.options, ...(edit ? [`${api}/${config.id}`] : [])),
        "Named form, available-record selectors, all primary inputs and save control enabled; no save.",
        async (page) => {
          await formReady(
            page,
            `${edit ? "Edit" : "New"} ${config.form}`,
            config.fields,
            config.save,
          );
          if (edit)
            await expect(byLabel(page, config.input)).toHaveValue(nonempty);
        },
      );
    }
  }
  add(
    "staff.configuration.products.detail",
    "configuration",
    "staff",
    `/configuration/products/${sample.productId}`,
    endpoints(`/api/products/${sample.productId}`),
    "Staff-readable product/variant prices loaded without admin cost controls.",
    async (page) => {
      await catalogDetailReady(page, "products");
      await expect(page.getByText("Internal cost price", exact)).toHaveCount(0);
    },
  );
  add(
    "staff.configuration.plans.list",
    "configuration",
    "staff",
    "/configuration/plans",
    endpoints(listApi("/api/plans")),
    "Staff-readable plan rows and search/pagination loaded.",
    (page) => rowsReady(page, "Recurring plans", "Search recurring plans"),
  );
  for (const role of ["admin", "staff"] as const) {
    add(
      `${role}.configuration.discounts.list`,
      "configuration",
      role,
      "/configuration/discounts",
      endpoints(listApi("/api/discounts")),
      "Saved discount rows, scope/usage counts and search usable.",
      (page) => rowsReady(page, "Discount rules", "Search discount rules"),
    );
    add(
      `${role}.configuration.discounts.detail`,
      "configuration",
      role,
      `/configuration/discounts/${sample.discountId}`,
      endpoints(`/api/discounts/${sample.discountId}`),
      "Actual rule, reservation/consumption/remaining counts and refresh loaded.",
      discountReady,
    );
  }
  for (const edit of [false, true])
    add(
      `admin.configuration.discounts.${edit ? "edit" : "new"}`,
      "configuration",
      "admin",
      edit
        ? `/configuration/discounts/${sample.discountId}/edit`
        : "/configuration/discounts/new",
      endpoints(...(edit ? [`/api/discounts/${sample.discountId}`] : [])),
      "Discount input form and save control ready without submitting.",
      async (page) => {
        await formReady(
          page,
          edit ? "Edit discount rule" : "New discount rule",
          ["Discount rule name", "Discount type", "Discount scope"],
          "Save discount rule",
        );
        if (edit)
          await expect(byLabel(page, "Discount rule name")).toHaveValue(
            nonempty,
          );
      },
    );
  add(
    "admin.configuration.preview",
    "configuration",
    "admin",
    "/configuration/preview",
    endpoints(planOptions),
    "Plan options loaded, refresh control usable and honest initial preview state.",
    async (page) => {
      await formReady(
        page,
        "Price preview",
        ["Recurring plan"],
        "Refresh price",
      );
      await expect(
        page.getByRole("heading", { name: "Start with a plan.", exact: true }),
      ).toBeVisible();
    },
  );

  for (const role of ["admin", "staff", "customer"] as const) {
    add(
      `${role}.subscriptions.list`,
      role === "customer" ? "portal" : "agreements",
      role,
      "/subscriptions",
      endpoints(
        "/api/subscriptions?q=&page=1&pageSize=20",
        "/api/workspace",
        ...(role === "customer" ? [] : [customerOptions]),
      ),
      "Real agreement rows and stage/search/pagination controls ready within the role scope.",
      (page) => rowsReady(page, "Subscription records", "Search subscriptions"),
    );
    add(
      `${role}.invoices.list`,
      role === "customer" ? "portal" : "billing",
      role,
      "/billing/invoices",
      endpoints(
        "/api/invoices?q=&page=1&pageSize=20",
        ...(role === "customer" ? [] : [customerOptions]),
      ),
      "Actual invoice rows, balances and search/filter/pagination usable.",
      (page) => rowsReady(page, "Invoice records", "Search invoices"),
    );
  }
  for (const role of ["admin", "staff"] as const) {
    add(
      `${role}.customers.list`,
      "workspace",
      role,
      "/customers",
      endpoints("/api/customers?q=&page=1&pageSize=20"),
      "Customer directory rows and usable search/pagination.",
      (page) => rowsReady(page, "Customer accounts", "Search by name or email"),
    );
    add(
      `${role}.subscriptions.new`,
      "agreements",
      role,
      "/subscriptions/new",
      endpoints(customerOptions, planOptions),
      "Customer/plan selectors, commercial dates and create control ready; no draft created.",
      (page) => draftReady(page, false),
    );
  }
  add(
    "admin.subscriptions.new-from-template",
    "agreements",
    "admin",
    `/subscriptions/new?templateId=${sample.templateId}`,
    endpoints(
      customerOptions,
      templateOptions,
      `/api/quotation-templates/${sample.templateId}`,
      `/api/plans/${sample.planId}`,
      productOptions,
    ),
    "Template and plan loaded with copied product lines and usable draft fields.",
    (page) => draftReady(page, false, true),
  );
  add(
    "admin.subscriptions.edit-draft",
    "agreements",
    "admin",
    `/subscriptions/${sample.subscriptions.draft}/edit`,
    endpoints(
      `/api/subscriptions/${sample.subscriptions.draft}`,
      customerOptions,
      planOptions,
      productOptions,
    ),
    "Existing draft values and line selectors loaded with save enabled; no save.",
    (page) => draftReady(page, true, true),
  );
  for (const [key, stage] of [
    ["draft", "Draft"],
    ["quotation", "Quotation"],
    ["confirmed", "Confirmed"],
    ["future", "Confirmed"],
    ["running", "Active"],
    ["paused", "Active"],
    ["closed", "Closed"],
    ["termEnded", "Active"],
  ] as const) {
    const id = sample.subscriptions[key];
    add(
      `admin.subscriptions.detail.${key}`,
      "agreements",
      "admin",
      `/subscriptions/${id}`,
      endpoints(
        `/api/subscriptions/${id}`,
        `/api/invoices?subscriptionId=${id}&pageSize=5`,
      ),
      "Saved customer/terms, price lines, persisted history, stage and next permitted controls loaded.",
      (page) => agreementReady(page, stage),
    );
  }
  for (const [role, key] of [
    ["admin", "running"],
    ["admin", "paused"],
    ["admin", "termEnded"],
    ["staff", "running"],
    ["customer", "customerOwn"],
  ] as const) {
    const id = sample.subscriptions[key];
    add(
      `${role}.service.${key}`,
      role === "customer" ? "portal" : "agreements",
      role,
      `/subscriptions/${id}/service`,
      endpoints(`/api/subscriptions/${id}/lifecycle`),
      "Current service, real expiry, accepted add-on lines and service refresh usable.",
      serviceReady,
    );
  }
  add(
    "admin.service-processing",
    "agreements",
    "admin",
    "/subscriptions/service-processing",
    common,
    "Processing limit and review control enabled; no lifecycle processing executed.",
    (page) =>
      formReady(
        page,
        "Process due service changes",
        ["Agreement limit"],
        "Review service processing",
      ),
  );
  for (const role of ["staff", "customer"] as const) {
    const id =
      sample.subscriptions[role === "customer" ? "customerOwn" : "running"];
    add(
      `${role}.subscriptions.detail`,
      role === "customer" ? "portal" : "agreements",
      role,
      `/subscriptions/${id}`,
      endpoints(
        `/api/subscriptions/${id}`,
        `/api/invoices?subscriptionId=${id}&pageSize=5`,
      ),
      "Scoped saved agreement terms, period amount and activity loaded.",
      (page) => agreementReady(page),
    );
  }

  for (const [key, status] of [
    ["draft", "Draft"],
    ["confirmed", "Confirmed"],
    ["partial", "Confirmed"],
    ["paid", "Paid"],
    ["canceled", "Canceled"],
    ["zero", "Paid"],
  ] as const) {
    const id = sample.invoices[key];
    add(
      `admin.invoices.detail.${key}`,
      "billing",
      "admin",
      `/billing/invoices/${id}`,
      endpoints(
        `/api/invoices/${id}`,
        `/api/invoices/${id}/payments?page=1&pageSize=20`,
      ),
      "Saved line/tax/discount totals, current settlement, activity, payment history and output controls ready.",
      (page) => invoiceReady(page, status),
    );
  }
  for (const role of ["staff", "customer"] as const) {
    const id = sample.invoices[role === "customer" ? "customerOwn" : "partial"];
    add(
      `${role}.invoices.detail`,
      role === "customer" ? "portal" : "billing",
      role,
      `/billing/invoices/${id}`,
      endpoints(
        `/api/invoices/${id}`,
        `/api/invoices/${id}/payments?page=1&pageSize=20`,
      ),
      "Role-scoped invoice amounts and loaded payment history; no hidden internal notes in portal.",
      (page) => invoiceReady(page, undefined, role !== "customer"),
    );
  }
  const due = sample.subscriptions.due;
  add(
    "admin.invoices.generate-preview",
    "billing",
    "admin",
    `/billing/subscriptions/${due}/generate`,
    endpoints(`/api/subscriptions/${due}`),
    "Due period, server-calculated invoice lines and Generate draft invoice review control ready; no generation.",
    async (page) => {
      await expect(page.locator(".invoice-period dd").first()).toHaveText(
        nonempty,
      );
      await expect(page.locator(".calculation-line").first()).toBeVisible();
      await usable(button(page, "Generate draft invoice"));
      await settled(page);
    },
  );
  add(
    "admin.invoices.replacement-preview",
    "billing",
    "admin",
    `/billing/invoices/${sample.invoices.canceled}/replace`,
    endpoints(`/api/invoices/${sample.invoices.canceled}`),
    "Saved canceled original and recalculated replacement comparison plus review control usable; no replacement.",
    async (page) => {
      await expect(page.locator(".replacement-comparison strong")).toHaveCount(
        2,
      );
      await expect(page.locator(".calculation-line").first()).toBeVisible();
      await usable(button(page, "Create replacement draft"));
      await settled(page);
    },
  );
  add(
    "admin.payments.new",
    "billing",
    "admin",
    `/billing/invoices/${sample.invoices.partial}/payments/new`,
    endpoints(`/api/invoices/${sample.invoices.partial}`),
    "Authoritative outstanding balance and all payment inputs/review enabled; no payment recorded.",
    (page) =>
      formReady(
        page,
        "Record invoice payment",
        [
          "Payment amount (INR)",
          "Payment method",
          "Payment date",
          "Internal payment note",
        ],
        "Review payment",
      ),
  );
  for (const role of ["admin", "customer"] as const) {
    const id =
      sample.invoices[role === "customer" ? "customerOwn" : "confirmed"];
    add(
      `${role}.invoices.print`,
      role === "customer" ? "portal" : "billing",
      role,
      `/api/invoices/${id}/print`,
      [`/api/invoices/${id}/print`],
      "Authenticated saved HTML invoice, actual product rows/totals and print control ready; printing not invoked.",
      printReady,
    );
  }
  for (const [role, exceptions] of [
    ["admin", false],
    ["admin", true],
    ["staff", false],
  ] as const)
    add(
      `${role}.billing.queue.${exceptions ? "exceptions" : "due"}`,
      "billing",
      role,
      `/billing/workbench${exceptions ? "?view=exceptions" : ""}`,
      endpoints(
        `/api/billing/queue?view=${exceptions ? "exceptions" : "due"}&q=&page=1&pageSize=20`,
        customerOptions,
      ),
      "Persisted due/exception rows and useful queue controls loaded; no run started.",
      (page) => queueReady(page, exceptions),
    );
  add(
    "admin.billing.runs",
    "billing",
    "admin",
    "/billing/runs",
    endpoints("/api/billing/runs?q=&page=1&pageSize=20"),
    "Persisted run rows and searchable run history usable.",
    (page) => rowsReady(page, "Billing runs", "Search billing runs"),
  );
  add(
    "admin.billing.run-detail",
    "billing",
    "admin",
    `/billing/runs/${sample.billingRunId}`,
    endpoints(
      `/api/billing/runs/${sample.billingRunId}`,
      `/api/billing/runs/${sample.billingRunId}/items?page=1&pageSize=20`,
    ),
    "Saved run counts, period outcomes and refresh loaded; no retry executed.",
    runReady,
  );

  add(
    "admin.finance.unfiltered",
    "finance",
    "admin",
    "/finance",
    endpoints("/api/finance/summary", customerOptions),
    "All-date dataset-wide values and their scope loaded, not only the narrower November cohort.",
    (page) => financeReady(page, true),
  );
  for (const role of ["admin", "staff"] as const)
    add(
      `${role}.finance.overview`,
      "finance",
      role,
      `/finance?${november}`,
      endpoints(`/api/finance/summary?${november}`, customerOptions),
      "Five whole-filter values, applied separate date scope and usable refresh loaded.",
      (page) => financeReady(page, true),
    );
  for (const [view, extra] of [
    ["agreements", ""],
    ["invoices", "&view=invoiced"],
    ["invoices", "&view=outstanding"],
    ["invoices", "&view=overdue"],
    ["payments", ""],
  ] as const) {
    const suffix = extra ? extra.slice(6) : view;
    add(
      `admin.finance.${suffix}`,
      "finance",
      "admin",
      `/finance/${view}?${november}${extra}`,
      endpoints(
        `/api/finance/summary?${november}`,
        `/api/finance/${view}?${november}&page=1&pageSize=20${extra}`,
        customerOptions,
      ),
      "Current-view full-filter amount/count, populated matching records and pagination loaded.",
      (page) => financeReady(page, false),
    );
  }
  add(
    "admin.finance.customer-filtered",
    "finance",
    "admin",
    `/finance?${november}&customerId=${manifest.accounts.customer.id}`,
    endpoints(
      `/api/finance/summary?${november}&customerId=${manifest.accounts.customer.id}`,
      customerOptions,
    ),
    "Real selected customer name, five exact scoped values and usable filter controls loaded.",
    async (page) => {
      await financeReady(page, true);
      await expect(page.locator(".finance-applied-scope")).not.toContainText(
        "Customer unavailable",
      );
      await expect(page.locator(".finance-applied-scope")).not.toContainText(
        "Loading customer",
      );
    },
  );
  add(
    "customer.finance-denied",
    "authorization",
    "customer",
    "/finance",
    common,
    "Explicit role denial and usable return-to-workspace control.",
    async (page) => {
      await expect(
        page.getByRole("heading", {
          name: "This area is restricted.",
          exact: true,
        }),
      ).toBeVisible();
      await usable(
        page.getByRole("link", { name: "Back to your workspace", exact: true }),
      );
    },
  );
  add(
    "staff.admin-form-denied",
    "authorization",
    "staff",
    "/configuration/products/new",
    common,
    "Staff sees explicit denied admin form, not a fake editable form.",
    async (page) => {
      await expect(
        page.getByRole("heading", {
          name: "This area is restricted.",
          exact: true,
        }),
      ).toBeVisible();
      await usable(
        page.getByRole("link", { name: "Back to your workspace", exact: true }),
      );
    },
  );
  return pages;
}

/** Search/filter/page changes measure actual user input through returned, rendered records. */
export function buildBenchmarkActions(
  manifest: BenchmarkManifest,
): BenchmarkActionDescriptor[] {
  const actions: BenchmarkActionDescriptor[] = [];
  const customerId = manifest.accounts.customer.id;
  const add = (value: BenchmarkActionDescriptor) => actions.push(value);
  for (const [route, region, search, prefix, api] of [
    [
      "/subscriptions",
      "Subscription records",
      "Search subscriptions",
      "SUB-",
      "/api/subscriptions",
    ],
    [
      "/billing/invoices",
      "Invoice records",
      "Search invoices",
      "INV-",
      "/api/invoices",
    ],
    [
      "/billing/workbench",
      "Billing queue",
      "Search billing queue",
      "SUB-",
      "/api/billing/queue",
    ],
  ] as const) {
    add({
      id: `search.${region.toLowerCase().replaceAll(" ", "-")}`,
      category: route === "/subscriptions" ? "agreements" : "billing",
      role: "staff",
      path: route,
      apiPaths: [`${api}?q=${encodeURIComponent(prefix)}&page=1&pageSize=20`],
      readiness:
        "Committed search query, matching persisted first row and enabled search after render.",
      prepare: (page) => rowsReady(page, region, search),
      run: async (page) => {
        await byLabel(page, search).fill(prefix);
        await byLabel(page, search).press("Enter");
      },
      ready: async (page) => {
        await expect(page).toHaveURL(
          new RegExp(`q=${encodeURIComponent(prefix)}`),
        );
        await rowsReady(page, region, search);
        await expect(
          page
            .getByRole("region", { name: region, exact: true })
            .locator("tbody tr")
            .first(),
        ).toContainText(prefix);
      },
    });
    add({
      id: `pagination.${region.toLowerCase().replaceAll(" ", "-")}`,
      category: route === "/subscriptions" ? "agreements" : "billing",
      role: "staff",
      path: route,
      apiPaths: [`${api}?page=2&pageSize=20`],
      readiness:
        "Second page URL, data rows, page marker and enabled Previous; no stale first-page completion.",
      prepare: async (page) => {
        await rowsReady(page, region, search);
        await usable(button(page, "Next"));
      },
      run: async (page) => {
        await button(page, "Next").click();
      },
      ready: async (page) => {
        await expect(page).toHaveURL(/page=2/);
        await rowsReady(page, region, search);
        await expect(
          page.locator('.pagination [aria-current="page"]'),
        ).toHaveText(/^Page 2 of/);
        await usable(button(page, "Previous"));
      },
    });
  }
  for (const [path, region, label, param, value] of [
    ["/subscriptions", "Subscription records", "Stage", "stage", "Active"],
    [
      "/billing/invoices",
      "Invoice records",
      "Invoice status",
      "status",
      "Confirmed",
    ],
    ["/billing/workbench", "Billing queue", "Queue view", "view", "exceptions"],
  ] as const)
    add({
      id: `filter.${param}.${value.toLowerCase()}`,
      category: path === "/subscriptions" ? "agreements" : "billing",
      role: "staff",
      path,
      apiPaths: [
        `${path === "/subscriptions" ? "/api/subscriptions" : path === "/billing/invoices" ? "/api/invoices" : "/api/billing/queue"}?${param}=${value}&page=1&pageSize=20`,
      ],
      readiness:
        "Filter URL and selected control match returned populated records.",
      prepare: (page) => rowsReady(page, region),
      run: async (page) => {
        await byLabel(page, label).selectOption(value);
      },
      ready: async (page) => {
        await expect(page).toHaveURL(new RegExp(`${param}=${value}`));
        await rowsReady(page, region);
        await expect(byLabel(page, label)).toHaveValue(value);
      },
    });
  add({
    id: "finance.apply-separate-date-ranges",
    category: "finance",
    role: "staff",
    path: "/finance",
    apiPaths: [
      "/api/finance/summary?invoiceFrom=2026-11-01&invoiceTo=2026-11-30&paymentFrom=2026-11-01&paymentTo=2026-11-30",
    ],
    readiness:
      "Applied invoice/payment dates reflected in URL, five newly calculated whole-filter values and final live announcement.",
    prepare: async (page) => {
      await financeReady(page, true);
      if (
        !(
          (await page
            .locator(".finance-filter-disclosure")
            .getAttribute("open")) !== null
        )
      )
        await page.locator(".finance-filter-disclosure > summary").click();
      await byLabel(page, "Invoice issued from").fill("2026-11-01");
      await byLabel(page, "Invoice issued through").fill("2026-11-30");
      await byLabel(page, "Payment received from").fill("2026-11-01");
      await byLabel(page, "Payment received through").fill("2026-11-30");
    },
    run: async (page) => {
      await button(page, "Apply filters").click();
    },
    ready: async (page) => {
      await expect(page).toHaveURL(/invoiceFrom=2026-11-01/);
      await expect(page).toHaveURL(/paymentTo=2026-11-30/);
      await financeReady(page, true);
    },
  });
  add({
    id: "finance.paginate-invoices",
    category: "finance",
    role: "staff",
    path: "/finance/invoices?view=invoiced",
    apiPaths: [
      "/api/finance/summary",
      "/api/finance/invoices?view=invoiced&page=2&pageSize=20",
    ],
    readiness:
      "Second invoice page rendered while whole-filter total remains available.",
    prepare: async (page) => {
      await financeReady(page, false);
      await usable(button(page, "Next"));
    },
    run: async (page) => {
      await button(page, "Next").click();
    },
    ready: async (page) => {
      await expect(page).toHaveURL(/page=2/);
      await financeReady(page, false);
      await expect(
        page.locator('.pagination [aria-current="page"]'),
      ).toHaveText(/^Page 2 of/);
    },
  });
  add({
    id: "agreements.customer-filter",
    category: "agreements",
    role: "staff",
    path: "/subscriptions",
    apiPaths: [
      `/api/subscriptions?customerId=${customerId}&page=1&pageSize=20`,
    ],
    readiness:
      "Customer filter value, URL and own matching agreement rows loaded.",
    prepare: async (page) => {
      await rowsReady(page, "Subscription records");
      await usable(byLabel(page, "Customer"));
      const option = byLabel(page, "Customer").locator(
        `option[value="${customerId}"]`,
      );
      if (!(await option.count())) {
        const search = byLabel(page, "Search customer options");
        await usable(search);
        await search.fill(manifest.accounts.customer.email);
        await search.press("Enter");
      }
      await expect(
        byLabel(page, "Customer").locator(`option[value="${customerId}"]`),
      ).toHaveCount(1);
    },
    run: async (page) => {
      await byLabel(page, "Customer").selectOption(customerId);
    },
    ready: async (page) => {
      await expect(page).toHaveURL(new RegExp(`customerId=${customerId}`));
      await rowsReady(page, "Subscription records");
      await expect(byLabel(page, "Customer")).toHaveValue(customerId);
    },
  });
  add({
    id: "catalog.price-preview",
    category: "configuration",
    role: "admin",
    path: "/configuration/preview",
    apiPaths: [
      `/api/plans/${manifest.samples.planId}`,
      `/api/products/${manifest.samples.productId}`,
    ],
    readiness:
      "Selecting a real plan produces authoritative price lines/total and an updated live announcement; no business record created.",
    prepare: (page) =>
      formReady(page, "Price preview", ["Recurring plan"], "Refresh price"),
    run: async (page) => {
      await byLabel(page, "Recurring plan").selectOption(
        manifest.samples.planId,
      );
    },
    ready: async (page) => {
      await expect(page.locator(".calculation-line").first()).toBeVisible();
      await expect(
        page.locator(".calculation-totals .grand-total dd"),
      ).toContainText("₹");
      await expect(
        page.getByRole("status").filter({ hasText: "Price updated." }),
      ).toHaveText(/Price updated\. Total ₹/);
      await usable(button(page, "Refresh price"));
      await settled(page);
    },
  });
  add({
    id: "agreements.search-empty",
    category: "agreements",
    role: "staff",
    path: "/subscriptions",
    apiPaths: [
      "/api/subscriptions?q=benchmark-no-such-record-8f36&page=1&pageSize=20",
    ],
    readiness:
      "Committed nonmatching query yields a truthful empty state, zero count and enabled recovery control.",
    prepare: (page) =>
      rowsReady(page, "Subscription records", "Search subscriptions"),
    run: async (page) => {
      await byLabel(page, "Search subscriptions").fill(
        "benchmark-no-such-record-8f36",
      );
      await byLabel(page, "Search subscriptions").press("Enter");
    },
    ready: async (page) => {
      await expect(page).toHaveURL(/q=benchmark-no-such-record-8f36/);
      await expect(
        page.getByRole("heading", {
          name: "No matching subscriptions.",
          exact: true,
        }),
      ).toBeVisible();
      await usable(button(page, "Clear filters"));
      await expect(
        page
          .getByRole("region", { name: "Subscription records", exact: true })
          .locator("tbody tr"),
      ).toHaveCount(0);
      await settled(page);
    },
  });
  return actions;
}
