import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SearchableOption = {
  value: string;
  label: string;
  hint?: string;
};

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Sélectionner…",
  emptyLabel = "Aucun résultat",
  searchPlaceholder = "Rechercher…",
  className,
  triggerClassName,
  disabled,
  allowClear = false,
  clearValue = "",
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  allowClear?: boolean;
  clearValue?: string;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const current = useMemo(() => options.find((o) => o.value === value), [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !current && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate text-left">{current ? current.label : tr(placeholder)}</span>
          <div className="flex items-center gap-1 pl-2 shrink-0">
            {allowClear && current && value !== clearValue && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onValueChange(clearValue); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onValueChange(clearValue); } }}
                className="rounded-sm opacity-60 hover:opacity-100"
                aria-label={tr("Effacer")}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", className)} align="start" style={{ width: "var(--radix-popover-trigger-width)" }}>
        <Command
          filter={(itemValue, search) => {
            const opt = options.find((o) => o.value === itemValue);
            const hay = `${opt?.label ?? ""} ${opt?.hint ?? ""}`.toLowerCase();
            return hay.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={tr(searchPlaceholder)} />
          <CommandList>
            <CommandEmpty>{tr(emptyLabel)}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={(v) => { onValueChange(v); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto text-xs text-muted-foreground truncate pl-2">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}