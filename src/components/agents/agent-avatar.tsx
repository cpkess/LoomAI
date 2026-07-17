import { Bot } from "lucide-react";

import { cn, initials } from "@/lib/utils";

const SIZES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
};

export function AgentAvatar({
  name,
  color,
  size = "md",
  className,
}: {
  name: string;
  color?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: color ?? "#64748b" }}
      title={name}
    >
      {initials(name)}
      <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-background p-0.5">
        <Bot className={size === "lg" ? "size-3.5" : "size-2.5"} />
      </span>
    </div>
  );
}
