import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, LayoutDashboard } from "lucide-react";
import { api } from "../api";
import type { Session, WorkItem } from "../types";
import { StatCard } from "../components/dashboard/StatCard";
import { CreateItemForm } from "../components/dashboard/CreateItemForm";
import { BoardColumn } from "../components/dashboard/BoardColumn";
import { WorkItemPanel } from "../components/work-items/WorkItemPanel";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { EmptyState } from "../components/common/EmptyState";

interface DashboardProps {
  session: Session;
}

export function Dashboard({ session }: DashboardProps) {
  const queryClient = useQueryClient();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  const summary = useQuery({
    queryKey: ["summary", session.activeWorkspaceId],
    queryFn: () => api.summary(session)
  });
  const workflows = useQuery({
    queryKey: ["workflows", session.activeWorkspaceId],
    queryFn: () => api.workflows(session)
  });
  const workItems = useQuery({
    queryKey: ["work-items", session.activeWorkspaceId],
    queryFn: () => api.workItems(session)
  });

  const allWorkflows = workflows.data?.workflows ?? [];
  useEffect(() => {
    if (!allWorkflows.length) return;
    if (!allWorkflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(allWorkflows.find((workflow) => workflow.isDefault)?.id ?? allWorkflows[0]!.id);
    }
  }, [allWorkflows, selectedWorkflowId]);

  const selectedWorkflow = allWorkflows.find((workflow) => workflow.id === selectedWorkflowId);
  const visibleItems = (workItems.data?.items ?? []).filter(
    (item) => !selectedWorkflow || item.templateId === selectedWorkflow.id
  );

  const createMutation = useMutation({
    mutationFn: (input: { title: string; description: string; priority: WorkItem["priority"] }) =>
      api.createItem(session, { ...input, templateId: selectedWorkflow?.id }),
    onMutate: async (newItemInput) => {
      await queryClient.cancelQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      const previousItems = queryClient.getQueryData<{ items: WorkItem[]; pagination: any }>(["work-items", session.activeWorkspaceId]);

      if (previousItems && selectedWorkflow?.stages[0]) {
        const tempItem: WorkItem = {
          id: `temp-${Date.now()}`,
          title: newItemInput.title,
          description: newItemInput.description || null,
          priority: newItemInput.priority,
          stageId: selectedWorkflow.stages[0].id,
          stageName: selectedWorkflow.stages[0].name,
          stageColor: selectedWorkflow.stages[0].color,
          stageTerminal: selectedWorkflow.stages[0].isTerminal,
          typeName: "general",
          templateId: selectedWorkflow.id,
          templateName: selectedWorkflow.name,
          assigneeName: null,
          reporterName: session.user.name || "You",
          dueDate: null
        };

        queryClient.setQueryData(["work-items", session.activeWorkspaceId], {
          ...previousItems,
          items: [tempItem, ...previousItems.items]
        });
      }

      return { previousItems };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(["work-items", session.activeWorkspaceId], context.previousItems);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
    }
  });

  const transitionMutation = useMutation({
    mutationFn: ({ itemId, stageId }: { itemId: string; stageId: string }) =>
      api.transitionItem(session, itemId, stageId),
    onMutate: async ({ itemId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      const previousItems = queryClient.getQueryData<{ items: WorkItem[]; pagination: any }>(["work-items", session.activeWorkspaceId]);

      if (previousItems) {
        queryClient.setQueryData(["work-items", session.activeWorkspaceId], {
          ...previousItems,
          items: previousItems.items.map((item) =>
            item.id === itemId ? { ...item, stageId } : item
          )
        });
      }

      return { previousItems };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(["work-items", session.activeWorkspaceId], context.previousItems);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
    }
  });

  if (workflows.isLoading || workItems.isLoading) {
    return <LoadingSpinner message="Loading delivery board..." />;
  }

  return (
    <section className="dashboard">
      <div className="stats">
        <StatCard label="Active items" value={summary.data?.metrics.total ?? 0} />
        <StatCard label="Overdue" value={summary.data?.metrics.overdue ?? 0} tone="danger" />
        <StatCard label="High priority" value={summary.data?.metrics.priority ?? 0} tone="accent" />
        <StatCard label="Automations" value="Phase 3" compact />
      </div>

      <div className="board-header">
        <div>
          <p className="eyebrow">Work board</p>
          <h3>Configurable delivery flow</h3>
        </div>
        <div className="board-controls">
          <SlidersHorizontal size={16} />
          {allWorkflows.length > 0 && (
            <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
              {allWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {allWorkflows.length === 0 ? (
        <EmptyState
          title="No Active Workflows"
          message="Define workflow stages and categories to build a Kanban board for your workspace."
          icon={<LayoutDashboard size={40} />}
        />
      ) : (
        <>
          <CreateItemForm onSubmit={(input) => createMutation.mutate(input)} pending={createMutation.isPending} />
          {createMutation.error && <p className="form-error">{createMutation.error.message}</p>}

          <div className="board">
            {selectedWorkflow?.stages.map((stage, index) => (
              <BoardColumn
                key={stage.id}
                stage={stage}
                items={visibleItems.filter((item) => item.stageId === stage.id)}
                nextStage={selectedWorkflow.stages[index + 1]}
                onAdvance={(itemId, stageId) => transitionMutation.mutate({ itemId, stageId })}
                onOpen={setSelectedItem}
              />
            ))}
          </div>
        </>
      )}

      {selectedItem && (
        <WorkItemPanel item={selectedItem} session={session} onClose={() => setSelectedItem(null)} />
      )}
    </section>
  );
}
