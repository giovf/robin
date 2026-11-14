import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons or links shown beside the title. */
  actions?: ReactNode;
  /** Heading level; pages nested under a customer or solution use h2/h3. */
  as?: "h1" | "h2" | "h3";
}

export function PageHeader({
  title,
  description,
  actions,
  as: Heading = "h1",
}: PageHeaderProps) {
  const size =
    Heading === "h1" ? "text-2xl" : Heading === "h2" ? "text-lg" : "text-base";
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Heading className={`${size} font-semibold tracking-tight`}>
          {title}
        </Heading>
        {description ? (
          <p className="text-muted mt-1 max-w-prose text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
