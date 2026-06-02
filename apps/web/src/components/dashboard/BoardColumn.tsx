import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Stage, WorkItem } from "../../types";

interface BoardColumnProps {
  stage: Stage;
  items: WorkItem[];
  nextStage?: Stage;
  onAdvance: (itemId: string, stageId: string) => void;
  onOpen: (item: WorkItem) => void;
}

export function BoardColumn({
  stage,
  items,
  nextStage,
  onAdvance,
  onOpen
}: BoardColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData("text/plain", itemId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData("text/plain");
    if (itemId) {
      onAdvance(itemId, stage.id);
    }
  };

  return (
    <div
      className={`column ${isDragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        border: isDragOver ? `2px dashed ${stage.color}` : "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "12px",
        transition: "all 0.2s ease"
      }}
    >
      <header>
        <span className="stage-dot" style={{ background: stage.color }} />
        <strong>{stage.name}</strong>
        <small>{items.length}</small>
      </header>
      <div className="cards-container" style={{ minHeight: "200px" }}>
        {items.map((item) => (
          <article
            className="work-card"
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, item.id)}
            style={{ cursor: "grab" }}
          >
            <span className={`priority ${item.priority}`}>{item.priority}</span>
            <button className="card-title" onClick={() => onOpen(item)}>
              {item.title}
            </button>
            <p>{item.assigneeName ?? "Unassigned"}</p>
            {nextStage && (
              <button onClick={() => onAdvance(item.id, nextStage.id)}>
                Move to {nextStage.name} <ChevronRight size={14} />
              </button>
            )}
          </article>
        ))}
        {!items.length && <p className="column-empty">No items in this stage</p>}
      </div>
    </div>
  );
}
