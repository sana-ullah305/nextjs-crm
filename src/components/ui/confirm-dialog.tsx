"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  disabled,
}: ConfirmDialogProps) {
  const [confirming, setConfirming] = React.useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-6 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      )}>
        <DialogTitle className="text-lg font-semibold leading-none tracking-tight">
          {title}
        </DialogTitle>
        {description && (
          <DialogDescription className="text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant}
            disabled={confirming || disabled}
            onClick={handleConfirm}
          >
            {confirming ? "Confirming…" : confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}

const ConfirmDialogContext = React.createContext<{
  confirm: (options: Omit<ConfirmDialogState, "open">) => void;
} | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmDialogState | null>(null);

  const confirm = React.useCallback((options: Omit<ConfirmDialogState, "open">) => {
    setState({ ...options, open: true });
  }, []);

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (!open) setState(null);
  }, []);

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <ConfirmDialog
          {...state}
          onOpenChange={handleOpenChange}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirm() {
  const context = React.useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmDialogProvider");
  }
  return context;
}

// Helper hook for simpler usage without provider
export function useConfirmDialog() {
  const [dialogState, setDialogState] = React.useState<{
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "default" | "destructive";
    onConfirm: () => void | Promise<void>;
    disabled?: boolean;
  } | null>(null);

  const confirm = React.useCallback(
    (options: Omit<ConfirmDialogState, "open">) => {
      setDialogState({ ...options, open: true });
    },
    []
  );

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (!open) setDialogState(null);
  }, []);

  return {
    confirm,
    ConfirmDialog: dialogState ? (
      <ConfirmDialog
        {...dialogState}
        onOpenChange={handleOpenChange}
      />
    ) : null,
  };
}
