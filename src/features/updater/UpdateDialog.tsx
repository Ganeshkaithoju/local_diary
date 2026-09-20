import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { useAppUpdater } from "./useAppUpdater";

export function UpdateDialog() {
  const { updateInfo, isInstalling, statusText, skipUpdate, installUpdate } =
    useAppUpdater();

  if (!updateInfo) return null;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open && !isInstalling) skipUpdate();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <DialogTitle className="mt-2 text-base">
            New update available — Local Diary Core v{updateInfo.version}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {updateInfo.body
              ? updateInfo.body
              : "A new signed release is available. Your existing local diary data, books, and App Lock configuration will remain untouched."}
          </DialogDescription>
        </DialogHeader>

        {isInstalling && statusText && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-primary font-mono">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{statusText}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={skipUpdate}
            disabled={isInstalling}
          >
            Skip for now
          </Button>
          <Button
            size="sm"
            onClick={() => void installUpdate()}
            disabled={isInstalling}
            className="gap-1.5"
          >
            {isInstalling && <Loader2 className="size-3.5 animate-spin" />}
            {isInstalling ? "Applying…" : "Install now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
