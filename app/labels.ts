import type { ProjectStatus } from "@/lib/store";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  queued: "Waiting",
  extracting: "Extracting audio",
  transcribing: "Transcribing",
  analysing: "Finding clips",
  ready: "Ready",
  failed: "Failed",
};
