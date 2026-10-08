import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { ConfirmDialog } from "./ConfirmDialog";

it("keeps an async confirmation open and disabled until it completes", async () => {
  let finish: () => void = () => {
    throw new Error("Confirmation did not start.");
  };
  const confirm = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );

  function Harness() {
    const [open, setOpen] = useState(true);
    const [busy, setBusy] = useState(false);
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Confirm change?"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await confirm();
          setBusy(false);
        }}
      />
    );
  }

  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  finish();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("stays open when the caller reports an already-presented failure", async () => {
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Confirm change?"
      onConfirm={() => false}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
