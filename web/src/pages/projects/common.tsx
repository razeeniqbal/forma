import { Link } from "react-router-dom";
import { FolderKanban } from "lucide-react";
import { Empty } from "@/components/ui";

export function ProjectNotFound() {
  return (
    <div className="page">
      <Empty icon={<FolderKanban size={22} />} title="Project not found" action={<Link className="btn" to="/projects">All projects</Link>}>
        It may have been deleted.
      </Empty>
    </div>
  );
}
