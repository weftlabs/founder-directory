import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBuilderDnaExamples } from "@/lib/builder-dna-local";
import BuilderDnaPreview from "./preview";

export const metadata: Metadata = {
  title: "Builder DNA · Local research preview",
  description: "An evidence-led, local exploration of how founders build.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BuilderDnaPage() {
  if (process.env.BUILDER_DNA_PREVIEW !== "1") notFound();
  const examples = await getBuilderDnaExamples();
  return <BuilderDnaPreview examples={examples} />;
}
