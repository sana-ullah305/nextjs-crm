"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

type ToastVariant = "default" | "success" | "error" | "warning" | "info";

interface ToastProps {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  action?: React.ReactNode;
  onClose: (id: string) => void;
  duration?: number;
}

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border bg-card",
  success: "border-success/30 bg-success/10",
  error: "border-destructive/30 bg-destructive/10",
  warning: "border-warning/30 bg-warning/10",
  info: "border-primary/30 bg-primary/10",
};

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  default: null,
  success: <CheckCircle className="h-5 w-5 text-success" />,
  error: <AlertCircle className="h-5 w-5 text-destructive" />,
  warning: <AlertTriangle className="h-5 w-5 text-warning" />,
  info: <Info className="h-5 w-5 text-primary" />,
};

function Toast({ id, title, description, variant = "default", action, onClose, duration = 5000 }: ToastProps) {
  const [isVisible, setIsVisible] = React.useState(true);
  const [isExiting, setIsExiting] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        setIsVisible(false);
        onClose(id);
      }, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        "relative flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-80 data-[state=open]:fade-in-0",
        "data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full",
        variantStyles[variant],
        isExiting && "opacity-0 transition-opacity duration-200"
      )}
      role="alert"
      aria-live="polite"
    >
      {variantIcons[variant] && (
        <div className="flex shrink-0 mt-0.5" aria-hidden="true">
          {variantIcons[variant]}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {title && (
          <div className="text-sm font-medium text-foreground">{title}</div>
        )}
        {description && (
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
      <button
        type="button"
        className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground/50 hover:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        onClick={() => {
          setIsExiting(true);
          setTimeout(() => onClose(id), 200);
        }}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ToastProviderProps {
  children: React.ReactNode;
}

interface ToastState {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  action?: React.ReactNode;
  duration?: number;
}

const ToastContext = React.createContext<{
  toasts: ToastState[];
  addToast: (toast: Omit<ToastState, "id">) => string;
  removeToast: (id: string) => void;
  toast: (options: Omit<ToastState, "id">) => string;
  success: (options: Omit<ToastState, "id" | "variant">) => string;
  error: (options: Omit<ToastState, "id" | "variant">) => string;
  warning: (options: Omit<ToastState, "id" | "variant">) => string;
  info: (options: Omit<ToastState, "id" | "variant">) => string;
  promise: (
    input: Promise<unknown>,
    options: {
      loading?: string | Omit<ToastState, "id" | "variant">;
      success?: string | ((data: unknown) => string | Omit<ToastState, "id" | "variant">);
      error?: string | ((error: Error) => string | Omit<ToastState, "id" | "variant">);
    }
  ) => Promise<unknown>;
} | null>(null);

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<ToastState[]>([]);

  const addToast = React.useCallback((toast: Omit<ToastState, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (options: Omit<ToastState, "id">) => addToast(options),
    [addToast]
  );

  const success = React.useCallback(
    (options: Omit<ToastState, "id" | "variant">) =>
      addToast({ ...options, variant: "success" }),
    [addToast]
  );

  const error = React.useCallback(
    (options: Omit<ToastState, "id" | "variant">) =>
      addToast({ ...options, variant: "error" }),
    [addToast]
  );

  const warning = React.useCallback(
    (options: Omit<ToastState, "id" | "variant">) =>
      addToast({ ...options, variant: "warning" }),
    [addToast]
  );

  const info = React.useCallback(
    (options: Omit<ToastState, "id" | "variant">) =>
      addToast({ ...options, variant: "info" }),
    [addToast]
  );

  const promise = React.useCallback(
    async (
      input: Promise<unknown>,
      options: {
        loading?: string | Omit<ToastState, "id" | "variant">;
        success?: string | ((data: unknown) => string | Omit<ToastState, "id" | "variant">);
        error?: string | ((error: Error) => string | Omit<ToastState, "id" | "variant">);
      }
    ): Promise<unknown> => {
      const loadingId = addToast({
        ...(typeof options.loading === "string"
          ? { description: options.loading }
          : (options ?? {})),
        variant: "info",
        duration: Number.MAX_SAFE_INTEGER,
      });

      try {
        const data = await input;
        removeToast(loadingId);
        if (options.success) {
          if (typeof options.success === "string") {
            addToast({ description: options.success, variant: "success" });
          } else {
            const successResult = options.success(data);
            const successOptions =
              typeof successResult === "string"
                ? { description: successResult }
                : successResult;
            addToast({ ...successOptions, variant: "success" });
          }
        }
        return data;
      } catch (err) {
        removeToast(loadingId);
        if (options.error) {
          if (typeof options.error === "string") {
            addToast({ description: options.error, variant: "error" });
          } else {
            const errorResult = options.error(err as Error);
            const errorOptions =
              typeof errorResult === "string"
                ? { description: errorResult }
                : errorResult;
            addToast({ ...errorOptions, variant: "error" });
          }
        }
        throw err;
      }
    },
    [addToast, removeToast]
  );

  const value = React.useMemo(
    () => ({
      toasts,
      addToast,
      removeToast,
      toast,
      success,
      error,
      warning,
      info,
      promise,
    }),
    [toasts, addToast, removeToast, toast, success, error, warning, info, promise]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onClose={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
