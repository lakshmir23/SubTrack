import { test, expect, type Page } from "@playwright/test";
import type { Product } from "../../shared/catalog";

const productName = "Browser Operations Suite";
const planName = "Browser Monthly Offering";
async function login(page: Page, email = "admin@brightloop.test") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Brightloop!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace", exact: true }),
  ).toBeVisible();
}
async function chooseOdoo(page: Page) {
  const variant = page.getByLabel("Line 1 variant", { exact: true });
  await expect(variant.locator("option", { hasText: "Odoo" })).toHaveCount(1);
  const id = await variant
    .locator("option", { hasText: "Odoo" })
    .getAttribute("value");
  if (!id) throw new Error("The saved variant option did not load.");
  await variant.selectOption(id);
}
async function fillPlan(page: Page, name: string, interval: string) {
  await page.getByLabel("Plan name", { exact: true }).fill(name);
  await page
    .getByLabel("Primary product", { exact: true })
    .selectOption({ label: productName });
  await page
    .getByLabel("Recurring unit price (INR)", { exact: true })
    .fill("1000.00");
  await page
    .getByLabel("Billing interval", { exact: true })
    .selectOption(interval);
  await page
    .getByLabel("Minimum primary-product quantity", { exact: true })
    .fill("1");
}

test("admin configures a product, four calendar plans, tax, template and a live server price", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page.getByRole("link", { name: "Configuration", exact: true }).click();
  await page
    .getByRole("link", { name: "New product", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(page.getByLabel("Product name", { exact: true })).toBeFocused();
  await page.getByLabel("Product name", { exact: true }).fill(productName);
  await page
    .getByLabel("Product type", { exact: true })
    .selectOption("software");
  await page.getByLabel("Sales price (INR)", { exact: true }).fill("1200.00");
  await page.getByLabel("Cost price (INR)", { exact: true }).fill("800.00");
  await page
    .getByLabel("Internal notes", { exact: true })
    .fill("Synthetic internal setup note.");
  await page.getByRole("button", { name: "Add variant", exact: true }).click();
  await page.getByLabel("Variant 1 name", { exact: true }).fill("Odoo");
  await page
    .getByLabel("Variant 1 adjustment (INR)", { exact: true })
    .fill("560.00");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(
    page.getByRole("link", { name: productName, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: productName, exact: true }).click();
  await page.reload();
  await expect(
    page.getByText("Synthetic internal setup note.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("₹1,200.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("+₹560.00 per unit", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit product", exact: true }).click();
  await page.getByLabel("Cost price (INR)", { exact: true }).fill("810.00");
  await page.getByRole("button", { name: "Save product", exact: true }).click();

  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await page
    .getByRole("link", { name: "New plan", exact: true })
    .first()
    .click();
  await fillPlan(page, planName, "monthly");
  await page.getByLabel("Available from", { exact: true }).fill("2020-01-01");
  await page
    .getByLabel("Available through", { exact: true })
    .fill("2099-12-31");
  await page.getByLabel("Allow pause and resume", { exact: true }).check();
  await page.getByLabel("Allow renewal", { exact: true }).check();
  await page.getByLabel("Allow early closure", { exact: true }).check();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(
    page.getByRole("link", { name: planName, exact: true }),
  ).toBeVisible();
  for (const interval of ["daily", "weekly", "yearly"]) {
    await page
      .getByRole("link", { name: "New plan", exact: true })
      .first()
      .click();
    await fillPlan(page, `Browser ${interval} Offering`, interval);
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    await expect(
      page.getByRole("link", {
        name: `Browser ${interval} Offering`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: planName, exact: true }).click();
  await page.reload();
  await expect(page.getByText("Monthly", { exact: true })).toBeVisible();
  await expect(page.getByText("Allowed", { exact: true })).toHaveCount(4);

  await page.getByRole("link", { name: "Price preview", exact: true }).click();
  await page
    .getByLabel("Recurring plan", { exact: true })
    .selectOption({ label: planName });
  await chooseOdoo(page);
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹1,560.00",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Price updated." }),
  ).toHaveText("Price updated. Total ₹1,560.00.");
  await expect(
    page.getByText("Plan base per unit", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Refresh price", exact: true })
    .click();
  await expect(
    page.getByLabel("Line 1 quantity", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("1");
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹1,560.00",
  );

  await page.getByRole("link", { name: "Tax rules", exact: true }).click();
  await page
    .getByRole("link", { name: "New tax rule", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Tax rule name", { exact: true })
    .fill("Browser demo tax");
  await page.getByLabel("Tax rate (%)", { exact: true }).fill("10.00");
  await page.getByLabel("Priority", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Save tax rule", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Browser demo tax", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await page
    .getByRole("link", { name: "New template", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Browser standard quotation");
  await page
    .getByLabel("Recurring plan", { exact: true })
    .selectOption({ label: planName });
  await page.getByLabel("Quotation validity (days)", { exact: true }).fill("7");
  await chooseOdoo(page);
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Browser standard quotation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Browser standard quotation", exact: true })
    .click();
  await page.reload();
  await expect(page.getByText("7 days", { exact: true })).toBeVisible();
  await expect(page.getByText("Odoo", { exact: true })).toBeVisible();
  await expect(page.getByText("2 units", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Price preview", exact: true }).click();
  await page
    .getByLabel("Recurring plan", { exact: true })
    .selectOption({ label: planName });
  await chooseOdoo(page);
  await expect(page.locator(".calculation-totals .grand-total dd")).toHaveText(
    "₹1,716.00",
  );
  const announcement = page
    .getByRole("status")
    .filter({ hasText: "Price updated." });
  await expect(announcement).toHaveText("Price updated. Total ₹1,716.00.");
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(announcement).toHaveAttribute("aria-atomic", "true");
});

test("configuration version conflicts retain form input and staff cannot configure or see costs", async ({
  page,
}) => {
  await login(page);
  await page.goto("/configuration/products");
  await page.getByRole("link", { name: productName, exact: true }).click();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("link", { name: "Edit product", exact: true }).click();
  await page
    .getByLabel("Product name", { exact: true })
    .fill("My unsaved product name");
  const product = (await (
    await page.request.get(`/api/products/${id}`)
  ).json()) as Product;
  const session = (await (await page.request.get("/api/session")).json()) as {
    csrfToken: string;
  };
  const changed = await page.request.put(`/api/products/${id}`, {
    headers: { "X-CSRF-Token": session.csrfToken },
    data: {
      name: product.name,
      type: product.type,
      salesPrice: product.salesPrice,
      costPrice: product.costPrice,
      notes: product.notes,
      active: product.active,
      variants: product.variants,
      version: product.version,
    },
  });
  expect(changed.status()).toBe(200);
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed after you opened it",
  );
  await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(
    "My unsaved product name",
  );
  await page
    .getByRole("link", { name: "Review the saved record", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard entries", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "staff@brightloop.test");
  await page.goto(`/configuration/products/${id}`);
  await expect(
    page.getByRole("heading", { name: productName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Internal cost price", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Edit product", exact: true }),
  ).toHaveCount(0);
  const staffPayload = await (
    await page.request.get(`/api/products/${id}`)
  ).json();
  expect(Object.hasOwn(staffPayload, "costPrice")).toBe(false);
  await page.goto(`/configuration/products/${id}/edit`);
  await expect(
    page.getByRole("heading", {
      name: "This area is restricted.",
      exact: true,
    }),
  ).toBeVisible();
});

test("configuration native controls and long forms remain usable on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/configuration/plans/new");
  await page.getByLabel("Plan name", { exact: true }).fill("Narrow form draft");
  const interval = page.getByLabel("Billing interval", { exact: true });
  await interval.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(interval).toHaveValue("weekly");
  await page.getByLabel("Available from", { exact: true }).fill("2026-10-31");
  await page.getByLabel("Allow early closure", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save plan", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Save plan", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Products", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard entries", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: productName, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
