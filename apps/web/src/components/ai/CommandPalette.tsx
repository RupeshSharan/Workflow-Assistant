import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Sparkles, LayoutDashboard, FileText } from "lucide-react";
import { api } from "../../api";
import type { Session } from "../../types";

interface CommandPaletteProps {
  session: Session;
  onClose: () => void;
  onNavigate: (
    section:
      | "dashboard"
      | "workflows"
      | "documents"
      | "ai"
      | "automations"
      | "notifications"
      | "settings"
      | "analytics",
    query?: string
  ) => void;
}

export function CommandPalette({
  session,
  onClose,
  onNavigate
}: CommandPaletteProps) {
  const [queryVal, setQueryVal] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: workItems } = useQuery({
    queryKey: ["work-items", session.activeWorkspaceId],
    queryFn: () => api.workItems(session)
  });

  const semanticSearch = useQuery({
    queryKey: ["command-palette-semantic-search", session.activeWorkspaceId, queryVal],
    queryFn: () => api.searchDocuments(session, { query: queryVal, topK: 3 }),
    enabled: queryVal.trim().length > 2
  });

  const filteredItems = (workItems?.items ?? [])
    .filter((item) => item.title.toLowerCase().includes(queryVal.toLowerCase()))
    .slice(0, 4);

  const semanticMatches = semanticSearch.data?.matches ?? [];

  const options = useMemo(() => {
    const list: Array<{
      type: "action" | "item" | "doc";
      label: string;
      subtitle?: string;
      action: () => void;
    }> = [];

    if (queryVal.trim().length > 0) {
      list.push({
        type: "action",
        label: `Run AI Action: "${queryVal}"`,
        subtitle: "Submit to AI agent for planning and confirmation",
        action: () => {
          onNavigate("ai", queryVal);
          onClose();
        }
      });
    }

    list.push({
      type: "action",
      label: "Ask AI Assistant a question...",
      subtitle: "Semantic search across workspace knowledge",
      action: () => {
        onNavigate("ai");
        onClose();
      }
    });

    list.push({
      type: "action",
      label: "Create a work item...",
      subtitle: "Add a new task to standard board",
      action: () => {
        onNavigate("dashboard");
        onClose();
      }
    });

    filteredItems.forEach((item) => {
      list.push({
        type: "item",
        label: item.title,
        subtitle: `Work Item • ${item.stageName} • ${item.assigneeName ?? "Unassigned"}`,
        action: () => {
          onNavigate("dashboard");
          onClose();
        }
      });
    });

    semanticMatches.forEach((match) => {
      list.push({
        type: "doc",
        label: match.title,
        subtitle: `Doc Match: "${match.chunkText.slice(0, 60)}..."`,
        action: () => {
          onNavigate("documents");
          onClose();
        }
      });
    });

    return list;
  }, [queryVal, filteredItems, semanticMatches, onNavigate, onClose]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % options.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + options.length) % options.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (options[selectedIndex]) {
          options[selectedIndex].action();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [options, selectedIndex, onClose]);

  return (
    <div className="command-palette-backdrop" onClick={onClose} role="presentation">
      <div className="command-palette" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="command-palette-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Type a command or search workspace..."
            value={queryVal}
            onChange={(e) => {
              setQueryVal(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>
        <div className="command-palette-results">
          {options.length === 0 ? (
            <p className="muted-message" style={{ padding: "1rem" }}>No commands or matches found.</p>
          ) : (
            options.map((option, index) => (
              <button
                key={index}
                className={`command-palette-item ${selectedIndex === index ? "selected" : ""}`}
                onClick={option.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {option.type === "action" ? (
                  <Sparkles size={16} />
                ) : option.type === "item" ? (
                  <LayoutDashboard size={16} />
                ) : (
                  <FileText size={16} />
                )}
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <span>{option.label}</span>
                  {option.subtitle && (
                    <small style={{ color: "#8a958f", fontSize: "0.75rem", fontWeight: "normal" }}>
                      {option.subtitle}
                    </small>
                  )}
                </div>
                {selectedIndex === index && <kbd>Enter</kbd>}
              </button>
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>Use <kbd>↑↓</kbd> to navigate, <kbd>Enter</kbd> to select, <kbd>ESC</kbd> to close.</span>
        </div>
      </div>
    </div>
  );
}
