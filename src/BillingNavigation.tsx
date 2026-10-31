import { NavLink } from "react-router-dom";
import { useSession } from "./session";

export function BillingNavigation() {
  const { user } = useSession();
  if (user?.role === "customer") return null;
  return (
    <nav className="catalog-tabs billing-tabs" aria-label="Billing sections">
      <NavLink to="/billing/invoices">Invoices</NavLink>
      <NavLink to="/billing/workbench">Due workbench</NavLink>
      <NavLink to="/billing/runs">Billing runs</NavLink>
    </nav>
  );
}
