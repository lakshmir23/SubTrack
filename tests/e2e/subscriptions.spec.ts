import {
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { test, expect } from './test';
import type { Plan, Product, QuotationTemplate } from "../../shared/catalog";
import type { Subscription } from "../../shared/subscriptions";

async function apiLogin(api: APIRequestContext) {
  const response = await api.post("/api/auth/login", {
    data: { email: "admin@brightloop.test", password: "Brightloop!2026" },
  });
  expect(response.status()).toBe(200);
}
async function write<T>(
  api: APIRequestContext,
  path: string,
  data: unknown,
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  const session = (await (await api.get("/api/session")).json()) as {
    csrfToken: string;
  };
  const response = await api.fetch(path, {
    method,
    headers: { "X-CSRF-Token": session.csrfToken },
    data,
  });
  if (!response.ok())
    throw new Error(
      `Synthetic fixture write failed at ${path} with status ${response.status()}.`,
    );
  return response.json() as Promise<T>;
}
async function offering(api: APIRequestContext, prefix: string) {
  await apiLogin(api);
  const customers = (await (
    await api.get("/api/customers?pageSize=100")
  ).json()) as { items: { id: string; name: string; email: string }[] };
  const maya = customers.items.find(
    (item) => item.email === "maya@brightloop.test",
  )!;
  const arun = customers.items.find(
    (item) => item.email === "arun@brightloop.test",
  )!;
  const clock = (await (await api.get("/api/workspace")).json()) as {
    businessDate: string;
  };
  const productInput = {
    name: `${prefix} Software`,
    type: "software",
    salesPrice: 120000,
    costPrice: 40000,
    notes: "Synthetic private configuration note.",
    active: true,
    variants: [{ name: "Odoo", adjustment: 56000, active: true }],
  };
  const product = await write<Product>(api, "/api/products", productInput);
  const planInput = {
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
  };
  const plan = await write<Plan>(api, "/api/plans", planInput);
  await write(api, "/api/taxes", {
    name: `${prefix} Demo tax`,
    rateBps: 1000,
    productId: product.id,
    priority: 0,
    active: true,
  });
  const templateInput = {
    name: `${prefix} Standard quote`,
    planId: plan.id,
    validDays: 7,
    lines: [
      { productId: product.id, variantId: product.variants[0].id, quantity: 2 },
    ],
    active: true,
  };
  const template = await write<QuotationTemplate>(
    api,
    "/api/quotation-templates",
    templateInput,
  );
  return {
    product,
    productInput,
    plan,
    planInput,
    template,
    templateInput,
    maya,
    arun,
    businessDate: clock.businessDate,
  };
}
async function login(page: Page, email = "staff@brightloop.test") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Brightloop!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name:
        email.startsWith("maya") || email.startsWith("arun")
          ? "Your workspace"
          : "Workspace",
      exact: true,
    }),
  ).toBeVisible();
}
async function stage(page: Page, label: string, expectedStage: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `${label}?`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText(expectedStage);
}
async function saved(page: Page): Promise<Subscription> {
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  return (
    await page.request.get(`/api/subscriptions/${id}`)
  ).json() as Promise<Subscription>;
}

test("staff creates two independent template drafts, safely retries a committed submission and activates an unchanged offer", async ({
  page,
  request: api,
}) => {
  test.setTimeout(60000);
  const fixture = await offering(api, "P3 Journey");
  await login(page);
  await page.goto(`/subscriptions/new?templateId=${fixture.template.id}`);
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: `${fixture.maya.name} · ${fixture.maya.email}` });
  await page
    .getByLabel("Service start date", { exact: true })
    .fill(fixture.businessDate);
  await page
    .getByLabel("Term length (billing periods)", { exact: true })
    .fill("3");
  await expect(page.getByLabel("Line 1 quantity", { exact: true })).toHaveValue(
    "2",
  );
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,432.00",
  );
  await expect(page.locator(".calculation-totals .grand-total dt")).toHaveText(
    "Estimated period total",
  );
  await expect(
    page.getByRole("heading", {
      name: "Estimate per billing period",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".pricing-period-scope")).toHaveText(
    "One monthly billing period",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Draft estimate updated." }),
  ).toContainText("Estimated period total ₹3,432.00.");
  let committed = false;
  await page.route("**/api/subscriptions", async (route) => {
    if (route.request().method() === "POST" && !committed) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = true;
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("may have completed");
  await expect(page.getByLabel("Line 1 quantity", { exact: true })).toHaveValue(
    "2",
  );
  const afterCommit = (await (
    await api.get(
      `/api/subscriptions?customerId=${fixture.maya.id}&q=${encodeURIComponent(fixture.plan.name)}`,
    )
  ).json()) as { total: number; items: Subscription[] };
  expect(afterCommit.total).toBe(1);
  await page.unroute("**/api/subscriptions");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  const first = await saved(page);
  expect(first.id).toBe(afterCommit.items[0].id);
  expect(first.terms.lines[0].quantity).toBe(2);
  await page.goto(`/subscriptions/new?templateId=${fixture.template.id}`);
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: `${fixture.arun.name} · ${fixture.arun.email}` });
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  const second = await saved(page);
  expect(second.id === first.id).toBe(false);
  expect(second.terms.lines[0].quantity).toBe(1);
  expect(
    (
      await (
        await api.get(`/api/quotation-templates/${fixture.template.id}`)
      ).json()
    ).lines[0].quantity,
  ).toBe(2);
  await page.goto(`/subscriptions/${first.id}`);
  await stage(page, "Issue quotation", "Quotation");
  await expect(
    page.getByRole("link", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  await write(
    api,
    `/api/products/${fixture.product.id}`,
    {
      ...fixture.productInput,
      salesPrice: 250000,
      variants: [{ ...fixture.product.variants[0], adjustment: 80000 }],
      version: fixture.product.version,
    },
    "PUT",
  );
  await write(
    api,
    `/api/plans/${fixture.plan.id}`,
    {
      ...fixture.planInput,
      price: 200000,
      minQuantity: 10,
      allowPause: false,
      version: fixture.plan.version,
    },
    "PUT",
  );
  await write(
    api,
    `/api/quotation-templates/${fixture.template.id}`,
    {
      ...fixture.templateInput,
      validDays: 14,
      lines: [{ ...fixture.templateInput.lines[0], quantity: 12 }],
      version: fixture.template.version,
    },
    "PUT",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Offered prices", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,432.00",
  );
  await stage(page, "Confirm agreement", "Confirmed");
  const accepted = await saved(page);
  expect(accepted.acceptedTerms?.lines[0].unitPrice).toBe(156000);
  expect(accepted.acceptedTerms?.plan.allowPause).toBe(true);
  await stage(page, "Activate subscription", "Active");
  await page.reload();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Active");
  await expect(
    page.getByRole("heading", { name: "Accepted prices", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".calculation-totals .grand-total dt")).toHaveText(
    "Estimated period total",
  );
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹3,432.00",
  );
  await expect(page.locator(".pricing-period-scope")).toHaveText(
    "One monthly billing period",
  );
  await expect(page.locator(".agreement-history li")).toHaveCount(4);
  expect(
    (await (await api.get(`/api/subscriptions/${second.id}`)).json()).terms
      .lines[0].quantity,
  ).toBe(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, fixture.maya.email);
  await page.getByRole("link", { name: "Subscriptions", exact: true }).click();
  await expect(
    page.getByRole("link", { name: first.number, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: second.number, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: first.number, exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm agreement", exact: true }),
  ).toHaveCount(0);
  const forbidden = await page.request.get(`/api/subscriptions/${second.id}`);
  expect(forbidden.status()).toBe(404);
  const portal = await (
    await page.request.get(`/api/subscriptions/${first.id}`)
  ).json();
  expect(JSON.stringify(portal).includes("costPrice")).toBe(false);
  expect(
    JSON.stringify(portal).includes("Synthetic private configuration note."),
  ).toBe(false);
});

test("future confirmation remains scheduled and filtered lists preserve their stage when searching", async ({
  page,
  request: api,
}) => {
  const fixture = await offering(api, "P3 Future");
  let future = await write<Subscription>(api, "/api/subscriptions", {
    customerId: fixture.arun.id,
    planId: fixture.plan.id,
    templateId: fixture.template.id,
    startDate: "2099-01-01",
    termPeriods: 2,
    paymentTermDays: 7,
    idempotencyKey: crypto.randomUUID(),
  });
  future = await write<Subscription>(
    api,
    `/api/subscriptions/${future.id}/issue`,
    { version: future.version },
  );
  future = await write<Subscription>(
    api,
    `/api/subscriptions/${future.id}/confirm`,
    { version: future.version },
  );
  await login(page);
  await page.goto(`/subscriptions/${future.id}`);
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Confirmed");
  await expect(
    page.getByText("Starts 1 Jan 2099", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate subscription", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Server business date");
  await page.goto("/subscriptions?stage=Confirmed");
  await page
    .getByRole("searchbox", { name: "Search subscriptions", exact: true })
    .fill(future.number);
  await expect(page).toHaveURL(/stage=Confirmed.*q=SUB/);
  await expect(page.getByLabel("Stage", { exact: true })).toHaveValue(
    "Confirmed",
  );
  await expect(
    page.getByRole("link", { name: future.number, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Activate due agreements", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Activate due agreements", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Activation results", exact: true }),
  ).toContainText("0 activated");
  const refreshed = (await (
    await api.get(`/api/subscriptions/${future.id}`)
  ).json()) as Subscription;
  expect(refreshed.stage).toBe("Confirmed");
});

test("narrow subscription forms show invalid fields, preserve input and keep quote details usable", async ({
  page,
  request: api,
}) => {
  const fixture = await offering(api, "P3 Narrow");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/subscriptions/new");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Customer", { exact: true })).toBeFocused();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: `${fixture.maya.name} · ${fixture.maya.email}` });
  await page
    .getByLabel("Recurring plan", { exact: true })
    .selectOption({ label: fixture.plan.name });
  await page
    .getByLabel("Term length (billing periods)", { exact: true })
    .fill("0");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByLabel("Term length (billing periods)", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
    fixture.maya.id,
  );
  await page
    .getByLabel("Term length (billing periods)", { exact: true })
    .fill("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator('.stage-strip [aria-current="step"]'),
  ).toContainText("Draft");
  await expect(page.locator(".stage-strip li")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Payment terms (days)", { exact: true }).fill("14");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave this form?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByLabel("Payment terms (days)", { exact: true }),
  ).toHaveValue("14");
  await page
    .getByRole("button", { name: "Save draft changes", exact: true })
    .click();
  await expect(
    page.getByText("14 days after invoice issue", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
