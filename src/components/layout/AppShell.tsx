import * as Dialog from "@radix-ui/react-dialog";
import { Menu, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { AddCourseModal } from "@/components/courses/AddCourseModal";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-[68px] shrink-0 border-r md:block lg:hidden">
        <Sidebar compact />
      </aside>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r lg:block">
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur md:hidden">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger className="rounded-lg p-1.5 hover:bg-secondary" aria-label="Open menu"><Menu className="h-5 w-5" /></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <Sidebar onNavigate={() => setOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <span className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />StudyAI</span>
        </header>
        <main className="relative flex-1">
          <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-80" />
          <div className="relative mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">{children}</div>
        </main>
      </div>
      <AddCourseModal />
    </div>
  );
}
