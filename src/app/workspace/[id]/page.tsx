import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Editor } from "@/components/editor/editor";
import { WORKSPACE_ID_RE } from "@/lib/collab/ids";

export const metadata: Metadata = {
  title: "Shared canvas · OpenCanvas",
};

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!WORKSPACE_ID_RE.test(id)) notFound();
  return <Editor workspaceId={id} />;
}

export default function WorkspacePage(props: PageProps<"/workspace/[id]">) {
  // The id is only known per request; everything else can be prerendered.
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-background" />}>
      <Workspace params={props.params} />
    </Suspense>
  );
}
