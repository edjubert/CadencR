import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Search, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";

export function MarketplaceSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 pl-9 text-sm"
      />
    </div>
  );
}

export function MarketplaceEmpty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

export function MarketplaceDisclosure({
  children,
  label = "Security & diagnostics",
}: {
  children: React.ReactNode;
  label?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-0 text-xs text-muted-foreground"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight aria-hidden="true" className={`size-3 ${open ? "rotate-90" : ""}`} />
        {label}
      </Button>
      <div id={id}>
        <CollapsibleSection open={open}>
          <div className="space-y-1 border-l border-border pl-3 text-xs text-muted-foreground">
            {children}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
