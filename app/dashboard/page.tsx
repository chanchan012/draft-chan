import { Dashboard } from "@/components/dashboard";
import { clerkEnabled } from "@/lib/server/auth";
import "./dashboard.css";

export default function DashboardPage() {
  return <Dashboard accountsEnabled={clerkEnabled()} />;
}
