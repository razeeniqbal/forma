import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "@/store/app";
import { Shell } from "@/components/Shell";
import { CommandPalette } from "@/components/CommandPalette";
import { ConfirmHost, Toasts } from "@/components/ui";
import { PipelinesPage } from "@/pages/PipelinesPage";
import { CreatePipelinePage } from "@/pages/CreatePipelinePage";
import { WorkspacePage } from "@/pages/workspace/WorkspacePage";
import { ValidatePage } from "@/pages/ValidatePage";
import { ReviewPage } from "@/pages/ReviewPage";
import { RunPage } from "@/pages/RunPage";
import { RunsPage } from "@/pages/RunsPage";
import { ExportPage } from "@/pages/ExportPage";
import { SourcesPage } from "@/pages/SourcesPage";
import { DestinationsPage } from "@/pages/DestinationsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { HelpPage } from "@/pages/HelpPage";

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
          <Route index element={<Navigate to="/pipelines" replace />} />
          <Route path="pipelines" element={<PipelinesPage />} />
          <Route path="pipelines/new" element={<CreatePipelinePage />} />
          <Route path="pipelines/:id" element={<WorkspacePage />} />
          <Route path="pipelines/:id/validate" element={<ValidatePage />} />
          <Route path="pipelines/:id/export" element={<ExportPage />} />
          <Route path="pipelines/:id/review" element={<ReviewPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunPage />} />
          <Route path="runs/:runId/review" element={<ReviewPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="destinations" element={<DestinationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/pipelines" replace />} />
        </Route>
      </Routes>
      <CommandPalette />
      <ConfirmHost />
      <Toasts />
    </BrowserRouter>
  );
}
