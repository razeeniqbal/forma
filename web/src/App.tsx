import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "@/store/app";
import { Shell } from "@/components/Shell";
import { CommandPalette } from "@/components/CommandPalette";
import { ConfirmHost, Toasts } from "@/components/ui";
import { ProjectsPage } from "@/pages/projects/ProjectsPage";
import { NewProjectPage } from "@/pages/projects/NewProjectPage";
import { ProjectOverview } from "@/pages/projects/ProjectOverview";
import { ProjectSources } from "@/pages/projects/ProjectSources";
import { ProjectPipelines } from "@/pages/projects/ProjectPipelines";
import { CreatePipelinePage } from "@/pages/projects/CreatePipelinePage";
import { ProjectSettings } from "@/pages/projects/ProjectSettings";
import { WorkspacePage } from "@/pages/workspace/WorkspacePage";
import { ValidatePage } from "@/pages/ValidatePage";
import { ReviewPage } from "@/pages/ReviewPage";
import { RunPage } from "@/pages/RunPage";
import { RunsPage } from "@/pages/RunsPage";
import { ExportPage } from "@/pages/ExportPage";
import { DestinationsPage } from "@/pages/DestinationsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DocsPage } from "@/pages/DocsPage";

export function App() {
  const ready = useApp((s) => s.ready);
  const hydrate = useApp((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  if (!ready)
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
        <img src="/brand/forma-symbol-blue.svg" width={40} height={40} alt="FORMA" style={{ opacity: 0.6 }} />
      </div>
    );
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:projectId" element={<ProjectOverview />} />
          <Route path="projects/:projectId/sources" element={<ProjectSources />} />
          <Route path="projects/:projectId/pipelines" element={<ProjectPipelines />} />
          <Route path="projects/:projectId/pipelines/new" element={<CreatePipelinePage />} />
          <Route path="projects/:projectId/runs" element={<RunsPage />} />
          <Route path="projects/:projectId/settings" element={<ProjectSettings />} />
          {/* Pipelines and runs have global ids; their project is derived for navigation. */}
          <Route path="pipelines/:id" element={<WorkspacePage />} />
          <Route path="pipelines/:id/validate" element={<ValidatePage />} />
          <Route path="pipelines/:id/export" element={<ExportPage />} />
          <Route path="pipelines/:id/review" element={<ReviewPage />} />
          <Route path="runs/:runId" element={<RunPage />} />
          <Route path="runs/:runId/review" element={<ReviewPage />} />
          <Route path="destinations" element={<DestinationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="docs/:slug" element={<DocsPage />} />
          <Route path="help" element={<Navigate to="/docs" replace />} />
          {/* Pre-project URLs. */}
          <Route path="pipelines" element={<Navigate to="/projects" replace />} />
          <Route path="pipelines/new" element={<Navigate to="/projects" replace />} />
          <Route path="sources" element={<Navigate to="/projects" replace />} />
          <Route path="runs" element={<Navigate to="/projects" replace />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
      <CommandPalette />
      <ConfirmHost />
      <Toasts />
    </BrowserRouter>
  );
}
