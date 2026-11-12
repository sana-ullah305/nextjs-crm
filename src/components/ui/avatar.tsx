import * as React from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

export function Avatar({
  name,
  color,
  size = "md",
  className,
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = { sm: "h-6 w-6 text-[10px]", md: "h-8 w-8 text-xs", lg: "h-10 w-10 text-sm" }[size];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-card",
        dims,
        className
      )}
      style={{ backgroundColor: color || "#6366f1" }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
