import { type ReactNode } from "react";

import { UtilityBar } from "../../../components/UtilityBar";

import type { OutlineSection } from "../outline";
import { DocumentOutline } from "./DocumentOutline";

interface PenaLayoutProps {
  activeSectionId: string | null;
  children: ReactNode;
  sections: OutlineSection[];
  workspaceSlug: string | null;
}

export function PenaLayout({
  activeSectionId,
  children,
  sections,
  workspaceSlug,
}: PenaLayoutProps) {
  return (
    <div className="app-shell">
      <UtilityBar current={null} workspaceSlug={workspaceSlug} />

      <main className="workspace">
        <DocumentOutline
          activeSectionId={activeSectionId}
          sections={sections}
          workspaceSlug={workspaceSlug}
        />
        {children}
      </main>
    </div>
  );
}
