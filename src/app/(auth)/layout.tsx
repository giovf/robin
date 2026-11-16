import { RobinMark } from "@/components/robin-mark";
import { cardClass } from "@/components/ui";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <RobinMark className="text-xl" />
        <div className={`${cardClass} p-6 shadow-sm`}>{children}</div>
      </div>
    </main>
  );
}
