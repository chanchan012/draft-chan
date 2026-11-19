import { createRoot } from "react-dom/client";
import { Dashboard } from "../../components/dashboard";

createRoot(document.getElementById("root")!).render(
  <Dashboard account={<button aria-label="Account">D</button>} />,
);
