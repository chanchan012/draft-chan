import { createRoot } from "react-dom/client";
import { Studio } from "../../components/studio/studio";
import type { StudioDocument } from "../../lib/plans/studio-document";
import type { ProjectRole } from "../../lib/plans/projects";

const host = document.getElementById("root")!;
const initial = JSON.parse(host.dataset.document!) as StudioDocument;
createRoot(host).render(
  <Studio
    initial={initial}
    actor={{ kind: "human", id: "studio-test" }}
    projectRole={host.dataset.projectRole as ProjectRole | undefined}
  />,
);
