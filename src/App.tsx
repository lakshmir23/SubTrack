import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from "react-router-dom";
import { ForgotPassword, Login, ResetPassword, Signup } from "./Auth";
import { SessionProvider } from "./session";
import { RouteFocus } from "./ui";
import {
  SubscriptionList,
  SubscriptionDetail,
  SubscriptionEditorRoute,
} from "./Subscriptions";
import {
  CatalogLayout,
  CatalogList,
  CatalogDetail,
  CatalogEditor,
  CatalogPricePreview,
} from "./Catalog";
import {
  AddStaff,
  Deliveries,
  NotFound,
  PeopleList,
  RequireSession,
  SessionBoundary,
  Workspace,
  WorkspaceShell,
} from "./Workspace";

function Root() {
  return (
    <SessionProvider>
      <SessionBoundary>
        <RouteFocus />
        <Outlet />
      </SessionBoundary>
    </SessionProvider>
  );
}
const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <Navigate to="/workspace" replace /> },
      { path: "/login", element: <Login /> },
      { path: "/signup", element: <Signup /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/reset-password", element: <ResetPassword /> },
      {
        element: <RequireSession />,
        children: [
          {
            element: <WorkspaceShell />,
            children: [
              { path: "/workspace", element: <Workspace /> },
              { path: "/subscriptions", element: <SubscriptionList /> },
              { path: "/subscriptions/:id", element: <SubscriptionDetail /> },
              {
                element: <RequireSession roles={["admin", "staff"]} />,
                children: [
                  {
                    path: "/subscriptions/new",
                    element: <SubscriptionEditorRoute />,
                  },
                  {
                    path: "/subscriptions/:id/edit",
                    element: <SubscriptionEditorRoute />,
                  },
                  {
                    path: "/customers",
                    element: <PeopleList key="customers" kind="customers" />,
                  },
                  {
                    path: "/configuration",
                    element: <CatalogLayout />,
                    children: [
                      {
                        index: true,
                        element: (
                          <Navigate to="/configuration/products" replace />
                        ),
                      },
                      ...(
                        [
                          "products",
                          "plans",
                          "taxes",
                          "quotation-templates",
                        ] as const
                      ).flatMap((kind) => [
                        {
                          path: kind,
                          element: <CatalogList key={kind} kind={kind} />,
                        },
                        {
                          path: `${kind}/:id`,
                          element: <CatalogDetail key={kind} kind={kind} />,
                        },
                      ]),
                      { path: "preview", element: <CatalogPricePreview /> },
                      {
                        element: <RequireSession roles={["admin"]} />,
                        children: (
                          [
                            "products",
                            "plans",
                            "taxes",
                            "quotation-templates",
                          ] as const
                        ).flatMap((kind) => [
                          {
                            path: `${kind}/new`,
                            element: <CatalogEditor kind={kind} />,
                          },
                          {
                            path: `${kind}/:id/edit`,
                            element: <CatalogEditor kind={kind} />,
                          },
                        ]),
                      },
                    ],
                  },
                ],
              },
              {
                element: <RequireSession roles={["admin"]} />,
                children: [
                  {
                    path: "/staff",
                    element: <PeopleList key="staff" kind="staff" />,
                  },
                  { path: "/staff/new", element: <AddStaff /> },
                  { path: "/deliveries", element: <Deliveries /> },
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
export function App() {
  return <RouterProvider router={router} />;
}
