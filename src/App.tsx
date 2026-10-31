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
              {
                element: <RequireSession roles={["admin", "staff"]} />,
                children: [
                  {
                    path: "/customers",
                    element: <PeopleList key="customers" kind="customers" />,
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
