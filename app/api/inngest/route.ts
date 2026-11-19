import { serve } from "inngest/next";
import { blueprintJob, recoverBlueprints } from "@/lib/server/blueprint-jobs";
import {
  inngest,
  thumbnailJob,
  recoverThumbnails,
} from "@/lib/server/thumbnails";
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [thumbnailJob, recoverThumbnails, blueprintJob, recoverBlueprints],
});
