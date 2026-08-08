import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AgentBlockData } from "@/components/AgentBlock";

vi.mock("@/components/SubagentActionRow", () => ({
  SubagentActionRow: ({ block, expanded }: { block: AgentBlockData; expanded?: boolean }) => (
    <div data-testid="action" data-expanded={expanded ? "true" : "false"}>
      {block.id}
    </div>
  ),
}));

const { TaskAgentBlock } = await import("./TaskAgentBlock");

function taskBlock(childCount: number, taskComplete = false): AgentBlockData {
  return {
    id: "task-1",
    type: "tool_call",
    content: "{}",
    toolName: "Task",
    toolArgs: JSON.stringify({ description: "sub" }),
    taskComplete,
    childBlocks: Array.from({ length: childCount }, (_, i) => ({
      id: `child-${i}`,
      type: "text" as const,
      content: `step ${i}`,
    })),
  };
}

describe("TaskAgentBlock windowing", () => {
  it("renders a normal tool-style header with the last 5 actions under it", () => {
    render(<TaskAgentBlock block={taskBlock(12)} />);
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getAllByTestId("action")).toHaveLength(5);
    expect(screen.getByText("child-11")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /7 earlier actions/i }));

    expect(screen.getAllByTestId("action")).toHaveLength(12);
    expect(screen.getByText("child-0")).toBeInTheDocument();
    expect(screen.getAllByTestId("action")[0]).toHaveAttribute("data-expanded", "true");
  });

  it("still windows completed tasks until expanded", () => {
    render(<TaskAgentBlock block={taskBlock(12, true)} />);
    expect(screen.getAllByTestId("action")).toHaveLength(5);
    expect(screen.getByRole("button", { name: /expand sub-agent actions/i })).toBeInTheDocument();
  });

  it("does not window a small action list", () => {
    render(<TaskAgentBlock block={taskBlock(3)} />);
    expect(screen.getAllByTestId("action")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /earlier action/i })).toBeNull();
  });

  it("borders only the agent header tile — children float outside it", () => {
    const { container } = render(<TaskAgentBlock block={taskBlock(2)} />);
    const root = container.firstElementChild;
    expect(root?.className).not.toMatch(/\bborder\b/);
    const headerTile = root?.querySelector("[data-tool-family='task']");
    expect(headerTile?.className).toMatch(/\bborder\b/);
    expect(headerTile?.className).toMatch(/rounded-md/);
    expect(headerTile?.className).toMatch(/block-task-bg/);
    const actions = screen.getAllByTestId("action");
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(headerTile?.contains(action)).toBe(false);
    }
  });

  it("nests a Task/Agent child as another TaskAgentBlock at greater depth", () => {
    const nested: AgentBlockData = {
      id: "outer",
      type: "tool_call",
      content: "{}",
      toolName: "Agent",
      toolArgs: JSON.stringify({ description: "outer" }),
      taskComplete: true,
      childBlocks: [
        {
          id: "inner",
          type: "tool_call",
          content: "{}",
          toolName: "Task",
          toolArgs: JSON.stringify({ description: "inner" }),
          taskComplete: true,
          childBlocks: [{ id: "leaf", type: "text", content: "done" }],
        },
      ],
    };
    const { container } = render(<TaskAgentBlock block={nested} />);
    expect(screen.getByText("outer")).toBeInTheDocument();
    expect(screen.getByText("inner")).toBeInTheDocument();
    expect(screen.getByText("leaf")).toBeInTheDocument();
    const depths = [...container.querySelectorAll("[data-subagent-depth]")].map((el) =>
      el.getAttribute("data-subagent-depth"),
    );
    expect(depths).toEqual(["0", "1"]);
  });
});
