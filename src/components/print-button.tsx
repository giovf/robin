"use client";

import { secondaryButtonClass } from "./ui";

/** Opens the browser's print dialog (which also offers "Save as PDF"). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={secondaryButtonClass}
    >
      Print / PDF
    </button>
  );
}
