import { serve } from "inngest/next";
import {
  inngest,
  thumbnailJob,
  recoverThumbnails,
} from "@/lib/server/thumbnails";
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [thumbnailJob, recoverThumbnails],
});
