import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldClassName } from "@/lib/field-style"

const FILE_CLASSES =
  "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClassName, FILE_CLASSES, className)}
      {...props}
    />
  )
}

export { Input }
