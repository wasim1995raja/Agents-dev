import type { Metadata } from "next";

import { ProjectWorkspace } from "@/components/ProjectWorkspace";

export const metadata: Metadata = {
  title: "Project workspace — AutoDev Agent",
};

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectWorkspace projectId={id} />;
}
