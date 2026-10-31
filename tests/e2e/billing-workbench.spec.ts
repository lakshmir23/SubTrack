import { test, expect } from "./test";
import type { APIRequestContext, Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { realpathSync } from "node:fs";
import { dirname, basename, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { addDays } from "../../server/calendar";
import type { Product, Plan, TaxRule } from "../../shared/catalog";
import type { Subscription } from "../../shared/subscriptions";
import type { Invoice, DiscountRule } from "../../shared/billing";
import type { BillingRun } from "../../shared/billing-workbench";
import type { InvoiceDelivery } from "../../shared/invoice-output";

async function loginApi(api: APIRequestContext) {
  expect(
    (
      await api.post("/api/auth/login", {
        data: { email: "admin@brightloop.test", password: "Brightloop!2026" },
      })
    ).status(),
  ).toBe(200);
}
async function write<T>(
  api: APIRequestContext,
  path: string,
  data: unknown,
  method = "POST",
): Promise<T> {
  const session = await (await api.get("/api/session")).json();
  const response = await api.fetch(path, {
    method,
    headers: { "X-CSRF-Token": session.csrfToken },
    data,
  });
  if (!response.ok())
    throw new Error(
      `Synthetic workbench fixture failed at ${path} (${response.status()}).`,
    );
  return response.json() as Promise<T>;
}
async function login(page: Page, email = "admin@brightloop.test") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Brightloop!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Database connected", { exact: true }),
  ).toBeVisible();
}
async function offering(api: APIRequestContext, prefix: string) {
  await loginApi(api);
  const { businessDate } = (await (await api.get("/api/workspace")).json()) as {
    businessDate: string;
  };
  const people = (await (await api.get("/api/customers?pageSize=100")).json())
    .items as { id: string; name: string; email: string }[];
  const product = await write<Product>(api, "/api/products", {
    name: `${prefix} Software`,
    type: "software",
    salesPrice: 120000,
    costPrice: 40000,
    notes: "Private synthetic P5 cost note.",
    active: true,
    variants: [],
  });
  const plan = await write<Plan>(api, "/api/plans", {
    name: `${prefix} Daily`,
    primaryProductId: product.id,
    price: 100000,
    interval: "daily",
    minQuantity: 1,
    availableFrom: null,
    availableTo: null,
    autoClose: true,
    allowPause: true,
    allowRenew: true,
    allowEarlyClose: true,
    active: true,
  });
  const tax = await write<TaxRule>(api, "/api/taxes", {
    name: `${prefix} Demo 10%`,
    rateBps: 1000,
    productId: product.id,
    priority: 0,
    active: true,
  });
  return {
    businessDate,
    product,
    plan,
    tax,
    maya: people.find((person) => person.email === "maya@brightloop.test")!,
    arun: people.find((person) => person.email === "arun@brightloop.test")!,
  };
}
async function active(
  api: APIRequestContext,
  plan: Plan,
  customerId: string,
  date: string,
) {
  let sub = await write<Subscription>(api, "/api/subscriptions", {
    customerId,
    planId: plan.id,
    templateId: null,
    startDate: date,
    termPeriods: 5,
    paymentTermDays: 7,
    validDays: 7,
    lines: [{ productId: plan.primaryProductId, variantId: null, quantity: 1 }],
    idempotencyKey: crypto.randomUUID(),
  });
  for (const action of ["issue", "confirm", "activate"])
    sub = await write<Subscription>(
      api,
      `/api/subscriptions/${sub.id}/${action}`,
      { version: sub.version },
    );
  return sub;
}
function syntheticDb() {
  const path = process.env.E2E_DATABASE_PATH;
  if (!path) throw new Error("The isolated browser database is missing.");
  const actual = realpathSync(path),
    parent = dirname(actual);
  if (
    basename(actual) !== "test.sqlite" ||
    !basename(parent).startsWith("subtrack-e2e-") ||
    !parent.toLowerCase().startsWith(`${resolve(tmpdir()).toLowerCase()}${sep}`)
  )
    throw new Error(
      "Refusing to inject a synthetic failure outside the isolated browser fixture.",
    );
  return new DatabaseSync(actual);
}
async function savedRun(page: Page, api: APIRequestContext) {
  await expect(page).toHaveURL(/\/billing\/runs\/[a-f0-9-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect
    .poll(
      async () =>
        (await (await api.get(`/api/billing/runs/${id}`)).json()).status,
    )
    .toBe("completed");
  await page
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  return (await (
    await api.get(`/api/billing/runs/${id}`)
  ).json()) as BillingRun;
}
async function startRun(page: Page) {
  await page
    .getByRole("button", { name: "Review billing run", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Start this billing run?",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Start billing run", exact: true })
    .click();
}
async function invoiceAction(page: Page, name: string, status: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const title =
    name === "Cancel invoice"
      ? "Cancel this invoice?"
      : "Confirm this invoice?";
  await page
    .getByRole("dialog", { name: title, exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  if (status === "Canceled")
    await expect(
      page.getByText("Canceled · historical amount, not collectible", {
        exact: true,
      }),
    ).toBeVisible();
  else
    await expect(
      page.locator('.invoice-stage-strip [aria-current="step"]'),
    ).toContainText(status);
}

test("bounded billing keeps a failed period retryable, preserves committed run replay and drains the real backlog", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await offering(api, "P5 Workbench");
  const signup = await api.post("/api/auth/signup", {
    data: {
      name: "P5 Workbench Customer",
      email: "p5-workbench@brightloop.test",
      password: "Brightloop!2026",
    },
  });
  expect(signup.status()).toBe(201);
  await loginApi(api);
  const people = (
    await (await api.get("/api/customers?q=P5%20Workbench&pageSize=100")).json()
  ).items;
  const a = await active(
    api,
    fixture.plan,
    people[0].id,
    addDays(fixture.businessDate, -2),
  );
  const b = await active(
    api,
    fixture.plan,
    people[0].id,
    addDays(fixture.businessDate, -2),
  );
  const db = syntheticDb();
  db.exec(
    `CREATE TRIGGER synthetic_e2e_billing_failure BEFORE INSERT ON invoices WHEN NEW.subscription_id='${b.id}' BEGIN SELECT RAISE(ABORT,'Synthetic browser generation failure'); END;`,
  );
  try {
    await login(page);
    await page.goto("/billing/workbench?q=P5%20Workbench");
    await expect(
      page
        .getByRole("region", { name: "Billing queue" })
        .getByRole("link", { name: a.number, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Run scope", { exact: true }).selectOption("page");
    await page.getByLabel("Period limit", { exact: true }).fill("0");
    await page
      .getByRole("button", { name: "Review billing run", exact: true })
      .click();
    await expect(
      page.getByLabel("Period limit", { exact: true }),
    ).toBeFocused();
    await page.getByLabel("Period limit", { exact: true }).fill("4");
    let committed = false;
    await page.route("**/api/billing/runs", async (route) => {
      if (route.request().method() === "POST" && !committed) {
        expect((await route.fetch()).status()).toBe(202);
        committed = true;
        await route.abort();
      } else await route.continue();
    });
    await startRun(page);
    const review = page.getByRole("dialog", {
      name: "Start this billing run?",
      exact: true,
    });
    await expect(review.getByRole("alert")).toContainText("may have completed");
    await page.unroute("**/api/billing/runs");
    await review
      .getByRole("button", { name: "Start billing run", exact: true })
      .click();
    const first = await savedRun(page, api);
    expect(first.processed).toBe(4);
    expect(first.created).toBe(3);
    expect(first.failed).toBe(1);
    expect(first.remainingDueSubscriptions).toBe(1);
    await expect(page.getByRole("alert")).toContainText("1 period failed");
    await page.getByLabel("Outcome", { exact: true }).selectOption("failed");
    await expect(
      page.getByRole("region", { name: "Period outcomes" }).locator("tbody tr"),
    ).toHaveCount(1);
    await expect(
      page.getByText("Failed · retryable", { exact: true }),
    ).toBeVisible();
    db.exec("DROP TRIGGER synthetic_e2e_billing_failure;");
    await page
      .getByRole("button", { name: "Retry failed periods", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Retry these failed periods?", exact: true })
      .getByRole("button", { name: "Retry failed periods", exact: true })
      .click();
    const retry = await savedRun(page, api);
    expect(retry.retryOf).toBe(first.id);
    expect(retry.created).toBe(1);
    expect(retry.failed).toBe(0);
    expect(retry.remainingDueSubscriptions).toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: retry.number, exact: true }),
    ).toBeVisible();
    await page.goto("/billing/workbench?q=P5%20Workbench");
    await expect(
      page
        .getByRole("region", { name: "Billing queue" })
        .getByRole("link", { name: b.number, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Run scope", { exact: true }).selectOption("page");
    await startRun(page);
    const rest = await savedRun(page, api);
    expect(rest.created).toBe(2);
    expect(rest.remainingDueSubscriptions).toBe(0);
    await page.goto(`/billing/runs/${rest.id}?page=999`);
    await expect(page).toHaveURL(new RegExp(`/billing/runs/${rest.id}$`));
    await expect(
      page.getByRole("region", { name: "Period outcomes" }).locator("tbody tr"),
    ).toHaveCount(2);
    await page.goto(`/billing/runs?q=${rest.number}`);
    await expect(
      page.getByRole("region", { name: "Billing runs" }).locator("tbody tr"),
    ).toHaveCount(1);
    await expect(
      page.getByLabel("Search billing runs", { exact: true }),
    ).toHaveValue(rest.number);
    const invoices = await (
      await api.get("/api/invoices?q=P5%20Workbench&pageSize=100")
    ).json();
    expect(invoices.total).toBe(6);
    expect(
      new Set(
        invoices.items.map(
          (item: Invoice) => `${item.subscriptionId}/${item.periodStart}`,
        ),
      ).size,
    ).toBe(6);
    const replay = await write<BillingRun>(api, "/api/billing/runs", {
      limit: 500,
      subscriptionIds: [a.id, b.id],
      idempotencyKey: crypto.randomUUID(),
    });
    await expect
      .poll(
        async () =>
          (await (await api.get(`/api/billing/runs/${replay.id}`)).json())
            .status,
      )
      .toBe("completed");
    expect(
      (
        await (
          await api.get(`/api/invoices?q=P5%20Workbench&pageSize=100`)
        ).json()
      ).total,
    ).toBe(6);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS synthetic_e2e_billing_failure;");
    db.close();
  }
});

test("canceled invoice replacement visibly reprices, requires a fresh preview and replays one linked revision", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await offering(api, "P5 Replacement");
  const sub = await active(
    api,
    fixture.plan,
    fixture.maya.id,
    fixture.businessDate,
  );
  const rule = await write<DiscountRule>(api, "/api/discounts", {
    name: "P5 Replacement one use",
    kind: "percentage",
    amountMinor: null,
    percentBps: 1000,
    minAmount: null,
    minQuantity: null,
    startDate: null,
    endDate: null,
    maxUses: 1,
    priority: 0,
    active: true,
    scope: "subscription",
    subscriptionId: sub.id,
    productIds: [],
  });
  const invoice = await write<Invoice>(
    api,
    `/api/subscriptions/${sub.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  expect(invoice.total).toBe(99000);
  await login(page);
  await page.goto(`/billing/invoices/${invoice.id}`);
  await invoiceAction(page, "Confirm invoice", "Confirmed");
  await invoiceAction(page, "Cancel invoice", "Canceled");
  await page
    .getByRole("link", { name: "Review replacement", exact: true })
    .click();
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹1,100.00",
  );
  await expect(page.locator(".replacement-comparison")).toContainText(
    "₹990.00",
  );
  await write<TaxRule>(
    api,
    `/api/taxes/${fixture.tax.id}`,
    {
      name: fixture.tax.name,
      rateBps: 2000,
      productId: fixture.product.id,
      priority: 0,
      active: true,
      version: fixture.tax.version,
    },
    "PUT",
  );
  await page
    .getByRole("button", { name: "Create replacement draft", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create this replacement?",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Create replacement draft", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹1,200.00",
  );
  let committed = false;
  await page.route("**/api/invoices/*/replace", async (route) => {
    if (!committed) {
      expect((await route.fetch()).status()).toBe(201);
      committed = true;
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Create replacement draft", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Create replacement draft", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("may have completed");
  await page.unroute("**/api/invoices/*/replace");
  await dialog
    .getByRole("button", { name: "Create replacement draft", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  const replacementId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(replacementId === invoice.id).toBe(false);
  const replacement = (await (
    await api.get(`/api/invoices/${replacementId}`)
  ).json()) as Invoice;
  expect(replacement.predecessorId).toBe(invoice.id);
  expect(replacement.total).toBe(120000);
  expect(replacement.revisionNumber).toBe(2);
  expect(
    (await (await api.get(`/api/discounts/${rule.id}`)).json()).consumed,
  ).toBe(1);
  await page.goto(`/billing/invoices/${invoice.id}`);
  await expect(
    page.getByRole("link", {
      name: `Open current invoice ${replacement.number}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review replacement", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await api.get(`/api/invoices?subscriptionId=${sub.id}&pageSize=100`)
      ).json()
    ).total,
  ).toBe(2);
});

test("narrow send review preserves one queued message on response loss and customers can print only their own invoice", async ({
  page,
  context,
  request: api,
}) => {
  const fixture = await offering(api, "P5 Output");
  const sub = await active(
    api,
    fixture.plan,
    fixture.maya.id,
    fixture.businessDate,
  );
  const other = await active(
    api,
    fixture.plan,
    fixture.arun.id,
    fixture.businessDate,
  );
  const invoice = await write<Invoice>(
    api,
    `/api/subscriptions/${sub.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const otherInvoice = await write<Invoice>(
    api,
    `/api/subscriptions/${other.id}/invoices`,
    {
      expectedPeriodStart: fixture.businessDate,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "staff@brightloop.test");
  await page.goto(`/billing/invoices/${invoice.id}`);
  await expect(
    page.getByRole("heading", { name: invoice.number, exact: true }),
  ).toBeVisible();
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: /Open print view/ }).click();
  const print = await popupPromise;
  await print.waitForLoadState();
  await expect(print.locator("body")).toContainText(invoice.number);
  await expect(print.locator("body")).toContainText("Draft");
  expect(await print.locator("body").innerText()).not.toContain(
    "Private synthetic P5 cost note",
  );
  await print.close();
  await page.getByRole("button", { name: "Send invoice", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Send this invoice?",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText(fixture.maya.email);
  let committed = false;
  await page.route("**/api/invoices/*/send", async (route) => {
    if (!committed) {
      expect((await route.fetch()).status()).toBe(201);
      committed = true;
      await route.abort();
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Send invoice", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("may have completed");
  await page.unroute("**/api/invoices/*/send");
  await dialog
    .getByRole("button", { name: "Send invoice", exact: true })
    .click();
  await expect(page.locator(".invoice-delivery-result")).toContainText(
    "Generated / queued",
  );
  await expect(
    page.getByRole("region", { name: "Invoice email" }).getByRole("status"),
  ).toContainText("Invoice email: Generated / queued.");
  await expect(page.locator(".invoice-deliveries li")).toHaveCount(1);
  const deliveries = (
    await (await api.get(`/api/invoices/${invoice.id}/deliveries`)).json()
  ).items as InvoiceDelivery[];
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].status).toBe("generated");
  await page.reload();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  expect(
    (await (await api.get(`/api/invoices/${invoice.id}`)).json()).amountPaid,
  ).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, fixture.maya.email);
  await page.goto(`/billing/invoices/${invoice.id}`);
  await expect(
    page.getByRole("link", { name: /Open print view/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invoice", exact: true }),
  ).toHaveCount(0);
  expect(
    (await page.request.get(`/api/invoices/${otherInvoice.id}/print`)).status(),
  ).toBe(404);
  expect(
    (await page.request.get(`/api/invoices/${invoice.id}/deliveries`)).status(),
  ).toBe(403);
  await page.goto("/billing/workbench");
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
});
