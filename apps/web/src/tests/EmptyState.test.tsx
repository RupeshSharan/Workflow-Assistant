import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../components/common/EmptyState";

describe("EmptyState Component", () => {
  it("renders title and message correctly", () => {
    render(<EmptyState title="No Work Items" message="Try creating one to start" />);

    expect(screen.getByText("No Work Items")).toBeInTheDocument();
    expect(screen.getByText("Try creating one to start")).toBeInTheDocument();
  });

  it("renders and handles action button click", () => {
    const handleAction = vi.fn();
    render(
      <EmptyState
        title="No Work Items"
        message="Try creating one to start"
        actionLabel="Create Item"
        onAction={handleAction}
      />
    );

    const button = screen.getByRole("button", { name: "Create Item" });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
