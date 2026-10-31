import { test, expect } from "./test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { Product, Plan } from "../../shared/catalog";
import type { Subscription } from "../../shared/subscriptions";
import type { Invoice } from "../../shared/billing";
import type { FinanceSummary } from "../../shared/finance";
import { addDays, periodBoundary } from "../../server/calendar";

async function admin(api: APIRequestContext) {
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
): Promise<T> {
  const session = await (await api.get("/api/session")).json();
  const response = await api.post(path, {
    data,
    headers: { "X-CSRF-Token": session.csrfToken },
  });
  if (!response.ok())
    throw new Error(
      `Synthetic finance fixture failed (${response.status()}) at ${path}.`,
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
async function setup(
  api: APIRequestContext,
  prefix: string,
  email: string,
  tax = 1000,
) {
  await admin(api);
  expect(
    (
      await api.post("/api/auth/signup", {
        data: { name: prefix, email, password: "Brightloop!2026" },
      })
    ).status(),
  ).toBe(201);
  await admin(api);
  const customer = (
    await (
      await api.get(
        `/api/customers?q=${encodeURIComponent(email)}&pageSize=100`,
      )
    ).json()
  ).items[0] as { id: string; name: string; email: string };
  const { businessDate } = (await (await api.get("/api/workspace")).json()) as {
    businessDate: string;
  };
  const product = await write<Product>(api, "/api/products", {
    name: `${prefix} Software`,
    type: "software",
    salesPrice: 120000,
    costPrice: 40000,
    notes: "Private P7 catalog note.",
    active: true,
    variants: [{ name: "Odoo", adjustment: 56000, active: true }],
  });
  const plan = await write<Plan>(api, "/api/plans", {
    name: `${prefix} Monthly`,
    primaryProductId: product.id,
    price: 100000,
    interval: "monthly",
    minQuantity: 1,
    availableFrom: null,
    availableTo: null,
    autoClose: true,
    allowPause: true,
    allowRenew: true,
    allowEarlyClose: true,
    active: true,
  });
  await write(api, "/api/taxes", {
    name: `${prefix} Demo tax`,
    rateBps: tax,
    productId: product.id,
    priority: 0,
    active: true,
  });
  return { customer, businessDate, product, plan };
}
async function agreement(
  api: APIRequestContext,
  fixture: Awaited<ReturnType<typeof setup>>,
  quantity = 1,
  odoo = false,
  customerId = fixture.customer.id,
) {
  let sub = await write<Subscription>(api, "/api/subscriptions", {
    customerId,
    planId: fixture.plan.id,
    templateId: null,
    startDate: fixture.businessDate,
    termPeriods: 3,
    paymentTermDays: 7,
    validDays: 7,
    lines: [
      {
        productId: fixture.product.id,
        variantId: odoo ? fixture.product.variants[0].id : null,
        quantity,
      },
    ],
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
async function invoice(
  api: APIRequestContext,
  sub: Subscription,
  date: string,
) {
  let saved = await write<Invoice>(
    api,
    `/api/subscriptions/${sub.id}/invoices`,
    { expectedPeriodStart: date, idempotencyKey: crypto.randomUUID() },
  );
  saved = await write<Invoice>(api, `/api/invoices/${saved.id}/confirm`, {
    version: saved.version,
  });
  return saved;
}
function metric(page: Page, label: string) {
  return page.locator(".finance-metric").filter({
    has: page.locator("span").filter({ hasText: new RegExp(`^${label}$`) }),
  });
}

test("finance separates issue and payment dates, reconciles linked totals and refreshes after recording a payment", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(
    api,
    "P7 Finance customer",
    "p7-finance@brightloop.test",
  );
  const a = await agreement(api, fixture, 2, true),
    b = await agreement(api, fixture);
  await write(api, "/api/discounts", {
    name: "P7 A targeted launch",
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
    subscriptionId: a.id,
    productIds: [],
  });
  const first = await invoice(api, a, fixture.businessDate),
    second = await invoice(api, b, fixture.businessDate);
  expect(first.total + second.total).toBe(418880);
  for (const [amount, method] of [
    [100000, "cash"],
    [208880, "bank_transfer"],
  ] as const)
    await write(api, `/api/invoices/${first.id}/payments`, {
      amount,
      currency: "INR",
      method,
      paymentDate: fixture.businessDate,
      note: "Private P7 collection note.",
      idempotencyKey: crypto.randomUUID(),
    });
  const from = `${fixture.businessDate.slice(0, 7)}-01`,
    to = addDays(periodBoundary(from, "monthly", 1), -1);
  const filters = new URLSearchParams({
    customerId: fixture.customer.id,
    invoiceFrom: from,
    invoiceTo: to,
    paymentFrom: from,
    paymentTo: to,
  });
  await login(page);
  await page.goto(`/finance?${filters}`);
  await expect(metric(page, "Invoiced amount")).toContainText("₹4,188.80");
  await expect(metric(page, "Payments received")).toContainText("₹3,088.80");
  await expect(metric(page, "Outstanding")).toContainText("₹1,100.00");
  await expect(metric(page, "Active agreements").locator("strong")).toHaveText(
    "2",
  );
  await expect(
    page.getByText(
      "Balances are current, not a historical balance at the selected date.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Invoice issued from", { exact: true })
    .fill(addDays(fixture.businessDate, 1));
  await page
    .getByLabel("Invoice issued through", { exact: true })
    .fill(addDays(fixture.businessDate, -1));
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByLabel("Invoice issued through", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
    fixture.customer.id,
  );
  await page
    .getByLabel("Invoice issued through", { exact: true })
    .fill(addDays(fixture.businessDate, 1));
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(metric(page, "Invoiced amount")).toContainText("₹0.00");
  await expect(metric(page, "Payments received")).toContainText("₹3,088.80");
  await expect(metric(page, "Outstanding")).toContainText("₹0.00");
  await expect(metric(page, "Active agreements").locator("strong")).toHaveText(
    "2",
  );
  await page.getByLabel("Invoice issued from", { exact: true }).fill(from);
  await page.getByLabel("Invoice issued through", { exact: true }).fill(to);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(metric(page, "Outstanding")).toContainText("₹1,100.00");
  await metric(page, "Outstanding").click();
  await expect(
    page.getByRole("region", { name: "Finance records" }).locator("tbody tr"),
  ).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("paymentFrom")).toBe(from);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".finance-metric")).toHaveCount(1);
  await expect(metric(page, "Outstanding")).toContainText("1 invoice");
  const firstDebt = page
    .getByRole("region", { name: "Finance records" })
    .getByRole("link", { name: second.number, exact: true });
  await expect(firstDebt).toBeVisible();
  expect((await firstDebt.boundingBox())!.y).toBeLessThan(844);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("region", { name: "Finance records" })
    .getByRole("link", { name: second.number, exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Back to finance", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Record payment", exact: true }).click();
  await page
    .getByLabel("Payment amount (INR)", { exact: true })
    .fill("1100.00");
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Record this payment?", exact: true })
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(
    page.locator('.invoice-stage-strip [aria-current="step"]'),
  ).toContainText("Paid");
  await page
    .getByRole("link", { name: "Back to finance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Outstanding invoices", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "No records match these filters.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(metric(page, "Outstanding")).toContainText("₹0.00");
  await expect(page.locator(".finance-metric")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Back to finance", exact: true })
    .click();
  await expect(metric(page, "Payments received")).toContainText("₹4,188.80");
  await metric(page, "Payments received").click();
  await expect(
    page.getByRole("region", { name: "Finance records" }).locator("tbody tr"),
  ).toHaveCount(3);
  await page.reload();
  await expect(
    page.getByLabel("Invoice issued from", { exact: true }),
  ).toHaveValue(from);
  await expect(metric(page, "Payments received")).toContainText("₹4,188.80");
  let fault = true;
  await page.route("**/api/finance/summary?*", async (route) => {
    if (fault) {
      fault = false;
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Refresh finance", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await expect(
    page.getByLabel("Payment received from", { exact: true }),
  ).toHaveValue(from);
  await page
    .getByRole("button", { name: "Retry summary", exact: true })
    .click();
  await expect(metric(page, "Payments received")).toContainText("₹4,188.80");
  await page.unroute("**/api/finance/summary?*");
  const actual = (await (
    await api.get(`/api/finance/summary?${filters}`)
  ).json()) as FinanceSummary;
  expect(actual.invoicedRevenue).toBe("418880");
  expect(actual.paymentsReceived).toBe("418880");
  expect(actual.outstanding).toBe("0");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/finance?${filters}`);
  await expect(metric(page, "Invoiced amount")).toContainText("₹4,188.80");
  const disclosure = page.locator(".finance-filter-disclosure");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(disclosure.locator("summary")).toContainText(
    fixture.customer.name,
  );
  const amountBox = await metric(page, "Invoiced amount")
    .locator("strong")
    .boundingBox();
  expect(amountBox!.y).toBeLessThan(800);
  await expect(
    page.getByRole("status").filter({ hasText: "Finance updated." }),
  ).toContainText("₹0.00 outstanding");
  await page.getByText("How totals are counted", { exact: true }).click();
  await expect(page.locator(".finance-definitions dl > div")).toHaveCount(5);
  await disclosure.locator("summary").press("Enter");
  await page
    .getByLabel("Invoice issued from", { exact: true })
    .fill(addDays(fixture.businessDate, 1));
  await page
    .getByLabel("Invoice issued through", { exact: true })
    .fill(addDays(fixture.businessDate, -1));
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(
    page.getByLabel("Invoice issued through", { exact: true }),
  ).toBeFocused();
});

test("finance totals cover every page and both finance and shared record pagination keep the selected page", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await setup(
    api,
    "P7 Pagination customer",
    "p7-pages@brightloop.test",
    0,
  );
  for (let index = 0; index < 25; index++) {
    const sub = await agreement(api, fixture);
    await invoice(api, sub, fixture.businessDate);
  }
  await login(page, "staff@brightloop.test");
  await page.goto(`/finance?customerId=${fixture.customer.id}`);
  await expect(metric(page, "Invoiced amount")).toContainText("₹25,000.00");
  await expect(metric(page, "Invoiced amount")).toContainText("25 invoices");
  await metric(page, "Invoiced amount").click();
  const records = page.getByRole("region", { name: "Finance records" });
  await expect(records.locator("tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(records.locator("tbody tr")).toHaveCount(5);
  await expect(metric(page, "Invoiced amount")).toContainText("₹25,000.00");
  await records.locator("tbody tr").first().getByRole("link").click();
  await page
    .getByRole("link", { name: "Back to finance", exact: true })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(records.locator("tbody tr")).toHaveCount(5);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(records.locator("tbody tr")).toHaveCount(20);
  await page.goto(
    `/finance/invoices?customerId=${fixture.customer.id}&page=999`,
  );
  await expect(page).toHaveURL(/page=2/);
  await expect(records.locator("tbody tr")).toHaveCount(5);
  await expect(page.locator(".finance-metric")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Back to finance", exact: true })
    .click();
  await metric(page, "Active agreements").click();
  await expect(records.locator("tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(records.locator("tbody tr")).toHaveCount(5);
  await records.locator("tbody tr").first().getByRole("link").click();
  await page.getByRole("link", { name: "Manage service", exact: true }).click();
  await page.getByRole("link", { name: /^Back to SUB-/ }).click();
  await page
    .getByRole("link", { name: "Back to finance", exact: true })
    .click();
  await expect(page).toHaveURL(/finance\/agreements.*page=2/);
  await expect(records.locator("tbody tr")).toHaveCount(5);
  await page.goto(`/subscriptions?customerId=${fixture.customer.id}`);
  await expect(page.locator(".table-region tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".table-region tbody tr")).toHaveCount(5);
  await page.goto(`/billing/invoices?customerId=${fixture.customer.id}`);
  await expect(page.locator(".table-region tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".table-region tbody tr")).toHaveCount(5);
});

test("narrow customer portal keeps own balances, payments, service and print while finance and other customer records are denied", async ({
  page,
  context,
  request: api,
}) => {
  const fixture = await setup(
    api,
    "P7 Portal customer",
    "p7-portal@brightloop.test",
    0,
  );
  const own = await agreement(api, fixture);
  const saved = await invoice(api, own, fixture.businessDate);
  await write(api, `/api/invoices/${saved.id}/payments`, {
    amount: 40000,
    currency: "INR",
    method: "cash",
    paymentDate: fixture.businessDate,
    note: "Private P7 portal collection note.",
    idempotencyKey: crypto.randomUUID(),
  });
  const arun = (
    await (await api.get("/api/customers?q=arun%40brightloop.test")).json()
  ).items[0];
  const other = await agreement(api, fixture, 1, false, arun.id);
  const otherInvoice = await invoice(api, other, fixture.businessDate);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, fixture.customer.email);
  await expect(page.locator(".environment-banner")).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Finance", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "View invoices and payments", exact: true })
    .click();
  await page.getByRole("link", { name: saved.number, exact: true }).click();
  await expect(
    page.getByText("Partially paid · balance outstanding", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".payment-history-list")).toContainText("₹400.00");
  await expect(page.locator("body")).not.toContainText(
    "Private P7 portal collection note.",
  );
  await expect(
    page.getByRole("link", { name: "Record payment", exact: true }),
  ).toHaveCount(0);
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: /Open print view/ }).click();
  const print = await popup;
  await print.waitForLoadState();
  await expect(print.locator("body")).toContainText(saved.number);
  expect(await print.locator("body").innerText()).not.toContain(
    "Private P7 portal collection note.",
  );
  await print.close();
  await page.goto(`/subscriptions/${own.id}`);
  await page.getByRole("link", { name: "Manage service", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manage service", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const path of ["summary", "agreements", "invoices", "payments"])
    expect((await page.request.get(`/api/finance/${path}`)).status()).toBe(403);
  expect(
    (await page.request.get(`/api/invoices/${otherInvoice.id}`)).status(),
  ).toBe(404);
  expect(
    (await page.request.get(`/api/invoices/${otherInvoice.id}/print`)).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(`/api/subscriptions/${other.id}/lifecycle`)
    ).status(),
  ).toBe(404);
  const payments = (
    await (await page.request.get(`/api/invoices/${saved.id}/payments`)).json()
  ).items;
  expect(
    payments.every((payment: Record<string, unknown>) => !("note" in payment)),
  ).toBe(true);
  await page.goto("/finance");
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
});
