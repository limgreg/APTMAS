"use client";

// Route-level error boundary. The most common runtime error in this app is
// "Failed to execute 'removeChild' on 'Node'", caused by browser extensions /
// the built-in page-translation feature mutating the DOM around the streaming
// chat text. The <html translate="no"> guard in layout.tsx prevents it at the
// source; this boundary is a safety net so a crash degrades to a reload
// prompt instead of a white screen.
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        A browser extension or the page-translation feature may have interfered
        with the live update. The app has its own language switcher, so you can
        turn off auto-translate for this page and retry.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
