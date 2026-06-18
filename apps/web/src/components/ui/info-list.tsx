import * as React from "react"

import { cn } from "@/lib/utils"

function InfoList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="info-list"
      className={cn(
        "divide-y divide-border overflow-hidden rounded-2xl bg-muted/40",
        className
      )}
      {...props}
    />
  )
}

function InfoRow({
  label,
  value,
  mono,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div
      data-slot="info-row"
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3.5",
        className
      )}
    >
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-sm font-medium text-foreground",
          mono && "font-mono"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export { InfoList, InfoRow }
