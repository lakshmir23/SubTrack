# SubTrack portal guide

**One website, three roles.** The account you sign in with decides which menus and actions you see. There is no role-switching button inside the app.

Jump to your role: [Admin](#admin-portal) · [Staff](#staff-portal) · [Customer](#customer-portal).

If a price or date looks confusing, start with [Understanding prices and days](#understanding-prices-and-days).

## 1. Open the app and choose an account

For the normal application, run this from the repository folder:

```sh
npm run dev
```

Open **[localhost:3000](http://localhost:3000)**. The frontend and backend start together. Initial dependency installation is covered in the [main README](../../README.md#one-time-setup).

For a populated practice environment, use the separate **[November demo on port 3003](http://localhost:3003)**. Start it with `npm run demo` after building; the [demo instructions](../../README.md#try-the-complete-local-demo) explain this. Its banner shows a fixed **9 November 2026** business date. The normal app uses the real date.

### Practice accounts

All accounts below are **synthetic fixtures**, with password **`Brightloop!2026`**:

- **Admin:** `admin@brightloop.test`
- **Staff:** `staff@brightloop.test`
- **Customers in the normal seeded app:** `maya@brightloop.test` or `arun@brightloop.test`
- **Customers in the November demo:** `studio@brightloop.test`, `shop@brightloop.test` or `services@brightloop.test`

The normal seed accounts exist after the one-time `npm run db:seed`. The November demo creates its own accounts automatically. Their databases are separate, but localhost cookies are shared across ports: use one app at a time, or separate browser profiles/a regular window and a private window.

**To change roles:** click **Sign out** beside your account name (at the bottom of the sidebar on desktop), then sign in with another account. Check the role shown beside your name. For side-by-side roles, use separate browser profiles or a regular window and a private window. Public **Sign up** creates a Customer account, never an Admin or Staff account.

## Admin portal

**Use this role to configure the business and manage the internal team.** Admin can also perform every staff task described below.

### Your sidebar

- **Workspace:** your starting page and account overview.
- **Subscriptions:** quotations, agreements, activation and service changes.
- **Billing:** invoices, the due workbench and saved billing runs.
- **Finance:** invoiced amounts, received payments and unpaid balances.
- **Customers:** search registered customer accounts. This is a directory, not an Add customer form.
- **Configuration:** products, recurring plans, taxes, templates, discounts and price preview.
- **Team access:** add staff accounts.
- **Email activity:** inspect generated messages and delivery status.

### Set up an offering

1. Open **Configuration → Products** and create a product. Set its sales price, internal cost and any variants.
2. Open the **Plans** tab and create a plan for that primary product. Set **Recurring unit price (INR)**, the billing interval and minimum quantity.
3. Choose which service actions the plan permits: pause, renewal, early closure and automatic closure at expiry.
4. Add any required **Tax rules** and **Discounts**. The sample tax is a demonstration rule, not a claim about statutory tax compliance.
5. Open **Templates** and create a quotation template if you want to reuse the plan and product lines.
6. Use **Price preview** to check the calculation before preparing an agreement.

**Important:** the plan's recurring price replaces the primary product's catalog base price. A variant adjustment is added per unit. An internal **Cost price** is not the customer's charge.

### Add a staff member

Open **Team access**, use the add-staff action, enter the required account details and save. Staff can handle daily operations but cannot change catalog configuration or add more staff.

### Inspect email delivery

Open **Email activity** to inspect the saved status. **Generated / queued** means the message exists locally; **Accepted by SMTP** means SMTP accepted it. Neither alone proves that the recipient saw it in their inbox. Default outbox mode does not deliver real email.

## Staff portal

**Use this role for the daily quote → invoice → payment workflow.** Admin can follow these same steps.

Your sidebar contains **Workspace, Subscriptions, Billing, Finance, Customers and Configuration**. Configuration is read-only for staff. Staff cannot change products/plans/rules, view internal cost prices, add staff or open the admin Email activity page. Staff can read internal product and payment notes.

### A. Prepare and activate an agreement

1. Open **Subscriptions → New subscription**.
2. Select the **Customer**. If the customer is missing, they must register through **Sign up**, or you can use an existing synthetic account for practice.
3. Choose **Offering source**: **Start from a recurring plan** or **Copy a quotation template**.
4. Check the plan, product quantities, service start, term length, payment terms and quotation validity. Review **Estimate per billing period**.
5. Click **Save draft**. On the saved record, use **Issue quotation**, then **Confirm agreement**, reviewing each confirmation.
6. Use **Activate subscription** when its start date is due. A future-start agreement stays Confirmed. The list's **Activate due agreements** action processes agreements whose start dates have arrived.

The stage strip is your progress indicator:

**Draft → Quotation → Confirmed → Active → Closed**

A Draft is editable. Issuing freezes the offered commercial terms; confirmation accepts them. Editing the catalog later does not rewrite the agreed price.

### B. Generate and confirm invoices

Inside **Billing**, use the three tabs: **Invoices**, **Due workbench** and **Billing runs**.

1. Open **Due workbench** and inspect the period, customer and reason on each row.
2. Choose **Period limit** and **Run scope**. **All due subscriptions** includes records outside the current search/filter; **This page's subscriptions** limits the scope to the displayed agreements.
3. Click **Review billing run**, review the confirmation and confirm **Start billing run**.
4. Inspect its saved results: **Created**, **Already exists**, **Non-billable** and **Failed**. Use **Retry failed periods** when needed.
5. Open a created invoice and check its saved lines, discount, tax and total.
6. Use **Confirm invoice**. Generation creates a Draft; confirmation is a separate action.

For one agreement, its **Invoices** section also offers **Generate next invoice** when allowed.

**Send invoice**, **Open print view** and confirmation are separate actions. Sending or printing does not mark an invoice Paid. A canceled invoice needs an explicit linked replacement when eligible; rerunning ordinary billing does not silently recreate it.

### C. Record a received payment

1. Open a **Confirmed** invoice with a positive unpaid balance.
2. Click **Record payment**.
3. Enter **Payment amount (INR)**, **Payment method**, **Payment date** and an optional **Internal payment note**.
4. Click **Review payment**, check the amount and invoice, then confirm **Record payment**.
5. Check the updated balance and **Payment history**.

Example: a ₹3,088.80 invoice receives ₹1,000. It stays **Confirmed**, with **₹2,088.80 outstanding**. Recording the remaining ₹2,088.80 makes it **Paid**.

The default November demo already has that invoice settled. To practise those payments, start a fresh demo with `npm run demo -- --settlement=unpaid` instead, stopping the current demo first.

Recording a payment documents money already received; it does not charge a card or move money. Recorded payments cannot be edited or reversed through this version's UI, so check the review carefully.

### D. Read finance

1. Open **Finance** and expand **Dates and customer** if the filters are collapsed.
2. Set **Invoice issued from/through** to choose the invoices included in invoiced amounts and debt.
3. Set **Payment received from/through** independently to choose the received payments.
4. Optionally choose a **Customer**, then click **Apply filters**.
5. Click **Invoiced amount**, **Payments received**, **Active agreements**, **Outstanding** or **Overdue** to open the matching records. **Back to finance** retains the report context.

Outstanding and overdue show what remains unpaid **today**, not a historical balance at the selected date. Active agreements are counted today, including paused agreements still within their term; invoice/payment date filters do not change that count. An invoice due today becomes overdue only after today.

### E. Change service

Open **Subscriptions → an agreement → Manage service**. Choose an available **Service action**, review its effective date and confirm it. Read **Scheduled changes** and **Service history** afterward.

Changes follow the accepted plan and original billing boundaries. A pause can be scheduled for the next boundary rather than happening immediately. It does not erase earlier debt or automatically extend expiry.

The subscription list's **Process service changes** page lets internal staff review and process due service changes. An ended term with automatic closure disabled can show **Term ended**; the internal team can explicitly close it.

### Optional: get help choosing an offering

In the new-subscription form, select the customer, then open **Help choose an offering**. If AI is enabled, enter synthetic product needs and click **Suggest selections**. Review the result, click **Apply suggested fields**, review the normal calculated estimate, check **I reviewed the current calculated estimate** and explicitly **Save draft**.

Do not enter personal information. Suggestions cannot save, confirm or bill anything. If the assistant is off or fails, keep using the ordinary form. The isolated November demo intentionally leaves AI off.

## Customer portal

**Use this role to inspect your own agreements, invoices and service.** Your sidebar contains only **Workspace, Subscriptions and Invoices**.

### View your agreement

1. Open **Subscriptions** and click a reference such as **SUB-000002**.
2. Read the stage, service dates, payment terms and price breakdown (**Accepted prices** after confirmation).
3. Check the agreement's **Invoices** section and **Activity** history.

**Active** is the agreement stage. Check the separate service state to see whether service is **Running**, **Paused** or **Term ended**. Invoice payment status is separate. Customers cannot edit quotes, confirm agreements, change prices or create invoices.

### Manage your service

1. From the agreement, click **Manage service**.
2. Read **Next billing period to review** and **Accepted product lines**.
3. If available, choose **Pause service**, **Resume service**, **Renew term** or **Close early**. Review the effective date before confirming.
4. Use the optional-line controls only for add-ons already included in the accepted agreement. The required primary line cannot be disabled.
5. Check **Scheduled changes**, **Effective intervals** and **Service history** to distinguish what is running now from what will change later.

If no action is available, expand **Plan permissions and unavailable actions**. The reason may be a disabled plan permission, a future start, an ended term or no eligible boundary. Customers cannot use **Close ended term**; that action belongs to the internal team.

### View invoices and print a copy

Open **Invoices**, select an invoice and inspect its total, status, remaining balance and **Payment history**. Use **Open print view**, then **Print invoice** or your browser's **Save as PDF** option.

Customers cannot record payments, send invoice emails or see internal notes/costs. Ask the internal team to record money already received. This version has no customer card-payment checkout.

## Understanding prices and days

- **Estimate per billing period:** the amount for one daily, weekly, monthly or yearly period—not the whole term.
- **Term length (billing periods):** how many of those periods the service lasts. Three monthly periods means three months; seven daily periods means seven days.
- **Payment terms (days):** days after an invoice is issued before payment is due. Setting this to 100 gives 100 days to pay; it does not buy 100 days of service or change the price.
- **Quotation validity (days):** how long the issued offer can be accepted. It does not change the recurring charge.
- **Exclusive expiry:** service stops at the beginning of that date.

If a plan's accepted base is **₹1**, quantity is **1**, variant adjustment is **₹0** and estimated tax is **₹0**, the period estimate is **₹1**. This reflects the saved agreement, not a duration calculation error.

For different prices on a new agreement, an administrator opens **Configuration → Plans → the plan → Edit plan**. Existing issued/accepted prices stay saved. Invoice tax and discounts are finalized when an invoice is generated, so the quote's tax estimate is not a guaranteed final bill.

## If you get stuck

- **A menu is missing:** check the role beside your name. Admin, Staff and Customer have different navigation.
- **The customer list is empty:** check which app/port you opened and whether accounts were registered or seeded there.
- **There is no Record payment button:** check that you are Admin/Staff and that the invoice is Confirmed with money still outstanding.
- **An agreement is Confirmed but not Active:** check its start date and the internal activation action.
- **Pause or renewal is unavailable:** expand the plan-permissions explanation. Current catalog edits do not change an existing agreement's accepted permissions.
- **A saved value changed elsewhere:** use the refresh action, review the current record and retry safely. Validation messages preserve your entries.
- **The reset email did not arrive:** default outbox mode only generates it locally. Actual inbox delivery needs approved SMTP configuration.

For a guided demonstration, continue with the [judge walkthrough](../JUDGE_WALKTHROUGH.md). For deeper implementation details, read the [team working guide](README.md).
