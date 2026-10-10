import { cn } from "@/lib/utils";

/** The floating surface every piece of editor chrome sits on. */
export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl bg-surface shadow-float backdrop-blur-md", className)} {...props} />;
}
