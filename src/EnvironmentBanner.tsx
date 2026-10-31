import { useEffect, useState } from "react";
import type { RuntimeEnvironment } from "../shared/contracts";
import { request } from "./api";
import { formatBusinessDate } from "./Workspace";

let environment: Promise<RuntimeEnvironment> | null = null;
function loadEnvironment() {
  return (environment ||= request<RuntimeEnvironment>("/api/environment"));
}
export function EnvironmentBanner() {
  const [value, setValue] = useState<RuntimeEnvironment | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    loadEnvironment()
      .then((result) => {
        if (current) setValue(result);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);
  if (failed)
    return (
      <div className="environment-banner" role="note">
        Environment details are unavailable. Reload to check the business date.
      </div>
    );
  if (!value?.demoLabel) return null;
  return (
    <div className="environment-banner" role="note">
      <strong>{value.demoLabel}</strong>
      <span>
        Synthetic business date · {formatBusinessDate(value.businessDate)} ·{" "}
        {value.timezone}
      </span>
    </div>
  );
}
