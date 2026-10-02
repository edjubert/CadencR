import { forwardRef, type MouseEventHandler, type ReactNode } from "react";
import { SidebarShortcutBadge } from "@/components/SidebarShortcutBadge";
import { useNavShortcutHint } from "@/hooks/useNavShortcutHints";

interface ProjectRowButtonProps {
  projectId: number;
  isActive: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}

/** Project row trigger with nav-shortcut registration and a forwarded context-menu ref. */
export const ProjectRowButton = forwardRef<HTMLButtonElement, ProjectRowButtonProps>(
  function ProjectRowButton({ projectId, isActive, onClick, children, ...rest }, forwardedRef) {
    const { navRef, badgeRef } = useNavShortcutHint<HTMLButtonElement>();
    const assignRef = (node: HTMLButtonElement | null): void => {
      navRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };
    return (
      <button
        ref={assignRef}
        type="button"
        data-nav-item
        data-nav-type="project"
        data-nav-id={String(projectId)}
        onClick={onClick}
        className={`group/project relative flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm outline-none transition-colors ${
          isActive ? "text-accent-foreground font-medium" : "hover:bg-accent/50"
        }`}
        {...rest}
      >
        <SidebarShortcutBadge ref={badgeRef} />
        {children}
      </button>
    );
  },
);
