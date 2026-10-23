import { Text, planLabel } from "../common";

export function label(code: string) {
  const names: Record<string, string> = {
    prolite: "Pro 100",
    pro: "Pro 200",
    promax: "Pro 500",
    team: "Business",
    self_serve_business_usage_based: "Business",
    self_serve_business_prolite: "Business Premium",
    business: "Enterprise",
    ent26: "Enterprise",
    enterprise_cbp_usage_based: "Enterprise",
    enterprise_cbp_automation: "Enterprise (Automation)",
  };
  return names[code] ? new Text(names[code]) : planLabel(code);
}
