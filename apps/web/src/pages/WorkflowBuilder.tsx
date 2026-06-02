import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../api";
import { Field } from "../components/common/Field";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session, Workflow } from "../types";

interface WorkflowBuilderProps {
  session: Session;
  canEdit: boolean;
}

export function WorkflowBuilder({ session, canEdit }: WorkflowBuilderProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [stageNames, setStageNames] = useState("Requested, Reviewing, Approved");
  const [makeDefault, setMakeDefault] = useState(false);
  const [inputError, setInputError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");

  const workflows = useQuery({
    queryKey: ["workflows", session.activeWorkspaceId],
    queryFn: () => api.workflows(session)
  });

  const colors = useMemo(() => ["#64748b", "#2563eb", "#7c3aed", "#16a34a"], []);

  const mutation = useMutation({
    mutationFn: (workflow: {
      name: string;
      category: string;
      isDefault: boolean;
      stages: Array<{ name: string; color: string; isTerminal: boolean }>;
    }) => api.createWorkflow(session, workflow),
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["workflows", session.activeWorkspaceId] });
    }
  });

  const draftMutation = useMutation({
    mutationFn: () => api.draftWorkflow(session, aiPrompt),
    onSuccess: ({ draft }) => {
      setName(draft.name);
      setCategory(draft.category);
      setStageNames(draft.stages.map((stage) => stage.name).join(", "));
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const labels = stageNames.split(",").map((stage) => stage.trim()).filter(Boolean);
    if (labels.length < 2) {
      setInputError("Provide at least two comma-separated stages.");
      return;
    }
    setInputError("");
    mutation.mutate({
      name,
      category,
      isDefault: makeDefault,
      stages: labels.map((label, index) => ({
        name: label,
        color: colors[index % colors.length]!,
        isTerminal: index === labels.length - 1
      }))
    });
  }

  return (
    <section className="workflow-page">
      <div className="page-intro">
        <p className="eyebrow">Workflow builder</p>
        <h3>Templates adapt this platform to each team.</h3>
        <p>Create reusable stages now; natural language generation will plug into this same model.</p>
      </div>

      {canEdit && (
        <>
          <form
            className="workflow-ai-draft"
            onSubmit={(event) => {
              event.preventDefault();
              draftMutation.mutate();
            }}
          >
            <Sparkles size={17} />
            <input
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="Describe a workflow, for example: screen event proposals before approval"
              required
            />
            <button className="primary" disabled={draftMutation.isPending}>
              Draft with AI
            </button>
          </form>
          {draftMutation.error && <p className="form-error">{draftMutation.error.message}</p>}

          <form className="workflow-form" onSubmit={submit}>
            <Field label="Template name" value={name} onChange={setName} />
            <Field label="Category" value={category} onChange={setCategory} />
            <Field label="Stages (comma separated)" value={stageNames} onChange={setStageNames} />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(event) => setMakeDefault(event.target.checked)}
              />
              Use as default workflow for this category
            </label>
            {(inputError || mutation.error) && (
              <p className="form-error">{inputError || mutation.error?.message}</p>
            )}
            <button className="primary" disabled={mutation.isPending}>
              Create template
            </button>
          </form>
        </>
      )}

      {workflows.isLoading ? (
        <LoadingSpinner message="Loading workflow templates..." />
      ) : (
        <div className="template-grid">
          {workflows.data?.workflows.map((workflow: Workflow) => (
            <article className="template-card" key={workflow.id}>
              <div>
                <h4>{workflow.name}</h4>
                <span>{workflow.category}</span>
                {workflow.isDefault && <small>Default</small>}
              </div>
              <div className="template-stages">
                {workflow.stages.map((stage) => (
                  <span key={stage.id} style={{ borderColor: stage.color }}>
                    {stage.name}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
