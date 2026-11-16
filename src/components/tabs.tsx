"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabItem {
  href: string;
  label: string;
}

interface TabsProps {
  label: string;
  /** The first item is the section's index: it is current only on an exact match. */
  items: TabItem[];
}

/** Section navigation rendered as a row of links. */
export function Tabs({ label, items }: TabsProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="border-line border-b print:hidden">
      <ul className="-mb-px flex flex-wrap gap-x-1">
        {items.map((item, index) => {
          const current =
            index === 0
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`block border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  current
                    ? "border-accent text-accent"
                    : "text-muted hover:text-ink border-transparent"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
