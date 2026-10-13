import { useMemo, type ReactElement } from "react";
import { InboxIcon } from "lucide-react";
import { SidebarConversationBlock } from "@/components/SidebarConversationBlock";
import { useSidebarAttention } from "@/components/SidebarAttentionProvider";
import { isStrongAttention, needsUser } from "@/lib/sidebar-attention";
import { useSidebarOption } from "@/stores/sidebar-config-store";

interface SectionProps {
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}

/**
 * "For me" (F2): every conversation waiting on the user, failed or unread,
 * across all projects, as one queue. Pending requests come first, then
 * failures, then unread replies; each group oldest first (E10), and a failure
 * leaves once opened. Agents at work stay out: nothing to do there yet.
 */
export function SidebarForMeSection(props: SectionProps): ReactElement | null {
  return useSidebarOption("forMe") ? <ForMeBlock {...props} /> : null;
}

function ForMeBlock({ activeFeatureId, onSelectFeature }: SectionProps): ReactElement | null {
  const { queue, loadingStates } = useSidebarAttention();
  const features = useMemo(() => queue.map((item) => item.feature), [queue]);
  const strongCount = useMemo(
    () => queue.filter((item) => isStrongAttention(item.state)).length,
    [queue],
  );
  return (
    <SidebarConversationBlock
      label="For me"
      icon={InboxIcon}
      surface="for-me"
      features={features}
      loading={loadingStates.some(needsUser)}
      empty="Nothing waiting on you"
      strongCount={strongCount}
      activeFeatureId={activeFeatureId}
      onSelectFeature={onSelectFeature}
    />
  );
}
