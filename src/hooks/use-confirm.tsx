import { createContext, useContext, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
};

type PromptOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;
type PromptFn = (
  message: string,
  defaultValue?: string,
  options?: PromptOptions,
) => Promise<string | null>;

type Ctx = { confirm: ConfirmFn; promptDialog: PromptFn };

const noop: Ctx = {
  confirm: async (message, options) => Promise.resolve(window.confirm(options?.title ?? message)),
  promptDialog: async (message, defaultValue) =>
    Promise.resolve(window.prompt(message, defaultValue)),
};

const DialogCtx = createContext<Ctx>(noop);

type ConfirmRequest = { message: string; options: ConfirmOptions; resolve: (v: boolean) => void };
type PromptRequest = {
  message: string;
  options: PromptOptions;
  defaultValue: string;
  resolve: (v: string | null) => void;
};

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [promptReq, setPromptReq] = useState<PromptRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const confirm: ConfirmFn = (message, options = {}) =>
    new Promise((resolve) => setConfirmReq({ message, options, resolve }));

  const promptDialog: PromptFn = (message, defaultValue = "", options = {}) =>
    new Promise((resolve) => {
      setPromptValue(defaultValue);
      setPromptReq({ message, options, defaultValue, resolve });
    });

  const settleConfirm = (v: boolean) => {
    confirmReq?.resolve(v);
    setConfirmReq(null);
  };
  const settlePrompt = (v: string | null) => {
    promptReq?.resolve(v);
    setPromptReq(null);
  };

  return (
    <DialogCtx.Provider value={{ confirm, promptDialog }}>
      {children}

      <AlertDialog open={!!confirmReq} onOpenChange={(open) => !open && settleConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmReq?.options.title ?? "Confirmer"}</AlertDialogTitle>
            <AlertDialogDescription>{confirmReq?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirm(false)}>
              {confirmReq?.options.cancelLabel ?? "Annuler"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settleConfirm(true)}
              className={
                confirmReq?.options.variant === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {confirmReq?.options.confirmLabel ?? "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!promptReq} onOpenChange={(open) => !open && settlePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{promptReq?.options.title ?? promptReq?.message}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") settlePrompt(promptValue);
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settlePrompt(null)}>
              {promptReq?.options.cancelLabel ?? "Annuler"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => settlePrompt(promptValue)}>
              {promptReq?.options.confirmLabel ?? "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(DialogCtx).confirm;
}

export function usePromptDialog() {
  return useContext(DialogCtx).promptDialog;
}
